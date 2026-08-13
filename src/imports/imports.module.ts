import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ValidationProcessor } from './processors/validation.processor';
import { ApplicationProcessor } from './processors/application.processor';
import { ContractsModule } from '../contracts/contracts.module';
import { QUEUES } from '../common/constants/queues';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.IMPORT_VALIDATION }),
    BullModule.registerQueue({ name: QUEUES.IMPORT_APPLICATION }),
    ContractsModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ValidationProcessor, ApplicationProcessor],
  exports: [ImportsService],
})
export class ImportsModule {}
