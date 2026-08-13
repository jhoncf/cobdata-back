import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CreditorsModule } from './creditors/creditors.module';
import { WalletsModule } from './wallets/wallets.module';
import { ContractsModule } from './contracts/contracts.module';
import { ImportsModule } from './imports/imports.module';
import { ProvidersModule } from './providers/providers.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard, RolesGuard, ScopeGuard, MustResetPasswordGuard } from './common/guards';
import { AuditInterceptor } from './common/interceptors';
import { RequestIdMiddleware } from './common/middleware';
import { validate } from './config/env.validation';
import { QUEUES } from './common/constants/queues';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUES.IMPORT_VALIDATION },
      { name: QUEUES.IMPORT_APPLICATION },
      { name: QUEUES.PROVIDER_OPERATION },
    ),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CreditorsModule,
    WalletsModule,
    ContractsModule,
    ImportsModule,
    ProvidersModule,
    AuditModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopeGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MustResetPasswordGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
