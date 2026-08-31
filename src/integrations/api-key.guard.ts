import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { ApiKeyScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { API_KEY_SCOPES_KEY } from './api-key-scopes.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawToken = request.headers['x-api-key'];
    if (typeof rawToken !== 'string' || !rawToken.startsWith('cc_live_')) {
      throw new UnauthorizedException('Uma chave de integração válida é obrigatória.');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { tokenHash, revokedAt: null },
      select: { id: true, accountId: true, creditorId: true, scopes: true },
    });
    if (!apiKey) throw new UnauthorizedException('Chave de integração inválida ou revogada.');
    if (!apiKey.creditorId) {
      throw new ForbiddenException('Esta chave não possui um credor vinculado e não pode acessar a API externa.');
    }

    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(API_KEY_SCOPES_KEY, [
      context.getHandler(), context.getClass(),
    ]) ?? [];
    if (requiredScopes.some((scope) => !apiKey.scopes.includes(scope))) {
      throw new ForbiddenException('A chave não possui a permissão necessária para esta operação.');
    }

    request.integration = apiKey;
    void this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return true;
  }
}
