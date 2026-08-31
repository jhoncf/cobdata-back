import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCnpj } from '../../common/validators/is-cnpj.validator';
import { ContactDto } from './contact.dto';
import { AddressDto } from './address.dto';

export class CreateCreditorDto {
  @ApiProperty({ description: 'Creditor name', example: 'Empresa XYZ Ltda', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'CNPJ (14 numeric digits with valid check digit)', example: '11222333000181' })
  @IsOptional()
  @IsCnpj()
  cnpj?: string;

  @ApiPropertyOptional({ description: 'Contact list (max 10 entries)', type: [ContactDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts?: ContactDto[];

  @ApiPropertyOptional({ description: 'Creditor address', type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ description: 'URL to receive contract status update events', example: 'https://partner.example.com/webhooks/cobcom' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ description: 'Optional shared key. Stored encrypted and sent as Bearer token.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webhookAuthKey?: string;
}
