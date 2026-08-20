import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentMethod,
  PaymentChargeStatus,
  PaymentChargeChannel,
} from '../enums';

/**
 * Response DTO for payment charges.
 * Omits providerPayload internals and sensitive data.
 */
export class PaymentChargeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty() paymentGatewayId!: string;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentChargeStatus }) status!: PaymentChargeStatus;
  @ApiProperty() amount!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty() idempotencyKey!: string;
  @ApiPropertyOptional() externalId!: string | null;
  @ApiPropertyOptional() externalStatus!: string | null;
  @ApiPropertyOptional() ourNumber!: string | null;
  @ApiPropertyOptional() txid!: string | null;
  @ApiPropertyOptional() digitableLine!: string | null;
  @ApiPropertyOptional() barcode!: string | null;
  @ApiPropertyOptional() pixCopyPaste!: string | null;
  @ApiPropertyOptional() qrCodeUrl!: string | null;
  @ApiPropertyOptional() documentUrl!: string | null;
  @ApiPropertyOptional() failureCode!: string | null;
  @ApiPropertyOptional() failureMessage!: string | null;
  @ApiPropertyOptional() issuedAt!: string | null;
  @ApiPropertyOptional() paidAt!: string | null;
  @ApiPropertyOptional() expiresAt!: string | null;
  @ApiPropertyOptional({ enum: PaymentChargeChannel }) attributedChannel!: PaymentChargeChannel | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  /**
   * Maps a Prisma PaymentCharge record to the response DTO.
   * Omits providerPayload for security/size.
   */
  static fromEntity(record: Record<string, any>): PaymentChargeResponseDto {
    const dto = new PaymentChargeResponseDto();
    dto.id = record.id;
    dto.accountId = record.accountId;
    dto.contractId = record.contractId;
    dto.paymentGatewayId = record.paymentGatewayId;
    dto.method = record.method;
    dto.status = record.status;
    dto.amount = record.amount?.toString() ?? record.amount;
    dto.dueDate = record.dueDate instanceof Date ? record.dueDate.toISOString() : record.dueDate;
    dto.idempotencyKey = record.idempotencyKey;
    dto.externalId = record.externalId ?? null;
    dto.externalStatus = record.externalStatus ?? null;
    dto.ourNumber = record.ourNumber ?? null;
    dto.txid = record.txid ?? null;
    dto.digitableLine = record.digitableLine ?? null;
    dto.barcode = record.barcode ?? null;
    dto.pixCopyPaste = record.pixCopyPaste ?? null;
    dto.qrCodeUrl = record.qrCodeUrl ?? null;
    dto.documentUrl = record.documentUrl ?? null;
    dto.failureCode = record.failureCode ?? null;
    dto.failureMessage = record.failureMessage ?? null;
    dto.issuedAt = record.issuedAt ? (record.issuedAt instanceof Date ? record.issuedAt.toISOString() : record.issuedAt) : null;
    dto.paidAt = record.paidAt ? (record.paidAt instanceof Date ? record.paidAt.toISOString() : record.paidAt) : null;
    dto.expiresAt = record.expiresAt ? (record.expiresAt instanceof Date ? record.expiresAt.toISOString() : record.expiresAt) : null;
    dto.attributedChannel = record.attributedChannel ?? null;
    dto.createdAt = record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt;
    dto.updatedAt = record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt;
    return dto;
  }
}
