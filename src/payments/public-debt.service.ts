import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentChargesService } from './payment-charges.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PublicDebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentCharges: PaymentChargesService,
  ) {}

  private normalizeDocument(document: string): string {
    const normalized = document.replace(/\D/g, '');
    if (normalized.length !== 11 && normalized.length !== 14) {
      throw new BadRequestException('Informe um CPF ou CNPJ válido.');
    }
    return normalized;
  }

  private readonly publicContractSelect = {
    id: true,
    contractNumber: true,
    debtorName: true,
    productName: true,
    dueDate: true,
    updatedValue: true,
    offerValue: true,
    wallet: { select: { cobcomDiscountPercent: true, creditor: { select: { name: true, cnpj: true } } } },
  } as const;

  private toPublicContract(contract: any) {
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      debtorName: contract.debtorName,
      productName: contract.productName,
      dueDate: contract.dueDate,
      amount: (contract.offerValue ?? new Prisma.Decimal(contract.updatedValue).mul(new Prisma.Decimal(100).minus(contract.wallet.cobcomDiscountPercent)).div(100).toDecimalPlaces(2)).toString(),
      updatedAmount: contract.updatedValue.toString(),
      cobcomDiscountPercent: contract.wallet.cobcomDiscountPercent.toString(),
      creditor: contract.wallet.creditor,
    };
  }

  async lookup(document: string, accountId?: string, contractNumber?: string, creditorId?: string) {
    const debtorDocument = this.normalizeDocument(document);
    const contracts = await this.prisma.contract.findMany({
      where: {
        ...(accountId ? { accountId } : {}),
        ...(contractNumber ? { contractNumber } : {}),
        debtorDocument,
        status: 'ACTIVE',
        paymentStatus: { not: 'PAID' },
        deletedAt: null,
        updatedValue: { gt: 0 },
        wallet: { status: 'ACTIVE', deletedAt: null, ...(creditorId ? { creditorId } : {}) },
      },
      select: this.publicContractSelect,
      orderBy: { dueDate: 'asc' },
    });

    return contracts.map((contract) => this.toPublicContract(contract));
  }

  private async activeAccessLink(token: string) {
    const link = await this.prisma.publicDebtAccessLink.findFirst({
      where: {
        token,
        expiresAt: { gt: new Date() },
        contract: {
          status: 'ACTIVE',
          paymentStatus: { not: 'PAID' },
          deletedAt: null,
          updatedValue: { gt: 0 },
          wallet: { status: 'ACTIVE', deletedAt: null },
        },
      },
      include: { contract: { select: { ...this.publicContractSelect, accountId: true } } },
    });
    if (!link) throw new NotFoundException('Este link não é mais válido. Faça uma nova consulta.');
    return link;
  }

  async openAccessLink(token: string) {
    const link = await this.activeAccessLink(token);
    const openedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const opened = await tx.publicDebtAccessLink.updateMany({
        where: { id: link.id, openedAt: null },
        data: { openedAt },
      });
      if (opened.count && link.interactionId) {
        await tx.contractInteraction.update({
          where: { id: link.interactionId },
          data: { status: 'READ', summary: 'SMS lido: link temporário acessado', occurredAt: openedAt },
        });
      }
    });
    return { contract: this.toPublicContract(link.contract), expiresAt: link.expiresAt };
  }

  async generatePixFromAccessLink(token: string, requestId: string) {
    const link = await this.activeAccessLink(token);
    return this.paymentCharges.createPixForContract(link.contractId, link.contract.accountId, undefined, requestId);
  }

  async getChargeStatusFromAccessLink(token: string, chargeId: string) {
    const link = await this.activeAccessLink(token);
    const charge = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, contractId: link.contractId },
      select: { status: true, paidAt: true },
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    return charge;
  }

  async generatePix(contractId: string, document: string, requestId: string) {
    const debtorDocument = this.normalizeDocument(document);
    const contract = await this.prisma.contract.findFirst({
      where: {
        id: contractId,
        debtorDocument,
        status: 'ACTIVE',
        paymentStatus: { not: 'PAID' },
        deletedAt: null,
        updatedValue: { gt: 0 },
        wallet: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true, accountId: true },
    });
    if (!contract) throw new NotFoundException('Cobrança não encontrada. Faça uma nova consulta.');

    return this.paymentCharges.createPixForContract(
      contract.id,
      contract.accountId,
      undefined,
      requestId,
    );
  }

  async getChargeStatus(chargeId: string, document: string) {
    const debtorDocument = this.normalizeDocument(document);
    const charge = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, contract: { debtorDocument } },
      select: { status: true, paidAt: true },
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    return charge;
  }
}
