import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { ProvidersModule } from '../providers/providers.module';
import { AgingOfferJob } from './aging-offer.job';
import { CommunicationRulesJob } from './communication-rules.job';
import { LigueLeadModule } from '../liguelead/liguelead.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
  imports: [ProvidersModule, LigueLeadModule, EmailTemplatesModule],
  controllers: [WalletsController],
  providers: [WalletsService, AgingOfferJob, CommunicationRulesJob],
  exports: [WalletsService],
})
export class WalletsModule {}
