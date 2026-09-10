import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContractsModule } from '../contracts/contracts.module';
import { QUEUES } from '../common/constants/queues';
import { LigueLeadSmsProcessor } from './liguelead-sms.processor';
import { LigueLeadController } from './liguelead.controller';
import { LigueLeadService } from './liguelead.service';
@Module({ imports: [ContractsModule, BullModule.registerQueue({ name: QUEUES.LIGUELEAD_SMS })], controllers: [LigueLeadController], providers: [LigueLeadService, LigueLeadSmsProcessor] })
export class LigueLeadModule {}
