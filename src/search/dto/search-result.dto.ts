import { ApiProperty } from '@nestjs/swagger';

export class CreditorSearchItem {
  @ApiProperty({ description: 'Creditor unique identifier', example: 'clx1abc2d0001' })
  id!: string;

  @ApiProperty({ description: 'Creditor name', example: 'Empresa XYZ Ltda' })
  name!: string;

  @ApiProperty({ description: 'CNPJ formatted as XX.XXX.XXX/XXXX-XX', example: '11.222.333/0001-81' })
  cnpj!: string;
}

export class WalletSearchItem {
  @ApiProperty({ description: 'Wallet unique identifier', example: 'clx2def3e0002' })
  id!: string;

  @ApiProperty({ description: 'Wallet name', example: 'Carteira Principal' })
  name!: string;

  @ApiProperty({ description: 'Name of the creditor that owns this wallet', example: 'Empresa XYZ Ltda' })
  creditorName!: string;
}

export class ContractSearchItem {
  @ApiProperty({ description: 'Contract unique identifier', example: 'clx3ghi4f0003' })
  id!: string;

  @ApiProperty({ description: 'Contract number', example: 'CTR-2024-00123' })
  contractNumber!: string;

  @ApiProperty({ description: 'Debtor full name', example: 'João da Silva' })
  debtorName!: string;

  @ApiProperty({ description: 'Original debt value in BRL', example: 1500.0 })
  originalValue!: number;

  @ApiProperty({ description: 'Updated (current) debt value in BRL', example: 1750.5 })
  updatedValue!: number;

  @ApiProperty({ description: 'Name of the creditor (resolved via wallet)', example: 'Empresa XYZ Ltda' })
  creditorName!: string;
}

export class SearchResultDto {
  @ApiProperty({ description: 'Matching creditors (max 5)', type: [CreditorSearchItem] })
  creditors!: CreditorSearchItem[];

  @ApiProperty({ description: 'Matching wallets (max 5)', type: [WalletSearchItem] })
  wallets!: WalletSearchItem[];

  @ApiProperty({ description: 'Matching contracts (max 5)', type: [ContractSearchItem] })
  contracts!: ContractSearchItem[];
}
