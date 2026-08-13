import { IsOptional, IsEnum, IsBoolean, IsArray, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'New role for the user', enum: ['ADMIN', 'OPERATIONAL', 'VIEWER'], example: 'VIEWER' })
  @IsOptional()
  @IsEnum(Role, { message: 'Role must be one of: ADMIN, OPERATIONAL, VIEWER' })
  role?: Role;

  @ApiPropertyOptional({ description: 'Whether the user is active', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Wallet IDs the user can access (for VIEWER role)', example: ['uuid-wallet-1'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}
