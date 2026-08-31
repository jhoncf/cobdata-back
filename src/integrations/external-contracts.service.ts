import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentChargesService } from '../payments/payment-charges.service';
import { PublicDebtService } from '../payments/public-debt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalContractQueryDto } from './dto/external-contract-query.dto';
import { UpdateContractContactsDto } from './dto/update-contract-contacts.dto';
import { CreateExternalContractDto } from './dto/create-external-contract.dto';
import { ContractsService } from '../contracts/contracts.service';

@Injectable()
export class ExternalContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicDebt: PublicDebtService,
    private readonly paymentCharges: PaymentChargesService,
    private readonly contractsService: ContractsService,
  ) {}

  async list(accountId: string, creditorId: string | undefined, query: ExternalContractQueryDto) {
    return this.publicDebt.lookup(query.debtorDocument, accountId, query.contractNumber, creditorId);
  }

  async createContract(accountId: string, creditorId: string | undefined, dto: CreateExternalContractDto) {
    if (!creditorId) throw new BadRequestException('Informe creditorId para uma chave com acesso a todos os credores.');
    const creditor = await this.prisma.creditor.findFirst({ where: { id: creditorId, accountId, deletedAt: null }, select: { id: true } });
    if (!creditor) throw new NotFoundException('Credor não encontrado.');
    const wallet = await this.ensureDefaultWallet(accountId, creditor.id);
    const { creditorId: _ignored, ...contract } = dto;
    return this.contractsService.createOrUpdate({ ...contract, walletId: wallet.id }, accountId);
  }

  async updateContacts(accountId: string, creditorId: string | undefined, contractNumber: string, debtorDocument: string, dto: UpdateContractContactsDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Informe ao menos e-mail ou telefone para atualização.');
    }
    const normalizedDocument = this.normalizeDocument(debtorDocument);
    const contract = await this.prisma.contract.findFirst({
      where: { accountId, contractNumber, debtorDocument: normalizedDocument, deletedAt: null, ...(creditorId ? { wallet: { creditorId } } : {}) },
      select: { id: true, debtorEmail: true, debtorPhone: true, updatedAt: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado para o CPF/CNPJ informado.');

    return this.prisma.contract.update({
      where: { id: contract.id },
      data: { ...(dto.email !== undefined ? { debtorEmail: dto.email } : {}), ...(dto.phone !== undefined ? { debtorPhone: dto.phone } : {}) },
      select: { id: true, contractNumber: true, debtorEmail: true, debtorPhone: true, updatedAt: true },
    });
  }

  async createPix(accountId: string, creditorId: string | undefined, contractNumber: string, debtorDocument: string, idempotencyKey: string, requestId: string) {
    return this.paymentCharges.createPixByDocument(
      { debtorDocument, contractNumber, idempotencyKey },
      accountId,
      undefined,
      requestId,
      creditorId,
    );
  }

  private normalizeDocument(document: string): string {
    const normalized = document.replace(/\D/g, '');
    if (normalized.length !== 11 && normalized.length !== 14) {
      throw new BadRequestException('Informe um CPF ou CNPJ válido.');
    }
    return normalized;
  }

  private async ensureDefaultWallet(accountId: string, creditorId: string) {
    const existing = await this.prisma.wallet.findFirst({ where: { accountId, creditorId, isApiDefault: true, deletedAt: null } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { accountId, creditorId, name: 'Entrada via API', isApiDefault: true } });
  }
}
