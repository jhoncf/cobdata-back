import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EmailModule } from '../common/email';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  PasswordService,
  PasswordResetService,
  RateLimitService,
  SessionService,
  TokenService,
} from './services';

@Module({
  imports: [
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') as any) ?? '15m',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    AuthService,
    PasswordService,
    PasswordResetService,
    RateLimitService,
    SessionService,
    TokenService,
  ],
  exports: [JwtModule, AuthService, PasswordService, PasswordResetService, SessionService, TokenService],
})
export class AuthModule {}
