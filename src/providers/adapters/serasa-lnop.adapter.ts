import { Injectable, Logger } from '@nestjs/common';
import { ProviderType } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  ProviderAdapter,
  DebtPayload,
  RemovePayload,
  ProviderConfig,
  SendResult,
} from './provider-adapter.interface';

const HTTP_TIMEOUT = 30_000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 30_000; // 30 seconds base for exponential backoff

/**
 * Checks whether an HTTP status code is retryable (5xx or 429).
 */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Computes exponential backoff delay.
 * delay = base * 2^(attempt - 1)
 */
function getBackoffDelay(attempt: number): number {
  return RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
}

@Injectable()
export class SerasaLnopAdapter implements ProviderAdapter {
  readonly type = ProviderType.SERASA_LNOP;
  private readonly logger = new Logger(SerasaLnopAdapter.name);

  async sendDebts(
    items: DebtPayload[],
    config: ProviderConfig,
  ): Promise<SendResult> {
    const url = `${config.baseUrl}/debts/create`;
    // A API Limpa Nome Parceiros v3 recebe uma lista direta, com no máximo uma dívida.
    const body = JSON.stringify(items.map(({ operationItemId, ...debt }) => debt));

    return this.executeWithRetry(url, body, config);
  }

  async removeDebts(
    items: RemovePayload[],
    config: ProviderConfig,
  ): Promise<SendResult> {
    const url = `${config.baseUrl}/debts/remove`;
    const body = JSON.stringify(items.map(({ operationItemId, ...debt }) => debt));

    return this.executeWithRetry(url, body, config);
  }

  validateWebhookSignature(
    headers: Record<string, string>,
    body: Buffer,
    secret: string,
  ): boolean {
    const signature = headers['x-serasa-signature'] || headers['X-Serasa-Signature'];
    if (!signature) {
      return false;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Execute an HTTP request with retry logic.
   * Retries on 5xx and 429. No retry on 4xx (except 429).
   */
  private async executeWithRetry(
    url: string,
    body: string,
    config: ProviderConfig,
  ): Promise<SendResult> {
    let lastError: SendResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.doRequest(url, body, config);

        // Success (2xx)
        if (result.httpStatus >= 200 && result.httpStatus < 300) {
          return result;
        }

        // Retryable error (5xx or 429)
        if (isRetryable(result.httpStatus)) {
          lastError = result;
          if (attempt < MAX_RETRIES) {
            const delay = getBackoffDelay(attempt);
            this.logger.warn(
              `Retryable error (HTTP ${result.httpStatus}) on attempt ${attempt}. Retrying in ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }
        }

        // Non-retryable 4xx — return immediately
        return result;
      } catch (error) {
        // Network/timeout errors are retryable
        lastError = {
          httpStatus: 0,
          error: {
            code: 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };

        if (attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          this.logger.warn(
            `Network error on attempt ${attempt}. Retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
          continue;
        }
      }
    }

    return lastError || {
      httpStatus: 0,
      error: { code: 'UNKNOWN_ERROR', message: 'All retry attempts exhausted' },
    };
  }

  /**
   * Perform the actual HTTP request.
   * Uses Node.js native fetch with AbortController for timeout.
   */
  private async doRequest(
    url: string,
    body: string,
    config: ProviderConfig,
  ): Promise<SendResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const httpStatus = response.status;

      if (httpStatus === 202 || (httpStatus >= 200 && httpStatus < 300)) {
        const data = await response.json();
        return {
          httpStatus,
          transactionId: data?.transactionId,
          items: Array.isArray(data?.debtIds)
            ? data.debtIds.map((debtId: string) => ({ debtId }))
            : data?.items,
        };
      }

      // Error response
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { message: response.statusText };
      }

      return {
        httpStatus,
        error: {
          code: errorBody?.code || `HTTP_${httpStatus}`,
          message: this.errorMessage(errorBody, response.statusText),
        },
      };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Serasa error payloads can use message, errors[] or details fields. */
  private errorMessage(errorBody: any, fallback: string): string {
    if (typeof errorBody?.message === 'string' && errorBody.message.trim()) return errorBody.message;
    if (Array.isArray(errorBody?.errors)) {
      const messages = errorBody.errors
        .map((error: any) => typeof error === 'string' ? error : error?.message || error?.detail)
        .filter((message: unknown): message is string => typeof message === 'string' && message.trim().length > 0);
      if (messages.length) return messages.join('; ');
    }
    if (typeof errorBody?.detail === 'string' && errorBody.detail.trim()) return errorBody.detail;
    return fallback;
  }
}
