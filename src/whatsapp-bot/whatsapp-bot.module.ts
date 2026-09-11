import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ProvidersModule } from '../providers/providers.module';
import { CryptoService } from '../providers/crypto.service';
import { WhatsAppBotController } from './whatsapp-bot.controller';
import { WhatsAppBotService } from './whatsapp-bot.service';

@Module({
  imports: [PaymentsModule, ProvidersModule],
  controllers: [WhatsAppBotController],
  providers: [WhatsAppBotService, CryptoService],
})
export class WhatsAppBotModule {}
