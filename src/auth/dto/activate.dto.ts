import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActivateDto {
  @ApiProperty({ description: 'Invitation token received via email', example: 'invite-token-uuid' })
  @IsString()
  @IsNotEmpty({ message: 'Token must not be empty' })
  token!: string;

  @ApiProperty({ description: 'Password to set for the new account (min 8 chars, uppercase, lowercase, digit)', example: 'MyP@ssw0rd' })
  @IsString()
  @IsNotEmpty({ message: 'Password must not be empty' })
  password!: string;
}
