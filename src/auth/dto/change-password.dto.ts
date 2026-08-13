import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current user password', example: 'OldP@ss123' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ description: 'New password (min 8 chars, uppercase, lowercase, digit)', example: 'NewP@ss456' })
  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}
