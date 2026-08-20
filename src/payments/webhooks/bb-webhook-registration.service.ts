import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGatewayEnvironment, PaymentProviderType } from '../enums';
import { BancoDoBrasilHttpClient } from '../adapters/banco-do-brasil/bb-http-client.service';
import { PIX_API_BASE_URLS } from '../adapters/banco-do-brasil/bb-auth.service';
import { PaymentGatewaysService } from '../payment-gateways.service';

@Injectable()
export class BbWebhookRegistrationService {
  constructor(
    private readonly paymentGatewaysService: PaymentGatewaysService,
    private readonly httpClient: BancoDoBrasilHttpClient,
    private readonly configService: ConfigService,
  ) {}

  async register(gatewayId: string, accountId: string): Promise<{ webhookUrl: string }> {
    const gateway = await this.paymentGatewaysService.findOne(gatewayId, accountId);
    if (gateway.providerType !== PaymentProviderType.BANCO_DO_BRASIL) {
      throw new BadRequestException('The selected gateway is not Banco do Brasil');
    }
    if (!gateway.enabled) {
      throw new BadRequestException('The Banco do Brasil gateway must be enabled');
    }

    const config = await this.paymentGatewaysService.getDecryptedConfig(gatewayId);
    if (!config.pixKey) {
      throw new BadRequestException('A Pix key is required to register the webhook');
    }

    const token = this.configService.get<string>('BB_WEBHOOK_TOKEN');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!token || !frontendUrl) {
      throw new BadRequestException('BB webhook configuration is incomplete');
    }

    const webhookUrl = new URL('/webhooks/banco-do-brasil/pix', frontendUrl);
    webhookUrl.searchParams.set('token', token);

    const baseUrl = PIX_API_BASE_URLS[config.environment as PaymentGatewayEnvironment];
    const result = await this.httpClient.request({
      method: 'PUT',
      url: `${baseUrl}/webhook/${encodeURIComponent(config.pixKey)}`,
      data: { webhookUrl: webhookUrl.toString() },
      gatewayConfig: config,
    });

    if (result.outcome !== 'SUCCESS') {
      throw new BadGatewayException('Banco do Brasil rejected webhook registration');
    }

    return { webhookUrl: webhookUrl.toString() };
  }
}
