import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiKeyScope } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Injectable()
export class IntegrationKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string) {
    return this.prisma.apiKey.findMany({
      where: { accountId },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(accountId: string, dto: CreateApiKeyDto) {
    const token = `cc_live_${randomBytes(32).toString('base64url')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        accountId,
        name: dto.name.trim(),
        scopes: dto.scopes as ApiKeyScope[],
        tokenPrefix: token.slice(0, 16),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true },
    });
    return { ...key, token };
  }

  async revoke(id: string, accountId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, accountId } });
    if (!key) throw new NotFoundException('Chave de integração não encontrada.');
    if (!key.revokedAt) {
      await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    }
    return { id, revoked: true };
  }
}
