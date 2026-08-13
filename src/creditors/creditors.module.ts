import { Module } from '@nestjs/common';
import { CreditorsController } from './creditors.controller';
import { CreditorsService } from './creditors.service';

@Module({
  controllers: [CreditorsController],
  providers: [CreditorsService],
  exports: [CreditorsService],
})
export class CreditorsModule {}
