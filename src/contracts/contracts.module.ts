import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { DeduplicationService } from './deduplication.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [ContractsController, TagsController],
  providers: [ContractsService, DeduplicationService, TagsService],
  exports: [ContractsService, DeduplicationService, TagsService],
})
export class ContractsModule {}
