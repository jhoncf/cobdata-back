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
      select: {
        id: true,
        contractNumber: true,
        dueDate: true,
        updatedValue: true,
        wallet: { select: { cobcomDiscountPercent: true, creditor: { select: { name: true, cnpj: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });

    return contracts.map((contract) => ({
      id: contract.id,
      contractNumber: contract.contractNumber,
      dueDate: contract.dueDate,
      amount: new Prisma.Decimal(contract.updatedValue).mul(new Prisma.Decimal(100).minus(contract.wallet.cobcomDiscountPercent)).div(100).toDecimalPlaces(2).toString(),
      updatedAmount: contract.updatedValue.toString(),
      cobcomDiscountPercent: contract.wallet.cobcomDiscountPercent.toString(),
      creditor: contract.wallet.creditor,
    }));
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
