import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsNumberString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../enums';

/**
 * DTO for creating a payment charge via CRM (generic issuance).
 * Accepts gateway reference, method, amount, dueDate and idempotencyKey.
 */
export class CreatePaymentChargeDto {
  @ApiProperty({
    description: 'Payment gateway ID to issue the charge through',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  paymentGatewayId!: string;

  @ApiProperty({
    description: 'Payment method (BOLETO, PIX, or BOLEPIX)',
    enum: PaymentMethod,
    example: PaymentMethod.PIX,
  })
  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  method!: PaymentMethod;

  @ApiProperty({
    description: 'Charge amount in BRL (positive decimal string)',
    example: '150.00',
  })
  @IsNumberString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({
    description: 'Due date for the charge (ISO 8601)',
    example: '2025-01-30',
  })
  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate charges (UUID v4 recommended)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
