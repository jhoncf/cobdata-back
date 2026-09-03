import { ProviderType } from '@prisma/client';

export interface DebtPayload {
  operationItemId: string;
  document: string;
  contractNumber: string;
  wallet: string;
  debtType: string;
  occurrenceDate: string;
  debtValue: number;
  offer: {
    value: number;
    dueDaysFirstInstallment: number;
    maxInstallments: number;
  };
  debtOrigin?: {
    name: string;
    document: string;
  };
}

export interface RemovePayload {
  operationItemId: string;
  id: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  environment: 'HOMOLOGATION' | 'PRODUCTION';
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
