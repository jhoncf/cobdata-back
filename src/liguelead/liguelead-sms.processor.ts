import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../common/constants/queues';
import { LigueLeadService, FilteredSmsJobData } from './liguelead.service';

@Processor(QUEUES.LIGUELEAD_SMS)
export class LigueLeadSmsProcessor extends WorkerHost {
  private readonly logger = new Logger(LigueLeadSmsProcessor.name);

  constructor(private readonly service: LigueLeadService) { super(); }

  async process(job: Job<FilteredSmsJobData>) {
    try {
      return await this.service.sendFilteredSms(job.data);
    } catch (error) {
      this.logger.error(`Falha no disparo SMS filtrado ${job.id}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
