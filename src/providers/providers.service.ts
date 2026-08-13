import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { Provider } from '@prisma/client';

export interface ProviderResponse {
  id: string;
  accountId: string;
  type: string;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(dto: CreateProviderDto, accountId: string): Promise<ProviderResponse> {
    // Check for duplicate provider type
    const existing = await this.prisma.provider.findUnique({
      where: { type: dto.type },
    });

    if (existing) {
      throw new ConflictException(
        `A provider configuration for type ${dto.type} already exists`,
      );
    }

    const encryptedCredentials = this.cryptoService.encrypt(
      JSON.stringify(dto.credentials),
    );

    const provider = await this.prisma.provider.create({
      data: {
        accountId,
        type: dto.type,
        environment: dto.environment,
        credentials: encryptedCredentials,
      },
    });

    return this.toResponse(provider);
  }

  async list(accountId: string): Promise<ProviderResponse[]> {
    const providers = await this.prisma.provider.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });

    return providers.map((p) => this.toResponse(p));
  }

  async findById(id: string, accountId: string): Promise<Provider> {
    const provider = await this.prisma.provider.findFirst({
      where: { id, accountId },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    return provider;
  }

  async update(
    id: string,
    dto: UpdateProviderDto,
    accountId: string,
  ): Promise<ProviderResponse> {
    const provider = await this.prisma.provider.findFirst({
      where: { id, accountId },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const data: any = {};

    if (dto.environment !== undefined) {
      data.environment = dto.environment;
    }

    if (dto.credentials !== undefined) {
      data.credentials = this.cryptoService.encrypt(
        JSON.stringify(dto.credentials),
      );
    }

    const updated = await this.prisma.provider.update({
      where: { id },
      data,
    });

    return this.toResponse(updated);
  }

  private toResponse(provider: Provider): ProviderResponse {
    return {
      id: provider.id,
      accountId: provider.accountId,
      type: provider.type,
      environment: provider.environment,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }
}
