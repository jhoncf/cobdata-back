import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletsService } from './wallets.service';

/** Refreshes commercial snapshots in the agreed Monday off-hours window. */
@Injectable()
export class AgingOfferJob {
  private readonly logger = new Logger(AgingOfferJob.name);

  constructor(private readonly walletsService: WalletsService) {}

  @Cron('0 2 * * 1', { timeZone: 'America/Sao_Paulo' })
  async refreshWeeklySnapshots(): Promise<void> {
    const result = await this.walletsService.refreshAgingAndOffers();
    this.logger.log(`AgingOfferJob: ${result.agingUpdatedCount} aging snapshot(s), ${result.walletsProcessed} wallet offer refresh(es)`);
  }
}
