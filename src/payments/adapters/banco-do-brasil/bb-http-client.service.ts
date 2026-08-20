import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig, Method } from 'axios';
import { DecryptedGatewayConfig } from '../types';
import { BancoDoBrasilAuthService } from './bb-auth.service';

// ─── Result Types ──────────────────────────────────────────────────────────────

/**
 * Structured result returned by every BancoDoBrasilHttpClient request.
 * The client NEVER throws — callers always receive a typed outcome.
 */
export type BbHttpResult<T> =
  | { outcome: 'SUCCESS'; data: T; statusCode: number }
  | { outcome: 'TIMEOUT' }
  | { outcome: 'RATE_LIMITED'; lastStatusCode: number }
  | { outcome: 'PROVIDER_ERROR'; statusCode: number; errorBody?: unknown };

// ─── Constants ─────────────────────────────────────────────────────────────────

const BASE_DELAY_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.25;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

// ─── Request Config ────────────────────────────────────────────────────────────

export interface BbRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  data?: unknown;
  gatewayConfig: DecryptedGatewayConfig;
}

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * BancoDoBrasilHttpClient — reusable HTTP client wrapper that handles
 * retry with exponential backoff (HTTP 429) and per-gateway timeout.
 *
 * Design decisions (from Requirements 4 AC8/AC9):
 * - Timeout without response → outcome TIMEOUT (persist as PENDING, lifecycle job reconciles)
 * - HTTP 429 → retry with exponential backoff + jitter; Retry-After header respected as minimum
 * - All retries exhausted → outcome RATE_LIMITED
 * - Other 4xx/5xx → outcome PROVIDER_ERROR
 * - Success → outcome SUCCESS with typed data
 *
 * Security:
 * - Never logs Authorization, tokens, certificates, or secret headers
 * - Logs: URL, method, status code, retry count, delay applied
 */
@Injectable()
export class BancoDoBrasilHttpClient {
  private readonly logger = new Logger(BancoDoBrasilHttpClient.name);

  constructor(private readonly authService: BancoDoBrasilAuthService) {}

  /**
   * Makes an HTTP request to BB API with retry and timeout handling.
   * Returns a structured result — never throws.
   */
  async request<T>(config: BbRequestConfig): Promise<BbHttpResult<T>> {
    const { method, url, data, gatewayConfig } = config;
    const timeoutMs = gatewayConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = gatewayConfig.maxRetries ?? DEFAULT_MAX_RETRIES;

    let attempt = 0;

    while (true) {
      attempt++;

      try {
        const result = await this.executeRequest<T>(
          method,
          url,
          data,
          gatewayConfig,
          timeoutMs,
        );
        return result;
      } catch (error) {
        // Timeout detection — no HTTP response received
        if (this.isTimeoutError(error)) {
          this.logger.warn(
            `Timeout after ${timeoutMs}ms: ${method} ${url} (attempt ${attempt})`,
          );
          return { outcome: 'TIMEOUT' };
        }

        // HTTP 429 — apply retry with backoff
        if (this.isRateLimitError(error)) {
          if (attempt > maxRetries) {
            this.logger.warn(
              `Rate limited after ${maxRetries} retries: ${method} ${url}`,
            );
            return { outcome: 'RATE_LIMITED', lastStatusCode: 429 };
          }

          const retryAfterHeader = this.getRetryAfterHeader(error);
          const delay = this.calculateDelay(attempt, retryAfterHeader);

          this.logger.warn(
            `HTTP 429 on ${method} ${url} — attempt ${attempt}/${maxRetries}, ` +
              `retrying in ${delay}ms`,
          );

          await this.sleep(delay);
          continue;
        }

        // Other HTTP errors (4xx not 429, 5xx) — return structured error
        if (axios.isAxiosError(error) && error.response) {
          const { status, data: errorBody } = error.response;
          this.logger.warn(
            `Provider error ${status}: ${method} ${url} (attempt ${attempt})`,
          );
          return { outcome: 'PROVIDER_ERROR', statusCode: status, errorBody };
        }

        // Unexpected non-HTTP error (network error without timeout code)
        // Treat as a provider error with status 0
        this.logger.error(
          `Unexpected error on ${method} ${url}: ${(error as Error).message}`,
        );
        return { outcome: 'PROVIDER_ERROR', statusCode: 0, errorBody: undefined };
      }
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Executes a single authenticated HTTP request to the BB API.
   */
  private async executeRequest<T>(
    method: Method,
    url: string,
    data: unknown | undefined,
    gatewayConfig: DecryptedGatewayConfig,
    timeoutMs: number,
  ): Promise<BbHttpResult<T>> {
    const token = await this.authService.getAccessToken(gatewayConfig);
    const httpsAgent = this.authService.createHttpsAgent(gatewayConfig);

    const axiosConfig: AxiosRequestConfig = {
      method,
      url,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: { 'gw-dev-app-key': gatewayConfig.developerKey },
      ...(data !== undefined ? { data } : {}),
      ...(httpsAgent ? { httpsAgent } : {}),
    };

    const response = await axios.request<T>(axiosConfig);

    return {
      outcome: 'SUCCESS',
      data: response.data,
      statusCode: response.status,
    };
  }

  /**
   * Determines if an error is a timeout (no HTTP response received).
   */
  private isTimeoutError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    // Axios timeout codes: ECONNABORTED, ETIMEDOUT or ERR_CANCELED
    return (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ERR_CANCELED'
    );
  }

  /**
   * Determines if an error is an HTTP 429 (rate limit).
   */
  private isRateLimitError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 429;
  }

  /**
   * Extracts the Retry-After header value in milliseconds.
   * Returns undefined if the header is not present or cannot be parsed.
   */
  private getRetryAfterHeader(error: unknown): number | undefined {
    if (!axios.isAxiosError(error) || !error.response) return undefined;

    const retryAfter = error.response.headers?.['retry-after'];
    if (!retryAfter) return undefined;

    const seconds = Number(retryAfter);
    if (isNaN(seconds) || seconds <= 0) return undefined;

    return seconds * 1_000; // Convert seconds to milliseconds
  }

  /**
   * Calculates the delay for exponential backoff with jitter.
   * Formula: baseDelay × 2^(attempt - 1) ± 25% jitter
   * If Retry-After header is present, uses it as minimum delay.
   */
  calculateDelay(attempt: number, retryAfterMs?: number): number {
    const exponentialDelay =
      BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);

    // Apply jitter: ±25% of the calculated delay
    const jitterRange = exponentialDelay * JITTER_FACTOR;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    let delay = Math.round(exponentialDelay + jitter);

    // Respect Retry-After as minimum delay
    if (retryAfterMs !== undefined && delay < retryAfterMs) {
      delay = retryAfterMs;
    }

    return Math.max(delay, 0);
  }

  /**
   * Sleeps for the specified number of milliseconds.
   * Extracted for testability.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
