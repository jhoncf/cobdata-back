import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { WalletMappingsController } from './wallet-mappings.controller';
import { WalletMappingsService } from './wallet-mappings.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationProcessor } from './processors/operation.processor';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SerasaLnopAdapter } from './adapters/serasa-lnop.adapter';
import { CryptoService } from './crypto.service';
import { SerasaWalletsController } from './serasa-wallets.controller';
import { SerasaWalletsService } from './serasa-wallets.service';
import { QUEUES } from '../common/constants/queues';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    forwardRef(() => PaymentsModule),
    BullModule.registerQueue({ name: QUEUES.PROVIDER_OPERATION }),
  ],
  controllers: [ProvidersController, WalletMappingsController, OperationsController, WebhooksController, SerasaWalletsController],
  providers: [
    ProvidersService,
    WalletMappingsService,
    OperationsService,
    OperationProcessor,
    WebhooksService,
    SerasaLnopAdapter,
    CryptoService,
    SerasaWalletsService,
  ],
  exports: [ProvidersService, WalletMappingsService, OperationsService, SerasaLnopAdapter, WebhooksService, SerasaWalletsService],
})
export class ProvidersModule {}
