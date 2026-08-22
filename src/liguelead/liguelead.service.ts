import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
    const wallet = await this.prisma.wallet.findFirst({ where: { id: walletId, accountId, deletedAt: null } });
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
    const contracts = await this.prisma.contract.findMany({ where: { id: { in: ids }, walletId, accountId, deletedAt: null, providerStatus: { not: 'PAID' }, status: 'ACTIVE', debtorPhone: { not: null } }, select: { id: true, contractNumber: true, debtorName: true, debtorDocument: true, debtorPhone: true, originalValue: true, updatedValue: true } });
    if (contracts.length !== ids.length) throw new BadRequestException('Selecione apenas contratos ativos, não pagos e com telefone informado');
    return contracts;
  }

  async sendSms(walletId: string, accountId: string, userId: string, dto: SendLigueLeadSmsDto, scopes?: string[]) {
    await this.wallet(walletId, accountId, scopes);
    const contracts = await this.eligibleContracts(walletId, accountId, dto.contractIds);
    const remote = await this.request('/v1/sms', { method: 'POST', body: JSON.stringify({ title: dto.title, message: dto.message, phones: contracts.map(c => c.debtorPhone) }) });
    return this.prisma.ligueLeadDispatch.create({ data: { accountId, walletId, userId, type: 'SMS', title: dto.title, externalId: remote?.data?.campaign_id ?? remote?.campaign_id, totalItems: contracts.length } });
  }

  async sendCalls(walletId: string, accountId: string, userId: string, dto: SendLigueLeadCallsDto, scopes?: string[]) {
    await this.wallet(walletId, accountId, scopes);
    const agent = await this.prisma.ligueLeadWalletAgent.findUnique({ where: { walletId } });
    if (!agent?.active) throw new BadRequestException('Configure e ative o agente de IA desta carteira antes de disparar ligações');
    const contracts = await this.eligibleContracts(walletId, accountId, dto.contractIds);
    const payload = { title: dto.title, voice_agent_id: agent.externalId, phones: contracts.map(c => ({ phone: c.debtorPhone, call_context: `Dados da cobrança: nome do devedor: ${c.debtorName}; CPF: ${c.debtorDocument}; contrato: ${c.contractNumber}; valor atualizado: R$ ${Number(c.updatedValue ?? c.originalValue).toFixed(2).replace('.', ',')}. Use estes dados somente para esta conversa.` })), ...(dto.retryAttempts ? { retry_attempts: dto.retryAttempts, retry_interval_min: dto.retryIntervalMin ?? 30 } : {}) };
    const remote = await this.request('/v1/voice-agent/call', { method: 'POST', body: JSON.stringify(payload) });
    return this.prisma.ligueLeadDispatch.create({ data: { accountId, walletId, userId, type: 'AI_CALL', title: dto.title, externalId: remote?.data?.campaign_id ?? remote?.campaign_id, totalItems: contracts.length } });
  }
}
