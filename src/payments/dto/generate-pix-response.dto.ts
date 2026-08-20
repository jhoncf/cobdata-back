import { ApiProperty } from '@nestjs/swagger';
import { PaymentChargeStatus } from '../enums';

/**
 * Minimal response DTO for Pix charges generated via external channels.
 * Returns only the fields necessary for the debtor to complete the payment.
 */
export class GeneratePixResponseDto {
  @ApiProperty() chargeId!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty() txid!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty() pixCopyPaste!: string;
  @ApiProperty({ required: false }) qrCodeUrl?: string;
  @ApiProperty({ enum: PaymentChargeStatus }) status!: PaymentChargeStatus;

  static fromEntity(record: Record<string, any>): GeneratePixResponseDto {
    const dto = new GeneratePixResponseDto();
    dto.chargeId = record.id;
    dto.contractId = record.contractId;
    dto.txid = record.txid;
    dto.amount = record.amount?.toString() ?? record.amount;
    dto.expiresAt = record.expiresAt instanceof Date ? record.expiresAt.toISOString() : record.expiresAt;
    dto.pixCopyPaste = record.pixCopyPaste ?? '';
    dto.qrCodeUrl = record.qrCodeUrl ?? undefined;
    dto.status = record.status;
    return dto;
  }
}
