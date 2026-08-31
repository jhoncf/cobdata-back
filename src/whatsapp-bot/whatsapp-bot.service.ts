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
    const responses = await this.reply(conversation, content, messageId);
    for (let index = 0; index < responses.length; index += 1) {
      await this.sendToChatwoot(chatwootConversationId, responses[index]!);
      // Chatwoot entrega cada saída de forma assíncrona à ponte WhatsApp.
      // A pequena espera preserva a ordem: instrução, Pix copia e cola, link final.
      if (index < responses.length - 1) await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await this.prisma.whatsAppBotMessage.create({ data: { conversationId: conversation.id, externalMessageId: messageId, response: responses.join('\n\n---\n\n') } });
    return { accepted: true };
  }

  private async reply(conversation: any, message: string, messageId: string): Promise<string[]> {
    const cpf = this.extractCpf(message);
    const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (['menu', 'inicio', 'olá', 'ola', 'oi'].includes(normalized)) {
      await this.prisma.whatsAppBotConversation.update({ where: { id: conversation.id }, data: { state: 'AWAITING_CPF', debtorDocumentEncrypted: null, contracts: undefined } });
      return [this.welcome()];
    }

    if (cpf) {
      return this.lookup(conversation, cpf);
    }
    if (conversation.state === 'AWAITING_CPF') {
      if (normalized === '1' || /divida|pendencia|consult/.test(normalized)) return ['Informe seu CPF com 11 números.'];
      if (normalized === '2' || /cobcom|soluc/.test(normalized)) return [this.about()];
      return [this.welcome()];
    }
    if (conversation.state === 'AWAITING_ACTION' && conversation.debtorDocumentEncrypted) {
      const debts = (conversation.contracts ?? []) as Debt[];
      const option = this.option(message, debts.length);
      const intent = await this.intent(message);
      const selected = debts[(option ?? 1) - 1];
      if (/nao reconhe|não reconhe|contest/.test(normalized) && selected) return this.dispute(selected.id, this.phoneFromConversation(conversation));
      if (/detalh|mais inform/.test(normalized) && selected) return this.details(selected.id);
      if (intent === 'LINK') return [this.landingLink(conversation.debtorDocumentEncrypted)];
      if ((intent === 'PIX' || option) && debts.length) {
        if (!option && debts.length > 1) return ['Para gerar o pagamento, informe o número da pendência desejada.'];
        return this.generatePix(conversation, debts[(option ?? 1) - 1]!, messageId);
      }
    }
    return ['Escolha uma opção: *negociar*, *não reconheço* ou *detalhes*.'];
  }

  private async lookup(conversation: any, cpf: string) {
    const accountId = this.config.getOrThrow<string>('WHATSAPP_BOT_ACCOUNT_ID');
    const debts = await this.debts.lookup(cpf, accountId) as Debt[];
    const encrypted = this.crypto.encrypt(cpf);
    await this.prisma.whatsAppBotConversation.update({
      where: { id: conversation.id },
      data: { debtorDocumentEncrypted: encrypted, contracts: debts, state: debts.length ? 'AWAITING_ACTION' : 'AWAITING_CPF' },
    });
    if (!debts.length) return ['Não localizei pendências em aberto para este CPF. Se precisar, digite *menu* para reiniciar o atendimento.'];
    const list = debts.map((debt, index) => {
      const dueDate = debt.dueDate ? ` — vencimento ${new Date(debt.dueDate).toLocaleDateString('pt-BR')}` : '';
      return `${index + 1}. ${debt.creditor.name} — contrato ${debt.contractNumber} — R$ ${this.money(debt.amount)}${dueDate}`;
    }).join('\n');
    return [`Encontrei estas pendências em aberto:\n\n${list}\n\nResponda com o número da pendência e *Pix* para receber o código copia e cola. Para contestar ou ver dados completos, responda *não reconheço* ou *detalhes*.`];
  }

  private async generatePix(conversation: any, debt: Debt, messageId: string) {
    try {
      const cpf = this.crypto.decrypt(conversation.debtorDocumentEncrypted);
      const contract = await this.prisma.contract.findUnique({ where: { id: debt.id }, select: { offer: true } });
      const charge = await this.debts.generatePix(debt.id, cpf, `whatsapp:${messageId}`);
      if (!charge.pixCopyPaste) throw new Error('Cobrança Pix criada sem código copia e cola');
      const expiration = charge.expiresAt ? new Date(charge.expiresAt).toLocaleString('pt-BR') : 'o prazo informado na cobrança';
      const offer = this.offerMessage(contract?.offer, charge.amount.toString());
      return [
        `Pagamento para ${debt.creditor.name}, contrato ${debt.contractNumber}.\n${offer}\nVálido até ${expiration}.\n\nA próxima mensagem contém somente o código Pix para facilitar a cópia.`,
        charge.pixCopyPaste,
        this.landingLink(conversation.debtorDocumentEncrypted),
      ];
    } catch (error) {
      this.logger.error('Não foi possível gerar Pix pelo WhatsApp', error instanceof Error ? error.stack : undefined);
      return ['Não consegui gerar o Pix agora. Tente novamente em alguns minutos ou use o link de pagamento.', this.landingLink(conversation.debtorDocumentEncrypted)];
    }
  }

  private landingLink(encryptedCpf: string) {
    const url = new URL(this.config.getOrThrow<string>('PUBLIC_PAYMENT_URL'));
    url.searchParams.set('cpf', this.crypto.decrypt(encryptedCpf));
    return `Você pode consultar e gerar seu pagamento por este link seguro:\n${url.toString()}`;
  }

  private welcome() {
    return 'Olá! 👋 Seja bem-vindo à CobCom.\nSou o assistente virtual e estou aqui para ajudá-lo.\n\nComo posso ajudar hoje?\n\n1. Consultar minhas dívidas\n2. Conhecer a CobCom e nossas soluções';
  }

  private about() { return 'A CobCom é especializada em gestão e recuperação de créditos por meio de tecnologia, inteligência de dados e negociação digital. Nosso time comercial entrará em contato em breve.'; }

  private offerMessage(raw: unknown, fallback: string) {
    const offer = raw as Record<string, unknown> | null;
    if (!offer || typeof offer !== 'object') return `Valor à vista: R$ ${this.money(fallback)}`;
    const total = typeof offer.totalValue === 'number' ? offer.totalValue : Number(fallback);
    const discount = typeof offer.discountPercentage === 'number' ? `\nDesconto aplicado: ${offer.discountPercentage}%` : '';
    const installments = typeof offer.installments === 'number' && typeof offer.installmentValue === 'number' ? `\nParcelamento disponível: ${offer.installments}x de R$ ${this.money(String(offer.installmentValue))}` : '';
    return `Valor à vista: R$ ${this.money(String(total))}${discount}${installments}`;
  }

  private async dispute(contractId: string, contact: string): Promise<string[]> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, include: { wallet: { include: { creditor: true } } } });
    if (!contract) return ['Não localizei esta pendência.'];
    await this.prisma.contractInteraction.create({ data: { accountId: contract.accountId, walletId: contract.walletId, contractId, channel: 'WHATSAPP', status: 'ANSWERED', provider: 'chatwoot', contact, summary: 'Titular informou não reconhecer a dívida.' } });
    return [`Registrei sua manifestação sobre o contrato ${contract.contractNumber}. Sua solicitação será analisada e, se necessário, um responsável poderá entrar em contato. A CobCom realiza a gestão da cobrança; contratação, contestação e documentos devem ser tratados diretamente com a empresa credora.`, this.contacts(contract.wallet.creditor.name, contract.wallet.creditor.contacts)];
  }

  private async details(contractId: string): Promise<string[]> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, include: { wallet: { include: { creditor: true } } } });
    if (!contract) return ['Não localizei esta pendência.'];
    const original = Number(contract.originalValue), updated = Number(contract.updatedValue);
    return [`Detalhes da pendência:\n\nCredor: ${contract.wallet.creditor.name}\nCNPJ: ${contract.wallet.creditor.cnpj ?? 'não informado'}\nContrato: ${contract.contractNumber}\nProduto/serviço: ${contract.productName ?? 'não informado'}\nValor original: R$ ${this.money(String(original))}\nEncargos (juros e multa não discriminados): R$ ${this.money(String(updated - original))}\nValor atualizado: R$ ${this.money(String(updated))}\nVencimento: ${contract.dueDate?.toLocaleDateString('pt-BR') ?? 'não informado'}\nSituação: Em aberto.`, this.contacts(contract.wallet.creditor.name, contract.wallet.creditor.contacts)];
  }

  private contacts(creditor: string, value: any) { if (!value || !Object.keys(value).length) return `Você está no canal oficial de atendimento da CobCom. Não há contatos adicionais cadastrados pela empresa credora ${creditor}.`; return `Canais oficiais de ${creditor}:\n${Object.entries(value).filter(([, v]) => v).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}`; }
  private phoneFromConversation(conversation: any) { return conversation.conversationKey ?? ''; }

  private async intent(message: string): Promise<'PIX' | 'LINK' | 'UNKNOWN'> {
    const normalized = message.toLowerCase();
    if (/\b(link|site|pagina|página)\b/.test(normalized)) return 'LINK';
    if (/\b(pix|pagar|pagamento|quitar|copia|negociar|negociacao)\b/.test(normalized)) return 'PIX';
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
  private extractCpf(text: string) {
    const cpf = text.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return null;
    const validDigit = (length: number) => {
      const sum = cpf.slice(0, length).split('').reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return validDigit(9) === Number(cpf[9]) && validDigit(10) === Number(cpf[10]) ? cpf : null;
  }
  private option(text: string, count: number) { const found = text.match(/\b([1-9]\d*)\b/)?.[1]; const value = found ? Number(found) : 0; return value >= 1 && value <= count ? value : null; }
  private money(value: string) { return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
