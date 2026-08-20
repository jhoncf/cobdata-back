import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESv2Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new SESv2Client({
      region: this.configService.get<string>('SES_REGION'),
    });
  }

  async sendInvitation(to: string, token: string): Promise<void> {
    const url = `${this.frontendUrl}/activate/${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Convite para acessar o CobCom CRM',
      text: `Você foi convidado para acessar o CobCom CRM. Crie sua senha pelo link: ${url}\n\nEste convite expira em 72 horas.`,
      html: `<p>Você foi convidado para acessar o <strong>CobCom CRM</strong>.</p><p><a href="${url}">Criar minha senha</a></p><p>Este convite expira em 72 horas.</p>`,
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const url = `${this.frontendUrl}/reset-password/${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Redefinição de senha do CobCom CRM',
      text: `Use este link para redefinir sua senha: ${url}\n\nO link expira em uma hora.`,
      html: `<p>Use o link abaixo para redefinir sua senha no <strong>CobCom CRM</strong>.</p><p><a href="${url}">Redefinir minha senha</a></p><p>O link expira em uma hora.</p>`,
    });
  }

  private get frontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL')!.replace(/\/$/, '');
  }

  private async send(message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const from = this.configService.get<string>('SES_FROM_EMAIL');
    if (!from) {
      throw new Error('SES_FROM_EMAIL is not configured');
    }

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: message.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );

    this.logger.log(`Email sent to ${message.to}`);
  }
}
