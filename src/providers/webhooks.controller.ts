import {
  Controller,
  Post,
  Req,
  Res,
  Query,
  Param,
  HttpCode,
  RawBodyRequest,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { WebhooksService, WebhookPayload } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks')
@Public()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('serasa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive Serasa LNOP webhook', description: 'Endpoint to receive provider webhook notifications (no JWT auth, validated via HMAC signature)' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body or missing raw body' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  async handleSerasaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Query('token') token?: string,
  ): Promise<void> {
    return this.processSerasaWebhook(req, res, token);
  }

  /**
   * Path-token variant for providers whose webhook UI strips query strings
   * during endpoint validation. The token is still validated server-side.
   */
  @Post('serasa/token/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive Serasa LNOP webhook (path token)' })
  async handleSerasaWebhookWithPathToken(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Param('token') token: string,
  ): Promise<void> {
    return this.processSerasaWebhook(req, res, token);
  }

  private async processSerasaWebhook(
    req: RawBodyRequest<Request>,
    res: Response,
    token?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const rawBody = req.rawBody;
      if (!rawBody) {
        res.status(400).json({ message: 'Raw body not available' });
        return;
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        } else if (Array.isArray(value) && value[0] !== undefined) {
          headers[key] = value[0];
        }
      }

      let payload: WebhookPayload;
      try {
        payload = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        res.status(400).json({ message: 'Invalid JSON body' });
        return;
      }

      const result = await this.webhooksService.handleWebhook(
        headers,
        rawBody,
        payload,
        token,
      );

      const elapsed = Date.now() - startTime;
      this.logger.debug(`Webhook processed in ${elapsed}ms`);

      res.status(result.status).json({ message: result.message });
    } catch (error: any) {
      if (error?.status === 401) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      this.logger.error(`Webhook processing error: ${error?.message}`);
      res.status(200).json({ message: 'OK' });
    }
  }
}
