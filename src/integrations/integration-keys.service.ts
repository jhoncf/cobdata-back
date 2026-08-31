import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiKeyScope } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyScopesDto } from './dto/update-api-key-scopes.dto';

@Injectable()
export class IntegrationKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string) {
    return this.prisma.apiKey.findMany({
      where: { accountId },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, accessAllCreditors: true, lastUsedAt: true, revokedAt: true, createdAt: true, creditor: { select: { id: true, name: true, cnpj: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(accountId: string, dto: CreateApiKeyDto) {
    const accessAllCreditors = dto.accessAllCreditors === true;
    const creditor = accessAllCreditors ? null : await this.prisma.creditor.findFirst({
      where: { id: dto.creditorId, accountId, deletedAt: null },
      select: { id: true },
    });
    if (!accessAllCreditors && !creditor) throw new NotFoundException('Credor não encontrado para vincular à chave de integração.');

    const token = `cc_live_${randomBytes(32).toString('base64url')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        accountId,
        creditorId: creditor?.id,
        accessAllCreditors,
        name: dto.name.trim(),
        scopes: dto.scopes as ApiKeyScope[],
        tokenPrefix: token.slice(0, 16),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, accessAllCreditors: true, createdAt: true, creditor: { select: { id: true, name: true, cnpj: true } } },
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

  async updateScopes(id: string, accountId: string, dto: UpdateApiKeyScopesDto) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, accountId, revokedAt: null } });
    if (!key) throw new NotFoundException('Chave de integração não encontrada ou revogada.');
    return this.prisma.apiKey.update({
      where: { id },
      data: { scopes: dto.scopes as ApiKeyScope[] },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, accessAllCreditors: true, lastUsedAt: true, revokedAt: true, createdAt: true, creditor: { select: { id: true, name: true, cnpj: true } } },
    });
  }
}
