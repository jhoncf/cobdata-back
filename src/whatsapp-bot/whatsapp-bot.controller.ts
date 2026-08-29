import { Body, Controller, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { WhatsAppBotService } from './whatsapp-bot.service';

@Public()
@Controller('webhooks/chatwoot')
export class WhatsAppBotController {
  constructor(private readonly bot: WhatsAppBotService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Body() payload: unknown,
    @Headers('x-chatwoot-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ) {
    return this.bot.receive(payload, [headerToken, queryToken]);
  }
}
