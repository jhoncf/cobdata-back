import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsUUID, Min, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ContractStatus, OperationAction, PaymentStatus, SerasaStatus } from '@prisma/client';

export class CreateOperationDto {
  @ApiProperty({ description: 'Wallet ID to create the operation for', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ description: 'Operation action type', enum: ['CREATE_OR_UPDATE', 'REMOVE'], example: 'CREATE_OR_UPDATE' })
  @IsEnum(OperationAction)
  action!: OperationAction;

  @IsOptional() @IsEnum(ContractStatus) contractStatus?: ContractStatus;
  @IsOptional() @IsEnum(SerasaStatus) serasaStatus?: SerasaStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() installmentOnly?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) minOriginalValue?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) maxOriginalValue?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) minUpdatedValue?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) maxUpdatedValue?: number;
  @IsOptional() @IsIn(['gt', 'lt', 'eq']) updatedValueOperator?: 'gt' | 'lt' | 'eq';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) updatedValue?: number;
  @IsOptional() @IsIn(['gt', 'lt', 'eq']) offerValueOperator?: 'gt' | 'lt' | 'eq';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) offerValue?: number;
  @IsOptional() @IsIn(['gt', 'lt', 'eq']) agingOperator?: 'gt' | 'lt' | 'eq';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) aging?: number;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
