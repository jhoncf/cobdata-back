import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SendLigueLeadCallsDto, SendLigueLeadSmsDto, UpsertLigueLeadAgentDto } from './dto';

@Injectable()
export class LigueLeadService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private credentials() {
    const apiToken = this.config.get<string>('LIGUELEAD_API_TOKEN');
    const appId = this.config.get<string>('LIGUELEAD_APP_ID');
    if (!apiToken || !appId) throw new ServiceUnavailableException('Integração LigueLead não configurada');
    return { 'api-token': apiToken, 'app-id': appId, 'Content-Type': 'application/json' };
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.get<number>('LIGUELEAD_TIMEOUT') ?? 30000);
    try {
      const response = await fetch(`${this.config.get<string>('LIGUELEAD_API_URL')}${path}`, { ...init, headers: { ...this.credentials(), ...init.headers }, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new BadGatewayException(body?.message || 'Falha na comunicação com a LigueLead');
      return body;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new BadGatewayException('Não foi possível comunicar com a LigueLead');
    } finally { clearTimeout(timer); }
  }

  private async wallet(walletId: string, accountId: string, scopes?: string[]) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, accountId, deletedAt: null },
      include: { creditor: { select: { name: true } } },
    });
    if (!wallet) throw new NotFoundException('Carteira não encontrada');
    if (scopes && !scopes.includes(walletId)) throw new ForbiddenException('Sem permissão para esta carteira');
    return wallet;
  }

  async getAgent(walletId: string, accountId: string, scopes?: string[]) {
    await this.wallet(walletId, accountId, scopes);
    return this.prisma.ligueLeadWalletAgent.findUnique({ where: { walletId } });
  }

  async listVoices() { return this.request('/v1/voice-agent/voices', { method: 'GET' }); }

  async upsertAgent(walletId: string, accountId: string, dto: UpsertLigueLeadAgentDto, scopes?: string[]) {
    await this.wallet(walletId, accountId, scopes);
    const payload: Record<string, unknown> = { name: dto.name, prompt: dto.prompt, greetings: dto.greetings, engine: { version: dto.modelVersion, voice_id: dto.voiceId } };
    const existing = await this.prisma.ligueLeadWalletAgent.findUnique({ where: { walletId } });
    const remote = await this.request(existing ? `/v1/voice-agent/${existing.externalId}` : '/v1/voice-agent', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const externalId = remote?.data?.id ?? remote?.id ?? existing?.externalId;
    if (!externalId) throw new BadGatewayException('A LigueLead não retornou o identificador do agente');
    return this.prisma.ligueLeadWalletAgent.upsert({ where: { walletId }, create: { accountId, walletId, externalId, name: dto.name, prompt: dto.prompt, greetings: dto.greetings, modelVersion: dto.modelVersion, voiceId: dto.voiceId, active: dto.active ?? true }, update: { externalId, name: dto.name, prompt: dto.prompt, greetings: dto.greetings, modelVersion: dto.modelVersion, voiceId: dto.voiceId, active: dto.active ?? true } });
  }

  private async eligibleContracts(walletId: string, accountId: string, ids: string[]) {
    const contracts = await this.prisma.contract.findMany({ where: { id: { in: ids }, walletId, accountId, deletedAt: null, paymentStatus: { not: 'PAID' }, status: 'ACTIVE', debtorPhone: { not: null } }, select: { id: true, contractNumber: true, debtorName: true, debtorDocument: true, debtorPhone: true, originalValue: true, updatedValue: true } });
    if (contracts.length !== ids.length) throw new BadRequestException('Selecione apenas contratos ativos, não pagos e com telefone informado');
    return contracts;
  }

  async sendSms(walletId: string, accountId: string, userId: string, dto: SendLigueLeadSmsDto, scopes?: string[]) {
    await this.wallet(walletId, accountId, scopes);
    const contracts = await this.eligibleContracts(walletId, accountId, dto.contractIds);
    const remote = await this.request('/v1/sms', { method: 'POST', body: JSON.stringify({ title: dto.title, message: dto.message, phones: contracts.map(c => c.debtorPhone) }) });
    const externalId = remote?.data?.campaign_id ?? remote?.campaign_id;
    return this.createDispatchWithInteractions({
      accountId, walletId, userId, type: 'SMS', title: dto.title, externalId, channel: 'SMS', contracts,
    });
  }

  async sendCalls(walletId: string, accountId: string, userId: string, dto: SendLigueLeadCallsDto, scopes?: string[]) {
    const wallet = await this.wallet(walletId, accountId, scopes);
    const agent = await this.prisma.ligueLeadWalletAgent.findUnique({ where: { walletId } });
    if (!agent?.active) throw new BadRequestException('Configure e ative o agente de IA desta carteira antes de disparar ligações');
    const contracts = await this.eligibleContracts(walletId, accountId, dto.contractIds);
    const payload = {
      title: dto.title,
      voice_agent_id: agent.externalId,
      phones: contracts.map((contract) => ({
        phone: contract.debtorPhone,
        call_context: [
          `Credor: ${wallet.creditor?.name ?? 'não informado'}`,
          `Nome do titular: ${contract.debtorName ?? 'não informado'}`,
          `CPF para confirmação interna: ${contract.debtorDocument}`,
          `Contrato: ${contract.contractNumber}`,
          `Único valor autorizado para informar (valor atualizado): ${this.currencyInWords(contract.updatedValue ?? contract.originalValue)}`,
        ].join('; '),
      })),
      ...(dto.retryAttempts
        ? { retry_attempts: dto.retryAttempts, retry_interval_min: dto.retryIntervalMin ?? 30 }
        : {}),
    };
    const remote = await this.request('/v1/voice-agent/call', { method: 'POST', body: JSON.stringify(payload) });
    const externalId = remote?.data?.campaign_id ?? remote?.campaign_id;
    return this.createDispatchWithInteractions({
      accountId, walletId, userId, type: 'AI_CALL', title: dto.title, externalId, channel: 'AI_VOICE_CALL', contracts,
    });
  }

  private async createDispatchWithInteractions({ accountId, walletId, userId, type, title, externalId, channel, contracts }: {
    accountId: string; walletId: string; userId: string; type: 'SMS' | 'AI_CALL'; title: string; externalId?: string;
    channel: 'SMS' | 'AI_VOICE_CALL'; contracts: Array<{ id: string; debtorPhone: string | null }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const dispatch = await tx.ligueLeadDispatch.create({
        data: {
          accountId, walletId, userId, type, title, externalId, totalItems: contracts.length,
          items: { create: contracts.map((contract) => ({ contractId: contract.id, phone: this.normalizePhone(contract.debtorPhone!), externalCampaignId: externalId })) },
        },
      });
      await tx.contractInteraction.createMany({
        data: contracts.map((contract) => ({
          accountId,
          walletId,
          contractId: contract.id,
          channel,
          status: 'QUEUED',
          provider: 'LIGUELEAD',
          externalId,
          contact: this.normalizePhone(contract.debtorPhone!),
          summary: type === 'SMS' ? 'SMS enviado para processamento' : 'Ligação com IA enviada para processamento',
        })),
      });
      return dispatch;
    });
  }

  private currencyInWords(value: unknown) {
    const totalCents = Math.round(Number(value) * 100);
    const reais = Math.floor(totalCents / 100);
    const centavos = totalCents % 100;
    const result = `${this.numberInWords(reais)} ${reais === 1 ? 'real' : 'reais'}`;
    return centavos ? `${result} e ${this.numberInWords(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}` : result;
  }

  private numberInWords(value: number): string {
    if (value === 0) return 'zero';
    const units = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
    const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    const belowThousand = (number: number): string => {
      if (number === 100) return 'cem';
      const parts: string[] = [];
      if (number >= 100) parts.push(hundreds[Math.floor(number / 100)]!);
      const remaining = number % 100;
      if (remaining >= 20) {
        parts.push(tens[Math.floor(remaining / 10)]!);
        if (remaining % 10) parts.push(units[remaining % 10]!);
      } else if (remaining >= 10) parts.push(teens[remaining - 10]!);
      else if (remaining) parts.push(units[remaining]!);
      return parts.join(' e ');
    };
    if (value < 1000) return belowThousand(value);
    if (value < 1_000_000) {
      const thousands = Math.floor(value / 1000);
      const remainder = value % 1000;
      const prefix = thousands === 1 ? 'mil' : `${belowThousand(thousands)} mil`;
      return remainder ? `${prefix} e ${belowThousand(remainder)}` : prefix;
    }
    return new Intl.NumberFormat('pt-BR').format(value);
  }

  private normalizePhone(phone: string) { return phone.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, ''); }

  async processWebhook(token: string | undefined, payload: any) {
    const expected = this.config.get<string>('LIGUELEAD_WEBHOOK_TOKEN');
    if (!expected || !token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new UnauthorizedException('Webhook não autorizado');
    if (!payload || payload.event !== 'campaign.status' || !payload.campaign?.id || !payload.campaign?.phone || !payload.campaign?.status) return { accepted: false };
    const configuredAppId = this.config.get<string>('LIGUELEAD_APP_ID');
    if (configuredAppId && payload.app_id && payload.app_id !== configuredAppId) throw new UnauthorizedException('Aplicação LigueLead inválida');
    const phone = this.normalizePhone(String(payload.campaign.phone));
    const item = await this.prisma.ligueLeadDispatchItem.findFirst({ where: { externalCampaignId: String(payload.campaign.id), phone }, include: { dispatch: { select: { accountId: true, walletId: true, type: true } } } });
    if (!item) return { accepted: false };
    const eventKey = createHash('sha256').update(`${payload.campaign.id}|${phone}|${payload.campaign.status}|${payload.occurred_at ?? ''}`).digest('hex');
    try { await this.prisma.ligueLeadWebhookEvent.create({ data: { accountId: item.dispatch.accountId, eventKey, event: payload.event, payload } }); }
    catch (error: any) { if (error?.code === 'P2002') return { accepted: true, duplicate: true }; throw error; }
    const status = String(payload.campaign.status).toLowerCase();
    const mapped = status === 'sent' ? 'IN_PROGRESS' : status === 'answer' ? 'COMPLETED' : ['no_answer', 'busy', 'failed'].includes(status) ? 'FAILED' : 'UNKNOWN';
    await this.prisma.ligueLeadDispatchItem.update({ where: { id: item.id }, data: { status: mapped, rawPayload: payload, ...(mapped === 'IN_PROGRESS' ? { startedAt: new Date() } : {}), ...(mapped === 'COMPLETED' || mapped === 'FAILED' ? { completedAt: new Date(), durationSeconds: Number(payload.campaign.duration_sec ?? 0), recordingUrl: payload.campaign.recording_url ?? null, transcript: payload.campaign.transcript ? { messages: payload.campaign.transcript } : undefined, actionExecuted: payload.campaign.action_executed ?? null } : {}) } });
    const interactionStatus = this.interactionStatus(status);
    const channel = item.dispatch.type === 'SMS' ? 'SMS' : 'AI_VOICE_CALL';
    const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : new Date();
    await this.prisma.contractInteraction.updateMany({
      where: { accountId: item.dispatch.accountId, contractId: item.contractId, provider: 'LIGUELEAD', externalId: String(payload.campaign.id), channel },
      data: {
        status: interactionStatus,
        summary: this.interactionSummary(channel, interactionStatus),
        payload,
        ...(payload.campaign.transcript ? { conversation: { messages: payload.campaign.transcript } } : {}),
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      },
    });
    return { accepted: true, status: mapped };
  }

  private interactionStatus(status: string) {
    if (status === 'sent') return 'SENT' as const;
    if (['delivered'].includes(status)) return 'DELIVERED' as const;
    if (['read', 'opened'].includes(status)) return 'READ' as const;
    if (['answer', 'answered'].includes(status)) return 'ANSWERED' as const;
    if (['completed', 'complete'].includes(status)) return 'COMPLETED' as const;
    if (['no_answer', 'busy'].includes(status)) return 'NO_ANSWER' as const;
    if (['rejected'].includes(status)) return 'REJECTED' as const;
    return 'FAILED' as const;
  }

  private interactionSummary(channel: 'SMS' | 'AI_VOICE_CALL', status: string) {
    const channelLabel = channel === 'SMS' ? 'SMS' : 'Ligação com IA';
    const labels: Record<string, string> = {
      SENT: 'enviado', DELIVERED: 'entregue', READ: 'lido', ANSWERED: 'atendido',
      COMPLETED: 'concluído', NO_ANSWER: 'não atendido', REJECTED: 'recusado', FAILED: 'com falha',
    };
    return `${channelLabel} ${labels[status] ?? 'atualizado'}`;
  }
}
