import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTION_KEY, AuditMetadata } from '../decorators';
import { AuthenticatedUser } from '../interfaces';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<AuditMetadata>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    // If no @Audit decorator, skip
    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    return next.handle().pipe(
      tap(() => {
        // Best-effort audit logging (fire and forget)
        this.logAuditEntry(request, user, auditMeta).catch((error) => {
          this.logger.error(
            `Failed to write audit log: ${error.message}`,
            error.stack,
          );
        });
      }),
    );
  }

  private async logAuditEntry(
    request: any,
    user: AuthenticatedUser | undefined,
    meta: AuditMetadata,
  ): Promise<void> {
    const resourceId =
      request.params?.id ||
      request.params?.walletId ||
      request.params?.creditorId ||
      null;

    const metadata = this.sanitizeMetadata(request);

    await this.prisma.auditLog.create({
      data: {
        action: meta.action,
        userId: user?.id || null,
        resourceType: meta.resourceType,
        resourceId: resourceId,
        requestId: request.requestId || 'unknown',
        ipAddress: request.ip || request.connection?.remoteAddress || null,
        metadata: metadata === null ? Prisma.JsonNull : metadata,
      },
    });
  }

  private sanitizeMetadata(request: any): object | null {
    // Only include safe, non-PII metadata
    // No emails, documents, passwords, tokens
    const meta: Record<string, string> = {
      method: request.method,
      path: request.path,
    };

    const serialized = JSON.stringify(meta);
    if (serialized.length > 4096) {
      return null;
    }
    return meta;
  }
}
