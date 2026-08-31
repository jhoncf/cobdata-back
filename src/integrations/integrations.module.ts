import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ApiKeyGuard } from './api-key.guard';
import { ExternalContractsController } from './external-contracts.controller';
import { ExternalContractsService } from './external-contracts.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationKeysService } from './integration-keys.service';

@Module({
  imports: [PaymentsModule, ContractsModule],
  controllers: [IntegrationsController, ExternalContractsController],
  providers: [IntegrationKeysService, ExternalContractsService, ApiKeyGuard],
})
export class IntegrationsModule {}
