import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces';
import { IS_PUBLIC_KEY } from '../decorators';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    // If no user (public route fallback) or non-VIEWER role, allow through
    if (!user || user.role !== 'VIEWER') {
      return true;
    }

    // Load scopes from DB if not already cached on request
    if (!request.userScopes) {
      const scopes = await this.prisma.userScope.findMany({
        where: { userId: user.id },
        select: { walletId: true },
      });
      request.userScopes = scopes.map((s) => s.walletId);
    }

    // Check if the request references a specific walletId
    const walletId = this.extractWalletId(request);

    // If a specific wallet is requested, verify it's in scopes
    if (walletId) {
      if (request.userScopes.length === 0) {
        return false; // No scopes = no access
      }
      return request.userScopes.includes(walletId);
    }

    // For listing endpoints without specific walletId, allow through
    // (the service layer will filter results using request.userScopes)
    return true;
  }

  private extractWalletId(request: any): string | null {
    // Check route params
    if (request.params?.walletId) return request.params.walletId;
    if (request.params?.id && request.route?.path?.includes('wallets'))
      return request.params.id;

    // Check query params
    if (request.query?.walletId) return request.query.walletId;

    // Check body
    if (request.body?.walletId) return request.body.walletId;

    return null;
  }
}
