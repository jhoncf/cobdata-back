import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class PublicDebtLookupDto {
  @IsString()
  @IsNotEmpty()
  debtorDocument!: string;
}

export class PublicPixRequestDto extends PublicDebtLookupDto {
  @IsUUID()
  contractId!: string;
}
