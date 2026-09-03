import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentGatewaysController } from './payment-gateways.controller';
import { PaymentChargesController } from './payment-charges.controller';
import { PaymentGatewaysService } from './payment-gateways.service';
import { PaymentChargesService } from './payment-charges.service';
import { PaymentProviderFactory, PAYMENT_ADAPTERS_TOKEN } from './adapters/payment-provider.factory';
import { BancoDoBrasilPaymentAdapter } from './adapters/banco-do-brasil/banco-do-brasil-payment.adapter';
import { BancoDoBrasilHttpClient } from './adapters/banco-do-brasil/bb-http-client.service';
import { BancoDoBrasilAuthService } from './adapters/banco-do-brasil/bb-auth.service';
import { SettlementProcessorService } from './settlement/settlement-processor.service';
import { ChargeLifecycleJob } from './charge-lifecycle.job';
import { AgreementLifecycleJob } from './agreement-lifecycle.job';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../providers/crypto.service';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { BbPixWebhookController } from './webhooks/bb-pix-webhook.controller';
import { BbPixWebhookService } from './webhooks/bb-pix-webhook.service';
import { BbWebhookAuthGuard } from './webhooks/bb-webhook-auth.guard';
import { BbWebhookRegistrationService } from './webhooks/bb-webhook-registration.service';
import { PublicDebtController } from './public-debt.controller';
import { PublicDebtService } from './public-debt.service';
import { PublicDebtRateLimitService } from './public-debt-rate-limit.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [AuditModule, forwardRef(() => ProvidersModule), ScheduleModule.forRoot()],
  controllers: [PaymentGatewaysController, PaymentChargesController, BbPixWebhookController, PublicDebtController],
  providers: [
    PaymentGatewaysService,
    PaymentChargesService,
    SettlementProcessorService,
    ChargeLifecycleJob,
    AgreementLifecycleJob,
    PrismaService,
    CryptoService,
    ConfigService,
    BancoDoBrasilPaymentAdapter,
    BancoDoBrasilHttpClient,
    BancoDoBrasilAuthService,
    BbPixWebhookService,
    BbWebhookAuthGuard,
    BbWebhookRegistrationService,
    PublicDebtService,
    PublicDebtRateLimitService,
    {
      provide: PAYMENT_ADAPTERS_TOKEN,
      useFactory: (bbAdapter: BancoDoBrasilPaymentAdapter) => [bbAdapter],
      inject: [BancoDoBrasilPaymentAdapter],
    },
    PaymentProviderFactory,
  ],
  exports: [PaymentGatewaysService, PaymentChargesService, SettlementProcessorService, PublicDebtService],
})
export class PaymentsModule {}
