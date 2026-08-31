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
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsCnpj } from '../../common/validators/is-cnpj.validator';
import { ContactDto } from './contact.dto';
import { AddressDto } from './address.dto';

export class UpdateCreditorDto {
  @ApiPropertyOptional({ description: 'Creditor name', example: 'Empresa XYZ Ltda', maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

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

  @ApiPropertyOptional({ description: 'URL to receive contract status update events' })
  @IsOptional()
  @IsString()
  webhookUrl?: string | null;

  @ApiPropertyOptional({ description: 'Optional shared key. Omit to keep the existing key; send an empty string to remove it.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webhookAuthKey?: string;
}
