import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProviderType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSerasaWalletDto, UpdateSerasaWalletDto } from './dto/serasa-wallet.dto';

@Injectable()
export class SerasaWalletsService {
  constructor(private readonly prisma: PrismaService) {}

  list(accountId: string) {
    return this.prisma.serasaWallet.findMany({
      where: { accountId }, orderBy: { name: 'asc' },
      include: { _count: { select: { crmWallets: true } } },
    });
  }

  async create(accountId: string, dto: CreateSerasaWalletDto) {
    return this.prisma.serasaWallet.create({ data: { accountId, ...dto } });
  }

  async update(id: string, accountId: string, dto: UpdateSerasaWalletDto) {
    await this.ensureOwned(id, accountId);
    return this.prisma.serasaWallet.update({ where: { id }, data: dto });
  }

  async remove(id: string, accountId: string) {
    const wallet = await this.prisma.serasaWallet.findFirst({
      where: { id, accountId }, include: { _count: { select: { crmWallets: true } } },
    });
    if (!wallet) throw new NotFoundException('Carteira Serasa não encontrada');
    if (wallet._count.crmWallets) {
      throw new ConflictException('Desvincule as carteiras CRM antes de excluir esta carteira Serasa');
    }
    await this.prisma.serasaWallet.delete({ where: { id } });
  }

  async ensureOwned(id: string, accountId: string) {
    const wallet = await this.prisma.serasaWallet.findFirst({ where: { id, accountId } });
    if (!wallet) throw new NotFoundException('Carteira Serasa não encontrada');
    return wallet;
  }

  /** Keeps the legacy operation mapping aligned with the selected Serasa wallet. */
  async linkCrmWallet(walletId: string, serasaWalletId: string | null, accountId: string) {
    const wallet = await this.prisma.wallet.findFirst({ where: { id: walletId, accountId, deletedAt: null } });
    if (!wallet) throw new NotFoundException('Carteira CRM não encontrada');

    const provider = await this.prisma.provider.findFirst({ where: { accountId, type: ProviderType.SERASA_LNOP } });
    if (!serasaWalletId) {
      await this.prisma.wallet.update({ where: { id: walletId }, data: { serasaWalletId: null } });
      if (provider) await this.prisma.walletMapping.deleteMany({ where: { providerId: provider.id, walletId } });
      return;
    }
    const serasaWallet = await this.ensureOwned(serasaWalletId, accountId);
    if (!serasaWallet.active) throw new ConflictException('Esta carteira Serasa está inativa');
    if (!provider) throw new ConflictException('Canal Serasa não está configurado');

    await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: walletId }, data: { serasaWalletId } }),
      this.prisma.walletMapping.upsert({
        where: { providerId_walletId: { providerId: provider.id, walletId } },
        create: { providerId: provider.id, walletId, externalWalletId: serasaWallet.externalWalletId },
        update: { externalWalletId: serasaWallet.externalWalletId },
      }),
    ]);
  }
}
