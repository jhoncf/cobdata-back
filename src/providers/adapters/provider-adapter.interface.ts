import { ProviderType } from '@prisma/client';

export interface DebtPayload {
  operationItemId: string;
  debtorDocument: string;
  contractNumber: string;
  debtType: string;
  occurrenceDate: string;
  originalValue: number;
  updatedValue?: number;
  debtOrigin?: string;
}

export interface RemovePayload {
  operationItemId: string;
  debtId: string;
  debtorDocument: string;
  contractNumber: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  environment: 'HOMOLOGATION' | 'PRODUCTION';
  walletMappings: Map<string, string>; // localWalletId → externalWalletId
}

export interface SendResult {
  httpStatus: number;
  transactionId?: string;
  items?: Array<{ externalId?: string; debtId?: string }>;
  error?: { code: string; message: string };
}

export interface ProviderAdapter {
  readonly type: ProviderType;

  sendDebts(items: DebtPayload[], config: ProviderConfig): Promise<SendResult>;
  removeDebts(items: RemovePayload[], config: ProviderConfig): Promise<SendResult>;
  validateWebhookSignature(
    headers: Record<string, string>,
    body: Buffer,
    secret: string,
  ): boolean;
}
