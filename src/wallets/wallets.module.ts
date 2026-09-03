import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { ProvidersModule } from '../providers/providers.module';
import { AgingOfferJob } from './aging-offer.job';

@Module({
  imports: [ProvidersModule],
  controllers: [WalletsController],
  providers: [WalletsService, AgingOfferJob],
  exports: [WalletsService],
})
export class WalletsModule {}
