import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PublicDebtService } from '../payments/public-debt.service';
import { CryptoService } from '../providers/crypto.service';

type Debt = { id: string; contractNumber: string; dueDate: Date | null; amount: string; creditor: { name: string; cnpj: string | null } };
type ChatwootPayload = Record<string, any>;

@Injectable()
export class WhatsAppBotService {
  private readonly logger = new Logger(WhatsAppBotService.name);
  private readonly bedrock: BedrockRuntimeClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly debts: PublicDebtService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {
    this.bedrock = new BedrockRuntimeClient({ region: this.config.get<string>('BEDROCK_REGION') });
  }

  async receive(raw: unknown, tokens: Array<string | undefined>) {
    this.authorize(tokens);
    const payload = raw as ChatwootPayload;
    if (payload?.event !== 'message_created' || payload?.message_type !== 'incoming' || payload?.private) return { accepted: false };
    if (this.configuredInboxId() && String(payload.inbox?.id ?? payload.conversation?.inbox_id ?? '') !== this.configuredInboxId()) return { accepted: false };

    const messageId = String(payload.id ?? '');
    const content = String(payload.content ?? '').trim();
    const chatwootConversationId = String(payload.conversation?.id ?? '');
    const phone = this.phone(payload);
    if (!messageId || !content || !chatwootConversationId || !phone) return { accepted: false };

    const duplicate = await this.prisma.whatsAppBotMessage.findUnique({ where: { externalMessageId: messageId } });
    if (duplicate) return { accepted: true, duplicate: true };

    const accountId = this.config.getOrThrow<string>('WHATSAPP_BOT_ACCOUNT_ID');
    const conversation = await this.prisma.whatsAppBotConversation.upsert({
      where: { conversationKey: phone },
      create: { accountId, conversationKey: phone, chatwootConversationId },
      update: { chatwootConversationId },
    });
    const response = await this.reply(conversation, content, messageId);
    await this.sendToChatwoot(chatwootConversationId, response);
    await this.prisma.whatsAppBotMessage.create({ data: { conversationId: conversation.id, externalMessageId: messageId, response } });
    return { accepted: true };
  }

  private async reply(conversation: any, message: string, messageId: string): Promise<string> {
    const cpf = this.extractCpf(message);
    if (cpf) return this.lookup(conversation, cpf);

    const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (['menu', 'inicio', 'olá', 'ola', 'oi'].includes(normalized)) return this.welcome();

    if (conversation.state === 'AWAITING_ACTION' && conversation.debtorDocumentEncrypted) {
      const debts = (conversation.contracts ?? []) as Debt[];
      const option = this.option(message, debts.length);
      const intent = await this.intent(message);
      if (intent === 'LINK') return this.landingLink(conversation.debtorDocumentEncrypted);
      if ((intent === 'PIX' || option) && debts.length) {
        if (!option && debts.length > 1) return 'Para gerar o pagamento, informe o número da pendência desejada.';
        return this.generatePix(conversation, debts[(option ?? 1) - 1]!, messageId);
      }
    }
    return this.welcome();
  }

  private async lookup(conversation: any, cpf: string) {
    const accountId = this.config.getOrThrow<string>('WHATSAPP_BOT_ACCOUNT_ID');
    const debts = await this.debts.lookup(cpf, accountId) as Debt[];
    const encrypted = this.crypto.encrypt(cpf);
    await this.prisma.whatsAppBotConversation.update({
      where: { id: conversation.id },
      data: { debtorDocumentEncrypted: encrypted, contracts: debts, state: debts.length ? 'AWAITING_ACTION' : 'AWAITING_CPF' },
    });
    if (!debts.length) return 'Não localizei pendências em aberto para este CPF. Se precisar, digite *menu* para reiniciar o atendimento.';
    const list = debts.map((debt, index) => `${index + 1}. ${debt.creditor.name} — contrato ${debt.contractNumber} — R$ ${this.money(debt.amount)}`).join('\n');
    return `Encontrei estas pendências em aberto:\n\n${list}\n\nResponda com o número da pendência e *Pix* para receber o código copia e cola, ou digite *link* para abrir a página de pagamento.`;
  }

  private async generatePix(conversation: any, debt: Debt, messageId: string) {
    try {
      const cpf = this.crypto.decrypt(conversation.debtorDocumentEncrypted);
      const charge = await this.debts.generatePix(debt.id, cpf, `whatsapp:${messageId}`);
      return `Pagamento para ${debt.creditor.name}, contrato ${debt.contractNumber}.\n\nPix copia e cola:\n${charge.pixCopyPaste}\n\nValor: R$ ${this.money(charge.amount)}\nVálido até ${new Date(charge.expiresAt).toLocaleString('pt-BR')}.`;
    } catch (error) {
      this.logger.error('Não foi possível gerar Pix pelo WhatsApp', error instanceof Error ? error.stack : undefined);
      return 'Não consegui gerar o Pix agora. Tente novamente em alguns minutos ou use o link de pagamento.';
    }
  }

  private landingLink(encryptedCpf: string) {
    const url = new URL(this.config.getOrThrow<string>('PUBLIC_PAYMENT_URL'));
    url.searchParams.set('cpf', this.crypto.decrypt(encryptedCpf));
    return `Você pode consultar e gerar seu pagamento por este link seguro:\n${url.toString()}`;
  }

  private welcome() {
    return 'Olá, sou o assistente CobCom e estou realizando seu atendimento. Para consultar pendências, digite seu CPF com 11 números.';
  }

  private async intent(message: string): Promise<'PIX' | 'LINK' | 'UNKNOWN'> {
    const normalized = message.toLowerCase();
    if (/\b(link|site|pagina|página)\b/.test(normalized)) return 'LINK';
    if (/\b(pix|pagar|pagamento|quitar|copia)\b/.test(normalized)) return 'PIX';
    try {
      const command = new ConverseCommand({
        modelId: this.config.getOrThrow<string>('BEDROCK_CHAT_MODEL_ID'),
        messages: [{ role: 'user', content: [{ text: `Classifique a intenção em PIX, LINK ou UNKNOWN. Responda apenas JSON. Mensagem: ${message}` }] }],
        inferenceConfig: { maxTokens: 30, temperature: 0 },
      });
      const output = await this.bedrock.send(command);
      const text = output.output?.message?.content?.map((part) => part.text ?? '').join('') ?? '';
      const intent = JSON.parse(text.match(/\{.*\}/s)?.[0] ?? '{}').intent;
      return intent === 'PIX' || intent === 'LINK' ? intent : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private async sendToChatwoot(conversationId: string, content: string) {
    const base = this.config.get<string>('CHATWOOT_API_URL');
    const token = this.config.get<string>('CHATWOOT_API_ACCESS_TOKEN');
    if (!base || !token) throw new Error('Integração de resposta do Chatwoot não configurada');
    const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/accounts/${this.config.getOrThrow<string>('CHATWOOT_ACCOUNT_ID')}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_access_token: token },
      body: JSON.stringify({ content, message_type: 'outgoing', private: false }),
    });
    if (!response.ok) throw new Error(`Chatwoot recusou a resposta (${response.status})`);
  }

  private authorize(tokens: Array<string | undefined>) {
    const expected = this.config.get<string>('CHATWOOT_WEBHOOK_TOKEN');
    const valid = Boolean(expected) && tokens.some((token) => token && token.length === expected!.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected!)));
    if (!valid) throw new UnauthorizedException('Webhook não autorizado');
  }

  private configuredInboxId() { return this.config.get<string>('CHATWOOT_INBOX_ID') ?? ''; }
  private phone(payload: ChatwootPayload) { return String(payload.sender?.phone_number ?? payload.conversation?.meta?.sender?.phone_number ?? payload.conversation?.contact_inbox?.source_id ?? '').replace(/\D/g, ''); }
  private extractCpf(text: string) { const digits = text.replace(/\D/g, ''); return digits.length === 11 ? digits : null; }
  private option(text: string, count: number) { const found = text.match(/\b([1-9]\d*)\b/)?.[1]; const value = found ? Number(found) : 0; return value >= 1 && value <= count ? value : null; }
  private money(value: string) { return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
