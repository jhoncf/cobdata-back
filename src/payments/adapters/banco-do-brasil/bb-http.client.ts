import { Injectable, Logger } from '@nestjs/common';
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  Method,
} from 'axios';
import * as https from 'https';
import { DecryptedGatewayConfig } from '../types';
import { BancoDoBrasilAuthService } from './bb-auth.service';

/**
 * BbHttpClient — wraps Axios with BB-specific authentication (OAuth2 + mTLS).
 *
 * Responsibilities:
 * - Attaches Authorization Bearer header and gw-dev-app-key to all requests.
 * - Uses the mTLS HTTPS agent from BancoDoBrasilAuthService when certificate is configured.
 * - Handles 401 responses with a single token refresh retry.
 * - Never logs Authorization header content or tokens.
 *
 * This service is injectable for easy mocking in tests.
 */
@Injectable()
export class BbHttpClient {
  private readonly logger = new Logger(BbHttpClient.name);

  constructor(private readonly authService: BancoDoBrasilAuthService) {}

  /**
   * Performs an authenticated HTTP request to the BB API.
   *
   * @param method - HTTP method (GET, POST, PUT, PATCH, DELETE)
   * @param url - Full URL for the request
   * @param config - Decrypted gateway configuration
   * @param data - Optional request body
   * @param axiosConfig - Optional additional Axios configuration
   * @returns The response data typed as T
   */
  async request<T>(
    method: Method,
    url: string,
    config: DecryptedGatewayConfig,
    data?: unknown,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const token = await this.authService.getAccessToken(config);
    const httpsAgent = this.authService.createHttpsAgent(config);

    const client = this.createClient(config, httpsAgent);

    try {
      return await this.executeRequest<T>(
        client,
        method,
        url,
        token,
        config.developerKey,
        data,
        axiosConfig,
      );
    } catch (error) {
      // On 401, attempt a single token refresh and retry
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.warn('Received 401, attempting token refresh');
        const newToken = await this.authService.refreshToken(config);
        return this.executeRequest<T>(
          client,
          method,
          url,
          newToken,
          config.developerKey,
          data,
          axiosConfig,
        );
      }
      throw error;
    }
  }

  /**
   * Creates an Axios instance configured with timeout and optional mTLS agent.
   */
  private createClient(
    config: DecryptedGatewayConfig,
    httpsAgent?: https.Agent,
  ): AxiosInstance {
    return axios.create({
      timeout: config.timeoutMs,
      ...(httpsAgent ? { httpsAgent } : {}),
    });
  }

  /**
   * Executes the HTTP request with proper headers.
   * Never logs the Authorization header value.
   */
  private async executeRequest<T>(
    client: AxiosInstance,
    method: Method,
    url: string,
    token: string,
    developerKey: string,
    data?: unknown,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const requestConfig: AxiosRequestConfig = {
      ...axiosConfig,
      method,
      url,
      headers: {
        ...axiosConfig?.headers,
        Authorization: `Bearer ${token}`,
      },
      params: {
        ...axiosConfig?.params,
        'gw-dev-app-key': developerKey,
      },
      ...(data !== undefined ? { data } : {}),
    };

    this.logger.debug(`BB API request: ${method.toUpperCase()} ${url}`);

    return client.request<T>(requestConfig);
  }
}
