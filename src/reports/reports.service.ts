import { BadRequestException, Injectable } from '@nestjs/common';
import { InteractionChannel, InteractionStatus, PaymentSettlementSource, PaymentSettlementStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Period = { start: Date; end: Date };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async serasaAgreements(accountId: string, creditorId?: string, startDate?: string, endDate?: string, pageValue?: string, limitValue?: string, walletId?: string) {
    const period = this.resolvePeriod(startDate, endDate);
    const pagination = this.resolvePagination(pageValue, limitValue);
    const where = {
      accountId,
      deletedAt: null,
      agreementReference: { not: null },
      paymentStatus: PaymentStatus.PAID,
      lastPaymentAt: { gte: period.start, lt: period.end },
      ...(creditorId || walletId ? { wallet: { ...(creditorId ? { creditorId } : {}), ...(walletId ? { id: walletId } : {}) } } : {}),
    };
    const rows = await this.prisma.contract.findMany({
      where,
      orderBy: { lastPaymentAt: 'desc' },
      select: {
        contractNumber: true,
        debtorName: true,
        agreementReference: true,
        lastPaymentAt: true,
        agreementTotalAmount: true,
        totalInstallments: true,
        paidInstallments: true,
        totalPaidAmount: true,
        paymentStatus: true,
        wallet: { select: { name: true, creditor: { select: { name: true } } } },
      },
    });
    const paidRows = rows.filter((row) => this.isAgreementFullyPaid(row));
    const total = paidRows.length;
    const pageRows = paidRows.slice(pagination.skip, pagination.skip + pagination.limit);

    return {
      period: this.serializePeriod(period),
      total,
      amount: paidRows.reduce((sum, row) => sum + Number(row.totalPaidAmount ?? row.agreementTotalAmount ?? 0), 0),
      meta: this.serializePagination(total, pagination),
      data: pageRows.map((row) => ({
        ...row,
        agreementTotalAmount: Number(row.agreementTotalAmount ?? 0),
      })),
    };
  }

  async exportSerasaAgreements(accountId: string, creditorId?: string, startDate?: string, endDate?: string, walletId?: string) {
    const period = this.resolvePeriod(startDate, endDate);
    const rows = await this.prisma.contract.findMany({
      where: {
        accountId,
        deletedAt: null,
        agreementReference: { not: null },
        paymentStatus: PaymentStatus.PAID,
        lastPaymentAt: { gte: period.start, lt: period.end },
        ...(creditorId || walletId ? { wallet: { ...(creditorId ? { creditorId } : {}), ...(walletId ? { id: walletId } : {}) } } : {}),
      },
      orderBy: { lastPaymentAt: 'desc' },
      select: {
        contractNumber: true,
        debtorName: true,
        agreementReference: true,
        lastPaymentAt: true,
        agreementTotalAmount: true,
        totalInstallments: true,
        paidInstallments: true,
        totalPaidAmount: true,
        wallet: { select: { name: true, creditor: { select: { name: true } } } },
      },
    });
    const paidRows = rows.filter((row) => this.isAgreementFullyPaid(row));
    const header = ['Data do pagamento', 'Credor', 'Carteira', 'Número do contrato', 'Devedor', 'Referência do acordo', 'Valor pago', 'Parcelas pagas'];
    const values = paidRows.map((row) => [
      row.lastPaymentAt?.toISOString() ?? '', row.wallet.creditor.name, row.wallet.name, row.contractNumber,
      row.debtorName ?? '', row.agreementReference ?? '', Number(row.totalPaidAmount ?? row.agreementTotalAmount ?? 0).toFixed(2).replace('.', ','),
      `${row.paidInstallments}/${row.totalInstallments ?? 1}`,
    ]);
    return `\uFEFF${[header, ...values].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n')}`;
  }

  async filters(accountId: string, creditorId?: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { accountId, deletedAt: null, ...(creditorId ? { creditorId } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, creditor: { select: { id: true, name: true } } },
    });
    const firstWallet = wallets[0];
    const creditors = creditorId
      ? firstWallet ? [{ id: firstWallet.creditor.id, name: firstWallet.creditor.name }] : []
      : await this.prisma.creditor.findMany({ where: { accountId, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return { creditors, wallets: wallets.map(({ id, name, creditor }) => ({ id, name, creditorId: creditor.id })) };
  }

  private isAgreementFullyPaid(row: { totalInstallments: number | null; paidInstallments: number; agreementTotalAmount: unknown; totalPaidAmount: unknown }) {
    const installments = Math.max(row.totalInstallments ?? 1, 1);
    const agreementAmount = Number(row.agreementTotalAmount ?? 0);
    const paidAmount = Number(row.totalPaidAmount ?? 0);
    return row.paidInstallments >= installments && paidAmount >= agreementAmount - 0.01;
  }

  async pixPayments(accountId: string, creditorId?: string, startDate?: string, endDate?: string, pageValue?: string, limitValue?: string, walletId?: string) {
    const period = this.resolvePeriod(startDate, endDate);
    const pagination = this.resolvePagination(pageValue, limitValue);
    const where = {
      accountId, source: PaymentSettlementSource.PIX, status: PaymentSettlementStatus.CONFIRMED, paidAt: { gte: period.start, lt: period.end },
      ...(creditorId || walletId ? { contract: { wallet: { ...(creditorId ? { creditorId } : {}), ...(walletId ? { id: walletId } : {}) } } } : {}),
    };
    const [rows, total, aggregate] = await Promise.all([
      this.prisma.paymentSettlement.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        amount: true,
        paidAt: true,
        externalPaymentId: true,
        paymentCharge: { select: { attributedChannel: true } },
        contract: {
          select: {
            contractNumber: true,
            debtorName: true,
            wallet: { select: { name: true, creditor: { select: { name: true } } } },
          },
        },
      },
      }),
      this.prisma.paymentSettlement.count({ where }),
      this.prisma.paymentSettlement.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      period: this.serializePeriod(period),
      total,
      amount: Number(aggregate._sum.amount ?? 0),
      meta: this.serializePagination(total, pagination),
      data: rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    };
  }

  async communications(accountId: string, creditorId?: string, startDate?: string, endDate?: string, pageValue?: string, limitValue?: string, walletId?: string) {
    const period = this.resolvePeriod(startDate, endDate);
    const pagination = this.resolvePagination(pageValue, limitValue);
    const where = {
      accountId,
      channel: { in: [InteractionChannel.SMS, InteractionChannel.EMAIL, InteractionChannel.AI_VOICE_CALL] },
      status: { in: [InteractionStatus.READ, InteractionStatus.ANSWERED] },
      occurredAt: { gte: period.start, lt: period.end },
      ...(creditorId || walletId ? { wallet: { ...(creditorId ? { creditorId } : {}), ...(walletId ? { id: walletId } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contractInteraction.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        channel: true,
        status: true,
        contact: true,
        summary: true,
        occurredAt: true,
        contract: {
          select: {
            contractNumber: true,
            debtorName: true,
            wallet: { select: { name: true, creditor: { select: { name: true } } } },
          },
        },
      },
      }),
      this.prisma.contractInteraction.count({ where }),
    ]);

    return { period: this.serializePeriod(period), total, meta: this.serializePagination(total, pagination), data: rows };
  }

  private resolvePeriod(startDate?: string, endDate?: string): Period {
    const end = endDate ? this.parseDate(endDate, 'final') : this.startOfTomorrow();
    const start = startDate ? this.parseDate(startDate, 'inicial') : new Date(end.getTime() - 30 * 86_400_000);
    if (start >= end) throw new BadRequestException('A data inicial deve ser anterior à data final');
    return { start, end };
  }

  private parseDate(value: string, label: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`Data ${label} inválida`);
    const date = new Date(`${value}T00:00:00-03:00`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`Data ${label} inválida`);
    if (label === 'final') date.setDate(date.getDate() + 1);
    return date;
  }

  private startOfTomorrow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const today = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`);
    today.setDate(today.getDate() + 1);
    return today;
  }

  private serializePeriod(period: Period) {
    return { startDate: period.start.toISOString(), endDateExclusive: period.end.toISOString() };
  }

  private resolvePagination(pageValue?: string, limitValue?: string) {
    const page = Math.max(1, Number.parseInt(pageValue ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(limitValue ?? '50', 10) || 50));
    return { page, limit, skip: (page - 1) * limit };
  }

  private serializePagination(total: number, pagination: { page: number; limit: number }) {
    return { ...pagination, totalPages: Math.max(1, Math.ceil(total / pagination.limit)) };
  }
}
