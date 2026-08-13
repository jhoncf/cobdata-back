import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletMappingDto } from './dto/create-wallet-mapping.dto';
import { WalletMapping } from '@prisma/client';

@Injectable()
export class WalletMappingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    providerId: string,
    dto: CreateWalletMappingDto,
    accountId: string,
  ): Promise<WalletMapping> {
    // Validate provider exists
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId, accountId },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    // Validate wallet exists, not soft-deleted, not INACTIVE
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: dto.walletId, accountId, deletedAt: null },
    });

    if (!wallet) {
      throw new UnprocessableEntityException('Wallet not found or has been deleted');
    }

    if (wallet.status === 'INACTIVE') {
      throw new UnprocessableEntityException(
        'Cannot map an inactive wallet to a provider',
      );
    }

    // Check if mapping already exists for this provider + wallet
    const existing = await this.prisma.walletMapping.findUnique({
      where: {
        providerId_walletId: {
          providerId,
          walletId: dto.walletId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A mapping for this wallet already exists for this provider',
      );
    }

    return this.prisma.walletMapping.create({
      data: {
        providerId,
        walletId: dto.walletId,
        externalWalletId: dto.externalWalletId,
      },
    });
  }

  async list(providerId: string, accountId: string): Promise<WalletMapping[]> {
    // Validate provider exists
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId, accountId },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    return this.prisma.walletMapping.findMany({
      where: { providerId },
      orderBy: { walletId: 'asc' },
    });
  }

  async delete(
    providerId: string,
    mappingId: string,
    accountId: string,
  ): Promise<void> {
    // Validate provider exists
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId, accountId },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const mapping = await this.prisma.walletMapping.findFirst({
      where: { id: mappingId, providerId },
    });

    if (!mapping) {
      throw new NotFoundException('Wallet mapping not found');
    }

    await this.prisma.walletMapping.delete({
      where: { id: mappingId },
    });
  }
}
