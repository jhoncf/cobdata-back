import { IsEmail, IsEnum, IsOptional, IsArray, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class InviteUserDto {
  @ApiProperty({ description: 'Email address for the invited user', example: 'newuser@example.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email!: string;

  @ApiProperty({ description: 'Role to assign to the user', enum: ['ADMIN', 'OPERATIONAL', 'VIEWER'], example: 'OPERATIONAL' })
  @IsEnum(Role, { message: 'Role must be one of: ADMIN, OPERATIONAL, VIEWER' })
  role!: Role;

  @ApiPropertyOptional({ description: 'Wallet IDs the user can access (for VIEWER role)', example: ['uuid-wallet-1', 'uuid-wallet-2'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}
