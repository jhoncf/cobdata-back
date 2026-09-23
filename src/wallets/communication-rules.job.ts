import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LigueLeadService } from '../liguelead/liguelead.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';

type Schedule = { frequency: 'DAILY' | 'WEEKLY'; time: string; days?: number[] };
type Condition = { field: 'paymentStatus' | 'offerValue' | 'agingDays'; operator: 'eq' | 'gt' | 'lt'; value: string | number };

/**
 * Executes active wallet communication rules once per minute.  A durable run
 * record is created before any provider call, so a restart or two API pods can
 * never cause the same rule/date to dispatch twice.
 */
@Injectable()
export class CommunicationRulesJob {
  private readonly logger = new Logger(CommunicationRulesJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ligueLead: LigueLeadService,
    private readonly emailTemplates: EmailTemplatesService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'America/Sao_Paulo' })
  async runDueRules(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.localNow();
      const rules = await this.prisma.communicationRule.findMany({
        where: { active: true, wallet: { status: 'ACTIVE', deletedAt: null } },
        include: { template: true },
      });
      for (const rule of rules) {
        if (!this.isDue(rule.schedule as unknown as Schedule, now)) continue;
        await this.runRule(rule, now).catch((error) => this.logger.error(`Regra ${rule.id} falhou`, error instanceof Error ? error.stack : undefined));
      }
    } finally {
      this.running = false;
    }
  }

  private localNow() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
  }

  private isDue(schedule: Schedule, now: { date: string; time: string }) {
    if (!schedule || !['DAILY', 'WEEKLY'].includes(schedule.frequency) || schedule.time !== now.time) return false;
    if (schedule.frequency === 'DAILY') return true;
    const weekday = new Date(`${now.date}T12:00:00-03:00`).getDay();
    // Existing weekly rules without a weekday run on Monday; newly created
    // rules may persist one or more days as 0 (Sun) through 6 (Sat).
    const days = Array.isArray(schedule.days) && schedule.days.length ? schedule.days : [1];
    return days.includes(weekday);
  }

  private async runRule(rule: any, now: { date: string; time: string }) {
    const scheduledFor = new Date(`${now.date}T${now.time}:00-03:00`);
    let run: { id: string };
    try {
      run = await this.prisma.communicationRuleRun.create({ data: { ruleId: rule.id, scheduledFor } });
    } catch (error: any) {
      if (error?.code === 'P2002') return; // another process already owns this execution
      throw error;
    }
    try {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions as Condition[] : [];
      const where = this.contractWhere(rule, conditions);
      const contracts = await this.prisma.contract.findMany({ where, select: { id: true, debtorPhone: true, debtorEmail: true } });
      const eligible = contracts.filter((contract) => rule.channel === 'EMAIL' ? Boolean(contract.debtorEmail?.trim()) : Boolean(contract.debtorPhone?.trim()));
      let sent = 0;
      let failed = contracts.length - eligible.length;
      const batches = this.chunk(eligible, rule.channel === 'AI_VOICE_CALL' ? 100 : 25);
      for (const batch of batches) {
        try {
          if (rule.channel === 'SMS') {
            await this.ligueLead.sendSms(rule.walletId, rule.accountId, rule.createdByUserId, { title: rule.name, message: rule.template.content, contractIds: batch.map((item) => item.id) });
            sent += batch.length;
          } else if (rule.channel === 'AI_VOICE_CALL') {
            await this.ligueLead.sendCalls(rule.walletId, rule.accountId, rule.createdByUserId, { title: rule.name, contractIds: batch.map((item) => item.id) }, undefined, rule.template.content);
            sent += batch.length;
          } else {
            for (const contract of batch) {
              try {
                await this.emailTemplates.sendRuleEmail(rule.walletId, rule.accountId, rule.template.name, rule.template.content, contract.id);
                sent += 1;
              } catch { failed += 1; }
            }
          }
        } catch {
          failed += batch.length;
        }
      }
      await this.prisma.communicationRuleRun.update({ where: { id: run.id }, data: { status: failed ? (sent ? 'COMPLETED_WITH_ERRORS' : 'FAILED') : 'COMPLETED', matchedCount: contracts.length, sentCount: sent, failedCount: failed } });
      this.logger.log(`Regra “${rule.name}”: ${sent}/${contracts.length} comunicação(ões) enviada(s)`);
    } catch (error: any) {
      await this.prisma.communicationRuleRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: String(error?.message ?? error).slice(0, 2000) } }).catch(() => undefined);
      throw error;
    }
  }

  private contractWhere(rule: any, conditions: Condition[]): Prisma.ContractWhereInput {
    const and: Prisma.ContractWhereInput[] = [];
    for (const condition of conditions) {
      if (condition.field === 'paymentStatus') {
        if (condition.operator === 'eq') and.push({ paymentStatus: String(condition.value) as any });
        continue;
      }
      const number = Number(condition.value);
      if (!Number.isFinite(number)) continue;
      const comparison = condition.operator === 'eq' ? { equals: number } : condition.operator === 'gt' ? { gt: number } : { lt: number };
      and.push(condition.field === 'offerValue' ? { offerValue: comparison } : { agingDays: comparison });
    }
    return { accountId: rule.accountId, walletId: rule.walletId, deletedAt: null, status: 'ACTIVE', paymentStatus: { not: 'PAID' }, AND: and };
  }

  private chunk<T>(items: T[], size: number) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
  }
}
