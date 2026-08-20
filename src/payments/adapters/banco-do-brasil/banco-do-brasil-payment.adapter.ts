import { Injectable, Logger } from '@nestjs/common';
import { PaymentProviderAdapter } from '../payment-provider-adapter.interface';
import { PaymentProviderType, PaymentMethod, PaymentChargeStatus } from '../../enums';
import { PaymentChargeEntity } from '../../entities/payment-charge.entity';
import {
  PaymentCapability,
  MissingField,
  IssuePaymentChargeInput,
  DecryptedGatewayConfig,
  IssuedPaymentCharge,
  PaymentChargeUpdate,
} from '../types';
import { BancoDoBrasilHttpClient, BbRequestConfig } from './bb-http-client.service';
import { BancoDoBrasilAuthService, PIX_API_BASE_URLS } from './bb-auth.service';

// ─── BB Pix Cob Response Types ─────────────────────────────────────────────────

interface BbCobResponse {
  txid: string;
  status: string;
  calendario: {
    criacao: string;
    expiracao: number;
  };
  devedor: {
    cpf?: string;
    cnpj?: string;
    nome: string;
  };
  valor: {
    original: string;
  };
  chave: string;
  pixCopiaECola?: string;
  location?: string;
}

// ─── Error Classes ─────────────────────────────────────────────────────────────

export class BbTimeoutError extends Error {
  constructor() {
    super('BB API request timed out without a response — charge status is PENDING');
    this.name = 'BbTimeoutError';
  }
}

export class BbRateLimitedError extends Error {
  constructor() {
    super('BB API rate limit exhausted — charge status is FAILED/RATE_LIMITED');
    this.name = 'BbRateLimitedError';
  }
}

export class BbProviderError extends Error {
  readonly failureCode: string;

  constructor(statusCode: number, message: string, failureCode?: string) {
    super(message);
    this.name = 'BbProviderError';
    this.failureCode = failureCode ?? `BB_${statusCode}`;
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PIX_EXPIRATION_SECONDS = 86_400; // 24 hours

// ─── Adapter Implementation ────────────────────────────────────────────────────

/**
 * BancoDoBrasilPaymentAdapter — implements PaymentProviderAdapter for Banco do Brasil.
 *
 * Currently supports:
 * - PIX (Cob imediata via PUT /cob/{txid})
 * - BOLETO and BOLEPIX are declared as capabilities for future implementation
 *
 * Design:
 * - Uses BancoDoBrasilHttpClient (never throws) for retry/timeout handling
 * - Maps BbHttpResult outcomes to domain types or specific errors
 * - Sanitizes provider error messages before propagation
 */
@Injectable()
export class BancoDoBrasilPaymentAdapter implements PaymentProviderAdapter {
  readonly providerType = PaymentProviderType.BANCO_DO_BRASIL;

  private readonly logger = new Logger(BancoDoBrasilPaymentAdapter.name);

  constructor(
    private readonly httpClient: BancoDoBrasilHttpClient,
    private readonly authService: BancoDoBrasilAuthService,
  ) {}

  // ─── Capabilities ──────────────────────────────────────────────────────────

  getCapabilities(): PaymentCapability[] {
    return [
      { method: PaymentMethod.PIX, supported: true, features: ['qrCode', 'copyPaste'] },
      { method: PaymentMethod.BOLETO, supported: true },
      { method: PaymentMethod.BOLEPIX, supported: true, features: ['qrCode', 'copyPaste'] },
    ];
  }

  // ─── Pre-validation ────────────────────────────────────────────────────────

  validateIssueInput(input: IssuePaymentChargeInput): MissingField[] {
    const missing: MissingField[] = [];

    switch (input.method) {
      case PaymentMethod.PIX:
        this.validatePixFields(input, missing);
        break;
      case PaymentMethod.BOLETO:
        this.validateBoletoFields(input, missing);
        break;
      case PaymentMethod.BOLEPIX:
        this.validatePixFields(input, missing);
        this.validateAddressFields(input, missing);
        break;
    }

    return missing;
  }

  // ─── Issue (Pix Cob Imediata) ──────────────────────────────────────────────

  async issue(
    input: IssuePaymentChargeInput,
    config: DecryptedGatewayConfig,
  ): Promise<IssuedPaymentCharge> {
    const baseUrl = PIX_API_BASE_URLS[config.environment];
    const txid = input.txid!;
    const url = `${baseUrl}/cob/${txid}`;

    const expirationSeconds = this.calculateExpirationSeconds(input.expiresAt);
    const payload = this.buildCobPayload(input, config, expirationSeconds);

    const requestConfig: BbRequestConfig = {
      method: 'PUT',
      url,
      data: payload,
      gatewayConfig: config,
    };

    const result = await this.httpClient.request<BbCobResponse>(requestConfig);

    switch (result.outcome) {
      case 'SUCCESS':
        return this.mapCobResponseToIssuedCharge(result.data, input, expirationSeconds);

      case 'TIMEOUT':
        throw new BbTimeoutError();

      case 'RATE_LIMITED':
        throw new BbRateLimitedError();

      case 'PROVIDER_ERROR':
        const message = this.sanitizeErrorMessage(result.errorBody);
        throw new BbProviderError(
          result.statusCode,
          message,
          this.classifyProviderError(result.errorBody),
        );
    }
  }

  // ─── Fetch Status ──────────────────────────────────────────────────────────

  async fetchStatus(
    charge: PaymentChargeEntity,
    config: DecryptedGatewayConfig,
  ): Promise<PaymentChargeUpdate> {
    const baseUrl = PIX_API_BASE_URLS[config.environment];
    const txid = charge.txid!;
    const url = `${baseUrl}/cob/${txid}`;

    const requestConfig: BbRequestConfig = {
      method: 'GET',
      url,
      gatewayConfig: config,
    };

    const result = await this.httpClient.request<BbCobResponse>(requestConfig);

    switch (result.outcome) {
      case 'SUCCESS':
        return this.mapCobStatusToChargeUpdate(result.data);

      case 'TIMEOUT':
        throw new BbTimeoutError();

      case 'RATE_LIMITED':
        throw new BbRateLimitedError();

      case 'PROVIDER_ERROR':
        throw new BbProviderError(
          result.statusCode,
          this.sanitizeErrorMessage(result.errorBody),
        );
    }
  }

  // ─── Private: Validation Helpers ───────────────────────────────────────────

  private validatePixFields(
    input: IssuePaymentChargeInput,
    missing: MissingField[],
  ): void {
    if (!input.debtor?.name) {
      missing.push({ field: 'debtor.name', reason: 'required' });
    }
    if (!input.debtor?.document) {
      missing.push({ field: 'debtor.document', reason: 'required' });
    } else if (!this.isValidDocument(input.debtor.document)) {
      missing.push({ field: 'debtor.document', reason: 'invalid_format' });
    }
    if (!input.amount || parseFloat(input.amount) <= 0) {
      missing.push({ field: 'amount', reason: 'required' });
    }
  }

  private validateBoletoFields(
    input: IssuePaymentChargeInput,
    missing: MissingField[],
  ): void {
    this.validatePixFields(input, missing);
    this.validateAddressFields(input, missing);
  }

  private validateAddressFields(
    input: IssuePaymentChargeInput,
    missing: MissingField[],
  ): void {
    const address = input.debtor?.address;
    if (!address) {
      missing.push({ field: 'debtor.address', reason: 'required' });
      return;
    }
    if (!address.street) missing.push({ field: 'debtor.address.street', reason: 'required' });
    if (!address.number) missing.push({ field: 'debtor.address.number', reason: 'required' });
    if (!address.neighborhood) missing.push({ field: 'debtor.address.neighborhood', reason: 'required' });
    if (!address.city) missing.push({ field: 'debtor.address.city', reason: 'required' });
    if (!address.state) missing.push({ field: 'debtor.address.state', reason: 'required' });
    if (!address.zipCode) missing.push({ field: 'debtor.address.zipCode', reason: 'required' });
  }

  private isValidDocument(document: string): boolean {
    const cleaned = document.replace(/\D/g, '');
    return cleaned.length === 11 || cleaned.length === 14;
  }

  // ─── Private: Payload Building ─────────────────────────────────────────────

  private buildCobPayload(
    input: IssuePaymentChargeInput,
    config: DecryptedGatewayConfig,
    expirationSeconds: number,
  ): Record<string, unknown> {
    const cleanDocument = input.debtor.document.replace(/\D/g, '');
    const isCnpj = cleanDocument.length === 14;

    const devedor: Record<string, string> = {
      nome: input.debtor.name,
    };

    if (isCnpj) {
      devedor.cnpj = cleanDocument;
    } else {
      devedor.cpf = cleanDocument;
    }

    return {
      calendario: {
        expiracao: expirationSeconds,
      },
      devedor,
      valor: {
        original: this.formatAmount(input.amount),
      },
      chave: config.pixKey!,
      solicitacaoPagador: `Pagamento contrato CobCom`,
    };
  }

  private calculateExpirationSeconds(expiresAt?: Date): number {
    if (!expiresAt) {
      return DEFAULT_PIX_EXPIRATION_SECONDS;
    }

    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffSeconds = Math.ceil(diffMs / 1_000);

    return diffSeconds > 0 ? diffSeconds : DEFAULT_PIX_EXPIRATION_SECONDS;
  }

  /**
   * Formats amount to two decimal places as required by the BB API.
   * Input is already a decimal string, but we ensure the format "100.00".
   */
  private formatAmount(amount: string): string {
    const num = parseFloat(amount);
    return num.toFixed(2);
  }

  // ─── Private: Response Mapping ─────────────────────────────────────────────

  private mapCobResponseToIssuedCharge(
    response: BbCobResponse,
    input: IssuePaymentChargeInput,
    expirationSeconds: number,
  ): IssuedPaymentCharge {
    const issuedAt = new Date();
    const expiresAt = input.expiresAt ?? new Date(issuedAt.getTime() + expirationSeconds * 1_000);

    return {
      externalId: response.txid,
      externalStatus: response.status,
      txid: response.txid,
      pixCopyPaste: response.pixCopiaECola ?? undefined,
      qrCodeUrl: response.location ?? undefined,
      issuedAt,
      expiresAt,
      providerPayload: {
        calendario: response.calendario,
        status: response.status,
        location: response.location,
      },
    };
  }

  private mapCobStatusToChargeUpdate(response: BbCobResponse): PaymentChargeUpdate {
    const status = this.mapBbStatusToChargeStatus(response.status);

    return {
      status,
      externalStatus: response.status,
      providerPayload: {
        calendario: response.calendario,
        status: response.status,
      },
    };
  }

  /**
   * Maps BB Pix Cob status to internal PaymentChargeStatus.
   * - ATIVA → ISSUED
   * - CONCLUIDA → PAID
   * - REMOVIDA_PELO_USUARIO_RECEBEDOR → CANCELLED
   * - Other → keeps current as ISSUED (safe default)
   */
  private mapBbStatusToChargeStatus(bbStatus: string): PaymentChargeStatus {
    switch (bbStatus) {
      case 'ATIVA':
        return PaymentChargeStatus.ISSUED;
      case 'CONCLUIDA':
        return PaymentChargeStatus.PAID;
      case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
        return PaymentChargeStatus.CANCELLED;
      default:
        return PaymentChargeStatus.ISSUED;
    }
  }

  // ─── Private: Error Sanitization ───────────────────────────────────────────

  /**
   * Extracts a safe error message from the BB error response.
   * Never exposes raw error body to callers — only known safe fields.
   */
  private sanitizeErrorMessage(errorBody: unknown): string {
    if (!errorBody || typeof errorBody !== 'object') {
      return 'Provider returned an error';
    }

    const body = errorBody as Record<string, unknown>;

    // BB API typically returns { type, title, status, detail, violacoes }
    if (typeof body.title === 'string') {
      return body.title;
    }

    if (typeof body.detail === 'string') {
      // Truncate long messages and avoid leaking internal details
      return body.detail.substring(0, 200);
    }

    return 'Provider returned an error';
  }

  /** Maps safe, actionable BB validation failures to internal error codes. */
  private classifyProviderError(errorBody: unknown): string | undefined {
    if (!errorBody || typeof errorBody !== 'object') return undefined;

    const detail = (errorBody as Record<string, unknown>).detail;
    if (
      typeof detail === 'string' &&
      /chave pix.*n[aã]o foi localizada/i.test(detail)
    ) {
      return 'PIX_KEY_NOT_FOUND';
    }

    return undefined;
  }
}
