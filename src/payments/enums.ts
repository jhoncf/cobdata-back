/**
 * Payment provider type enum.
 * Represents the available payment providers.
 * Must match the Prisma enum PaymentProviderType.
 */
export enum PaymentProviderType {
  BANCO_DO_BRASIL = 'BANCO_DO_BRASIL',
}

/**
 * Payment method enum.
 * Represents the supported payment methods for charge issuance.
 * Must match the Prisma enum PaymentMethod.
 */
export enum PaymentMethod {
  BOLETO = 'BOLETO',
  PIX = 'PIX',
  BOLEPIX = 'BOLEPIX',
}

/**
 * Payment gateway environment enum.
 * Determines whether the gateway connects to sandbox or production APIs.
 * Must match the Prisma enum PaymentGatewayEnvironment.
 */
export enum PaymentGatewayEnvironment {
  SANDBOX = 'SANDBOX',
  PRODUCTION = 'PRODUCTION',
}

/**
 * Payment charge status enum.
 * Represents the lifecycle states of a payment charge.
 * Must match the Prisma enum PaymentChargeStatus.
 */
export enum PaymentChargeStatus {
  PENDING = 'PENDING',
  ISSUED = 'ISSUED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

/**
 * Payment charge channel enum.
 * Represents the origin channel that initiated the charge.
 * Must match the Prisma enum PaymentChargeChannel.
 */
export enum PaymentChargeChannel {
  COBCOM = 'COBCOM',
  LANDING_PAGE = 'LANDING_PAGE',
  WHATSAPP = 'WHATSAPP',
  CHATBOT = 'CHATBOT',
}

/**
 * Payment event source enum.
 * Represents the origin of a payment lifecycle event/transition.
 */
export enum PaymentEventSource {
  WEBHOOK = 'WEBHOOK',
  SYNC = 'SYNC',
  JOB = 'JOB',
  MANUAL = 'MANUAL',
}

/**
 * Payment settlement source enum.
 * Represents the channel/origin that confirmed the payment.
 * Must match the Prisma enum PaymentSettlementSource.
 */
export enum PaymentSettlementSource {
  PIX = 'PIX',
  SERASA = 'SERASA',
  MANUAL = 'MANUAL',
}

/**
 * Payment settlement status enum.
 * Represents the immutable state of a settlement record.
 * Must match the Prisma enum PaymentSettlementStatus.
 */
export enum PaymentSettlementStatus {
  CONFIRMED = 'CONFIRMED',
  REVERSED = 'REVERSED',
}
