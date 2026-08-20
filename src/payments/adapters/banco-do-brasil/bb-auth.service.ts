import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { DecryptedGatewayConfig } from '../types';
import { PaymentGatewayEnvironment } from '../../enums';

/**
 * OAuth2 token response from BB API.
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Cached token entry with expiration tracking.
 */
interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

/**
 * BB OAuth2 endpoint URLs by environment.
 */
const OAUTH_ENDPOINTS: Record<PaymentGatewayEnvironment, string> = {
  [PaymentGatewayEnvironment.SANDBOX]:
    'https://oauth.hm.bb.com.br/oauth/token',
  [PaymentGatewayEnvironment.PRODUCTION]:
    'https://oauth.bb.com.br/oauth/token',
};

/**
 * BB Pix API v2 base URLs by environment.
 */
export const PIX_API_BASE_URLS: Record<PaymentGatewayEnvironment, string> = {
  [PaymentGatewayEnvironment.SANDBOX]:
    'https://api-pix.hm.bb.com.br/pix/v2',
  [PaymentGatewayEnvironment.PRODUCTION]:
    'https://api-pix.bb.com.br/pix/v2',
};

/**
 * OAuth2 scope for Pix Cob API.
 */
const OAUTH_SCOPE = 'cob.read cob.write webhook.read webhook.write';

/**
 * Refresh tokens 60 seconds before actual expiry to avoid
 * race conditions with in-flight requests.
 */
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/**
 * BancoDoBrasilAuthService — manages OAuth2 Client Credentials Grant authentication
 * for the Banco do Brasil API, with mTLS support and token caching.
 *
 * Security:
 * - Never logs tokens, client_secret, Authorization header, or certificate content.
 * - Uses configurable timeout from gateway config.
 * - Creates HTTPS agent with PFX certificate when mTLS credentials are provided.
 * - Thread-safe: concurrent token requests during refresh are coalesced into a single request.
 */
@Injectable()
export class BancoDoBrasilAuthService {
  private readonly logger = new Logger(BancoDoBrasilAuthService.name);
  private readonly tokenCache = new Map<string, CachedToken>();
  private readonly inflightRequests = new Map<string, Promise<CachedToken>>();

  /**
   * Returns a fully authenticated Axios instance configured with:
   * - Bearer token in Authorization header
   * - gw-dev-app-key header with the developer key
   * - mTLS HTTPS agent when certificate is provided
   * - Configured timeout from gateway config
   * - Base URL set to the Pix API v2 endpoint for the environment
   */
  async getAuthenticatedClient(
    config: DecryptedGatewayConfig,
  ): Promise<AxiosInstance> {
    const token = await this.getAccessToken(config);
    const httpsAgent = this.createHttpsAgent(config);
    const baseURL = PIX_API_BASE_URLS[config.environment];

    return axios.create({
      baseURL,
      timeout: config.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        'gw-dev-app-key': config.developerKey,
      },
      ...(httpsAgent ? { httpsAgent } : {}),
    });
  }

  /**
   * Returns a valid access token for the given gateway configuration.
   * Uses cached tokens when available and refreshes proactively before expiry.
   * Thread-safe: concurrent calls during refresh are coalesced.
   */
  async getAccessToken(config: DecryptedGatewayConfig): Promise<string> {
    const cacheKey = this.buildCacheKey(config);
    const cached = this.tokenCache.get(cacheKey);

    if (cached && !this.isTokenExpired(cached)) {
      return cached.accessToken;
    }

    const token = await this.getOrRefreshToken(cacheKey, config);
    return token.accessToken;
  }

  /**
   * Forces a token refresh, bypassing the cache.
   * Used when a 401 response indicates the token is invalid.
   */
  async refreshToken(config: DecryptedGatewayConfig): Promise<string> {
    const cacheKey = this.buildCacheKey(config);
    this.tokenCache.delete(cacheKey);
    this.inflightRequests.delete(cacheKey);

    const token = await this.getOrRefreshToken(cacheKey, config);
    return token.accessToken;
  }

  /**
   * Creates an HTTPS agent with mTLS when certificate is provided.
   * Returns undefined when no certificate is configured (sandbox without mTLS).
   */
  createHttpsAgent(config: DecryptedGatewayConfig): https.Agent | undefined {
    if (!config.certificateBase64 || !config.certificatePassword) {
      return undefined;
    }

    const pfx = Buffer.from(config.certificateBase64, 'base64');

    return new https.Agent({
      pfx,
      passphrase: config.certificatePassword,
      rejectUnauthorized: true,
    });
  }

  /**
   * Thread-safe token acquisition. If a refresh is already in-flight for this cache key,
   * returns the existing promise instead of issuing a duplicate request.
   */
  private async getOrRefreshToken(
    cacheKey: string,
    config: DecryptedGatewayConfig,
  ): Promise<CachedToken> {
    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const promise = this.requestToken(config)
      .then((token) => {
        this.tokenCache.set(cacheKey, token);
        this.inflightRequests.delete(cacheKey);
        return token;
      })
      .catch((error) => {
        this.inflightRequests.delete(cacheKey);
        throw error;
      });

    this.inflightRequests.set(cacheKey, promise);
    return promise;
  }

  /**
   * Requests a new token from the BB OAuth2 endpoint using Client Credentials Grant.
   * Includes scope and gw-dev-app-key as per BB API documentation.
   */
  private async requestToken(
    config: DecryptedGatewayConfig,
  ): Promise<CachedToken> {
    const url = OAUTH_ENDPOINTS[config.environment];
    const httpsAgent = this.createHttpsAgent(config);

    const client: AxiosInstance = axios.create({
      timeout: config.timeoutMs,
      ...(httpsAgent ? { httpsAgent } : {}),
    });

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: OAUTH_SCOPE,
    });

    this.logger.debug(
      `Requesting OAuth2 token from ${config.environment} environment`,
    );

    try {
      const response = await client.post<TokenResponse>(url, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        params: { 'gw-dev-app-key': config.developerKey },
        auth: {
          username: config.clientId,
          password: config.clientSecret,
        },
      });

      const { access_token, expires_in } = response.data;
      const expiresAt = Date.now() + expires_in * 1000;

      this.logger.debug(
        `Token acquired, expires in ${expires_in}s (environment: ${config.environment})`,
      );

      return { accessToken: access_token, expiresAt };
    } catch (error) {
      // Log without exposing secrets
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      this.logger.error(
        `Failed to obtain OAuth2 token (status: ${status ?? 'unknown'}, environment: ${config.environment})`,
      );
      throw error;
    }
  }

  /**
   * Checks if a cached token is expired or about to expire.
   */
  private isTokenExpired(cached: CachedToken): boolean {
    return Date.now() >= cached.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Builds a cache key unique per client+environment combination.
   */
  private buildCacheKey(config: DecryptedGatewayConfig): string {
    return `${config.clientId}:${config.environment}`;
  }
}
