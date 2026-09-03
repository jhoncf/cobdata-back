import { Module } from '@nestjs/common';
import { CreditorsController } from './creditors.controller';
import { CreditorsService } from './creditors.service';
import { CreditorWebhookService } from './creditor-webhook.service';
import { UsersModule } from '../users/users.module';

@Module({
  controllers: [CreditorsController],
  imports: [UsersModule],
  providers: [CreditorsService, CreditorWebhookService],
  exports: [CreditorsService, CreditorWebhookService],
})
export class CreditorsModule {}
