import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token received via email', example: 'abc123-reset-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'New password (min 8 chars, uppercase, lowercase, digit)', example: 'NewP@ss789' })
  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}
