import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentChargesService } from '../payments/payment-charges.service';
import { PublicDebtService } from '../payments/public-debt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalContractQueryDto } from './dto/external-contract-query.dto';
import { UpdateContractContactsDto } from './dto/update-contract-contacts.dto';

@Injectable()
export class ExternalContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicDebt: PublicDebtService,
    private readonly paymentCharges: PaymentChargesService,
  ) {}

  async list(accountId: string, query: ExternalContractQueryDto) {
    return this.publicDebt.lookup(query.debtorDocument, accountId, query.contractNumber);
  }

  async updateContacts(accountId: string, contractNumber: string, debtorDocument: string, dto: UpdateContractContactsDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Informe ao menos e-mail ou telefone para atualização.');
    }
    const normalizedDocument = this.normalizeDocument(debtorDocument);
    const contract = await this.prisma.contract.findFirst({
      where: { accountId, contractNumber, debtorDocument: normalizedDocument, deletedAt: null },
      select: { id: true, debtorEmail: true, debtorPhone: true, updatedAt: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado para o CPF/CNPJ informado.');

    return this.prisma.contract.update({
      where: { id: contract.id },
      data: { ...(dto.email !== undefined ? { debtorEmail: dto.email } : {}), ...(dto.phone !== undefined ? { debtorPhone: dto.phone } : {}) },
      select: { id: true, contractNumber: true, debtorEmail: true, debtorPhone: true, updatedAt: true },
    });
  }

  async createPix(accountId: string, contractNumber: string, debtorDocument: string, idempotencyKey: string, requestId: string) {
    return this.paymentCharges.createPixByDocument(
      { debtorDocument, contractNumber, idempotencyKey },
      accountId,
      undefined,
      requestId,
    );
  }

  private normalizeDocument(document: string): string {
    const normalized = document.replace(/\D/g, '');
    if (normalized.length !== 11 && normalized.length !== 14) {
      throw new BadRequestException('Informe um CPF ou CNPJ válido.');
    }
    return normalized;
  }
}
