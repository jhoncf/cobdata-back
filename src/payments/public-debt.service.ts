import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentChargesService } from './payment-charges.service';

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

  async lookup(document: string) {
    const debtorDocument = this.normalizeDocument(document);
    const contracts = await this.prisma.contract.findMany({
      where: {
        debtorDocument,
        status: 'ACTIVE',
        providerStatus: { not: 'PAID' },
        deletedAt: null,
        updatedValue: { gt: 0 },
        wallet: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        id: true,
        contractNumber: true,
        dueDate: true,
        updatedValue: true,
        wallet: { select: { creditor: { select: { name: true, cnpj: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });

    return contracts.map((contract) => ({
      id: contract.id,
      contractNumber: contract.contractNumber,
      dueDate: contract.dueDate,
      amount: contract.updatedValue?.toString(),
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
        providerStatus: { not: 'PAID' },
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
