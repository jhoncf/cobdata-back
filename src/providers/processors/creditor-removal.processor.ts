import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../../common/constants/queues';
import { CreditorRemovalService } from '../creditor-removal.service';

@Processor(QUEUES.CREDITOR_REMOVAL)
export class CreditorRemovalProcessor extends WorkerHost {
  constructor(private readonly removals: CreditorRemovalService) { super(); }

  async process(job: Job<{ batchId: string }>) {
    if (job.name === 'validate') return this.removals.validateInBackground(job.data.batchId);
    if (job.name === 'apply') return this.removals.applyInBackground(job.data.batchId);
  }
}
