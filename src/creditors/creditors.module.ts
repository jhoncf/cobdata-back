import { Module } from '@nestjs/common';
import { CreditorsController } from './creditors.controller';
import { CreditorsService } from './creditors.service';
import { CreditorWebhookService } from './creditor-webhook.service';

@Module({
  controllers: [CreditorsController],
  providers: [CreditorsService, CreditorWebhookService],
  exports: [CreditorsService, CreditorWebhookService],
})
export class CreditorsModule {}
