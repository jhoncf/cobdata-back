import {
  Controller,
  Post,
  Body,
  HttpCode,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { BbWebhookAuthGuard } from './bb-webhook-auth.guard';
import { BbPixWebhookService, BbPixWebhookPayload } from './bb-pix-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks/banco-do-brasil')
@Public()
export class BbPixWebhookController {
  private readonly logger = new Logger(BbPixWebhookController.name);

  constructor(private readonly bbPixWebhookService: BbPixWebhookService) {}

  /**
   * Receives Pix payment confirmations from Banco do Brasil.
   * Public endpoint (no JWT) — protected by IP whitelist guard.
   * Always returns 200 OK as required by BB API spec.
   */
  @Post('pix')
  @HttpCode(200)
  @UseGuards(BbWebhookAuthGuard)
  @ApiOperation({
    summary: 'Receive BB Pix webhook',
    description:
      'Public endpoint for Banco do Brasil to notify Pix payment confirmations. Always responds 200.',
  })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Unauthorized — IP not in whitelist' })
  async handlePixWebhook(@Body() payload: BbPixWebhookPayload): Promise<{ message: string }> {
    this.logger.debug(
      `BB Pix webhook received with ${payload?.pix?.length ?? 0} entries`,
    );

    try {
      await this.bbPixWebhookService.processPixWebhook(payload);
    } catch (error) {
      // Never fail the webhook response — BB expects 200 always
      this.logger.error(
        `Unhandled error processing BB Pix webhook: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return { message: 'OK' };
  }
}
