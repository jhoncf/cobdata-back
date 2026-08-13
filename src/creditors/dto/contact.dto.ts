import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum ContactType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  WHATSAPP = 'WHATSAPP',
}

export class ContactDto {
  @IsEnum(ContactType)
  type!: ContactType;

  @IsString()
  @IsNotEmpty()
  value!: string;
}
