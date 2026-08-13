import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email!: string;

  @ApiProperty({ description: 'User password', example: 'MyP@ssw0rd' })
  @IsString()
  @IsNotEmpty({ message: 'Password must not be empty' })
  password!: string;
}
