import { Module } from '@nestjs/common';
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
import { QUEUES } from '../common/constants/queues';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.PROVIDER_OPERATION }),
  ],
  controllers: [ProvidersController, WalletMappingsController, OperationsController, WebhooksController],
  providers: [
    ProvidersService,
    WalletMappingsService,
    OperationsService,
    OperationProcessor,
    WebhooksService,
    SerasaLnopAdapter,
    CryptoService,
  ],
  exports: [ProvidersService, WalletMappingsService, OperationsService, SerasaLnopAdapter, WebhooksService],
})
export class ProvidersModule {}
