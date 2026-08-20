import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for generating a Pix charge by debtor document (CPF/CNPJ)
 * for external channels (landing page, WhatsApp, chatbot).
 */
export class GeneratePixByDocumentDto {
  @ApiProperty({
    description: 'Debtor CPF or CNPJ (with or without punctuation)',
    example: '123.456.789-00',
  })
  @IsString()
  @IsNotEmpty()
  debtorDocument!: string;

  @ApiProperty({
    description: 'Contract number (business reference)',
    example: 'CTR-2024-001234',
  })
  @IsString()
  @IsNotEmpty()
  contractNumber!: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate charges',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
