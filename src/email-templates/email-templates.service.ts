import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email';

type TemplateInput = { name: string; subject: string; htmlBody?: string; body?: string; textBody?: string; criteria?: unknown; isDefault?: boolean; isActive?: boolean };

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService, private readonly config: ConfigService) {}

  private async wallet(walletId: string, accountId: string) {
    const wallet = await this.prisma.wallet.findFirst({ where: { id: walletId, accountId, deletedAt: null }, include: { creditor: { select: { name: true } } } });
    if (!wallet) throw new NotFoundException('Carteira não encontrada');
    return wallet;
  }

  async list(walletId: string, accountId: string) {
    await this.wallet(walletId, accountId);
    const templates = await this.prisma.walletEmailTemplate.findMany({ where: { walletId, accountId }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
    return templates.map((template) => this.present(template));
  }

  async save(walletId: string, accountId: string, input: TemplateInput, id?: string) {
    await this.wallet(walletId, accountId);
    const htmlBody = input.htmlBody || `<div style="font-family:Arial,sans-serif;line-height:1.5;white-space:pre-line">${(input.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
    if (!input.name?.trim() || !input.subject?.trim() || !htmlBody.trim()) throw new BadRequestException('Nome, assunto e conteúdo são obrigatórios');
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.walletEmailTemplate.updateMany({ where: { walletId, accountId }, data: { isDefault: false } });
      const data = { name: input.name.trim(), subject: input.subject.trim(), htmlBody, textBody: input.textBody || input.body || null, criteria: input.criteria as any, isDefault: !!input.isDefault, isActive: input.isActive ?? true };
      if (id) {
        const existing = await tx.walletEmailTemplate.findFirst({ where: { id, walletId, accountId } });
        if (!existing) throw new NotFoundException('Template não encontrado');
        return this.present(await tx.walletEmailTemplate.update({ where: { id }, data }));
      }
      return this.present(await tx.walletEmailTemplate.create({ data: { ...data, walletId, accountId } }));
    });
  }

  private present(template: any) {
    return { ...template, body: template.textBody || template.htmlBody.replace(/<[^>]*>/g, '').trim() };
  }

  async remove(walletId: string, accountId: string, id: string) {
    await this.wallet(walletId, accountId);
    const result = await this.prisma.walletEmailTemplate.deleteMany({ where: { id, walletId, accountId } });
    if (!result.count) throw new NotFoundException('Template não encontrado');
  }

  async sendBatch(walletId: string, accountId: string, templateId: string, contractIds: string[]) {
    if (!Array.isArray(contractIds) || !contractIds.length) throw new BadRequestException('Selecione ao menos um contrato');
    const results = await Promise.allSettled(contractIds.map((contractId) => this.send(walletId, accountId, templateId, contractId)));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    if (!sent) throw new BadRequestException('Nenhum e-mail pôde ser enviado');
    return { sent, failed: results.length - sent };
  }

  async send(walletId: string, accountId: string, templateId: string, contractId: string) {
    const [wallet, template, contract] = await Promise.all([
      this.wallet(walletId, accountId),
      this.prisma.walletEmailTemplate.findFirst({ where: { id: templateId, walletId, accountId, isActive: true } }),
      this.prisma.contract.findFirst({ where: { id: contractId, walletId, accountId, deletedAt: null } }),
    ]);
    if (!template) throw new NotFoundException('Template de e-mail não encontrado');
    if (!contract?.debtorEmail) throw new BadRequestException('O contrato não possui e-mail cadastrado');
    if (contract.status !== 'ACTIVE' || contract.paymentStatus === 'PAID') throw new BadRequestException('O contrato não está elegível para comunicação');

    const interaction = await this.prisma.contractInteraction.create({ data: { accountId, walletId, contractId, channel: 'EMAIL', status: 'QUEUED', provider: 'AWS_SES', contact: contract.debtorEmail, summary: `E-mail preparado: ${template.name}`, payload: { templateId, templateName: template.name } } });
    const [open, click, access] = await this.prisma.$transaction(async (tx) => {
      const open = await tx.emailTrackingLink.create({ data: { token: randomUUID(), interactionId: interaction.id, kind: 'OPEN' } });
      const click = await tx.emailTrackingLink.create({ data: { token: randomUUID(), interactionId: interaction.id, kind: 'CLICK' } });
      const access = await tx.publicDebtAccessLink.create({ data: { token: randomUUID(), accountId, walletId, contractId, interactionId: interaction.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
      return [open, click, access] as const;
    });
    const apiUrl = this.config.get<string>('PUBLIC_API_URL') || this.config.get<string>('FRONTEND_URL')!.replace(/\/$/, '') + '/api';
    const appUrl = this.config.get<string>('FRONTEND_URL')!.replace(/\/$/, '');
    const paymentUrl = `${appUrl}/regularize?access=${encodeURIComponent(access.token)}`;
    const clickUrl = `${apiUrl}/email/tracking/click/${click.token}?to=${encodeURIComponent(paymentUrl)}`;
    const pixel = `${apiUrl}/email/tracking/open/${open.token}.gif`;
    const debtorName = contract.debtorName || 'Cliente';
    const paymentButton = `<div style="display:block;text-align:center;margin:24px 0"><a href="${clickUrl}" target="_blank" style="display:inline-block;background:#155dfc;color:#ffffff;text-decoration:none;font:600 16px Arial,sans-serif;padding:15px 24px;border-radius:8px">Ver oferta e gerar Pix</a></div>`;
    const vars: Record<string, string> = { '{{nome_devedor}}': debtorName, '{{devedor_nome}}': debtorName, '{{credor}}': wallet.creditor.name, '{{credor_nome}}': wallet.creditor.name, '{{contrato}}': contract.contractNumber, '{{numero_contrato}}': contract.contractNumber, '{{valor_oferta}}': Number(contract.offerValue ?? contract.updatedValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), '{{link_pagamento}}': paymentButton, '{{botao_pagamento}}': paymentButton };
    const replace = (content: string) => Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(key, value), content);
    const normalizedBody = template.htmlBody.replace(
      /Acesse\s+\{\{(?:link_pagamento|botao_pagamento)\}\}\s+para consultar os detalhes e gerar seu Pix\.?/gi,
      'Acesse sua oferta para consultar os detalhes e gerar seu Pix.<br/><br/>{{botao_pagamento}}',
    );
    const logoUrl = `${appUrl}/cobcom-logo.png`;
    const html = `<!doctype html><html><body style="margin:0;background:#eef3fb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3fb"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(22,47,94,.12)"><tr><td style="padding:22px 32px;background:#0f4eea"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td><a href="https://bm.cobcomvc.com.br/" target="_blank"><img src="${logoUrl}" width="52" height="52" alt="CobCom" style="display:block;border:0;object-fit:contain;background:#ffffff;border-radius:10px;padding:4px" /></a></td><td style="padding-left:14px;color:#ffffff;font:700 20px Arial,sans-serif">CobCom</td></tr></table></td></tr><tr><td style="padding:36px 32px 20px;color:#1d2939;font:16px Arial,sans-serif;line-height:1.65">${replace(normalizedBody)}</td></tr><tr><td style="padding:8px 32px 36px"><p style="margin:0;color:#667085;font:13px Arial,sans-serif;line-height:1.5">A oferta é individual e o acesso é seguro.</p></td></tr><tr><td style="padding:20px 32px;background:#f8fafc;color:#667085;font:12px Arial,sans-serif;line-height:1.6;border-top:1px solid #e4e7ec">COBCOM SOLUCOES LTDA · CNPJ 50.703.286/0001-40<br/><a href="https://bm.cobcomvc.com.br/" target="_blank" style="color:#155dfc;text-decoration:none">bm.cobcomvc.com.br</a></td></tr></table></td></tr></table><img src="${pixel}" width="1" height="1" alt="" style="display:none"/></body></html>`;
    try {
      await this.email.send({ to: contract.debtorEmail, subject: replace(template.subject), text: replace(template.textBody || `Acesse sua oferta: ${clickUrl}`), html });
      await this.prisma.contractInteraction.update({ where: { id: interaction.id }, data: { status: 'SENT', summary: `E-mail enviado: ${template.name}`, payload: { templateId, templateName: template.name, paymentUrl } } });
      return { id: interaction.id, sentTo: contract.debtorEmail };
    } catch (error: any) {
      await this.prisma.contractInteraction.update({ where: { id: interaction.id }, data: { status: 'FAILED', summary: `Falha ao enviar e-mail: ${error?.message || 'erro do SES'}` } });
      throw error;
    }
  }

  async mark(token: string, kind: 'OPEN' | 'CLICK') {
    const link = await this.prisma.emailTrackingLink.findUnique({ where: { token }, include: { interaction: true } });
    if (!link || link.kind !== kind) throw new NotFoundException();
    if (!link.openedAt) await this.prisma.$transaction([
      this.prisma.emailTrackingLink.update({ where: { id: link.id }, data: { openedAt: new Date() } }),
      this.prisma.contractInteraction.update({ where: { id: link.interactionId }, data: { status: 'READ', summary: kind === 'CLICK' ? 'E-mail lido: link de pagamento acessado' : 'E-mail aberto' } }),
    ]);
  }
}
