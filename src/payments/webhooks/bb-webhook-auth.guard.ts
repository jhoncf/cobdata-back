import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Guard for validating Banco do Brasil webhook authenticity.
 * Currently implements IP whitelist validation.
 * In the future, mTLS validation can be added here.
 */
@Injectable()
export class BbWebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(BbWebhookAuthGuard.name);
  private readonly allowedIps: string[];
  private readonly token?: string;

  constructor() {
    const raw = process.env.BB_WEBHOOK_ALLOWED_IPS ?? '';
    this.allowedIps = raw
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);
    this.token = process.env.BB_WEBHOOK_TOKEN;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const sourceIp = this.extractSourceIp(request);

    if (this.allowedIps.length > 0 && (!sourceIp || !this.allowedIps.includes(sourceIp))) {
      this.logger.warn(
        `BB webhook rejected: unauthorized IP ${sourceIp ?? 'unknown'} at ${new Date().toISOString()}`,
      );
      throw new UnauthorizedException();
    }

    // The BB webhook URL is registered with an unguessable token. In production
    // the route must never be accepted without it, even when an IP allowlist is
    // temporarily unavailable.
    if (process.env.NODE_ENV === 'production') {
      const supplied = this.extractToken(request);
      if (!this.token || !supplied || !this.hasValidToken(supplied)) {
        this.logger.warn(`BB webhook rejected: invalid token from ${sourceIp ?? 'unknown'}`);
        throw new UnauthorizedException();
      }
    }

    return true;
  }

  /**
   * Extracts the source IP from the request.
   * Checks x-forwarded-for header first (for reverse proxies), then falls back to req.ip.
   */
  private extractSourceIp(request: Request): string | undefined {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      // x-forwarded-for can contain multiple IPs; the first is the original client
      return forwarded.split(',')[0]?.trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
      return forwarded[0].split(',')[0]?.trim();
    }
    return request.ip ?? undefined;
  }

  private extractToken(request: Request): string | undefined {
    const token = request.query.token;
    return typeof token === 'string' ? token : undefined;
  }

  private hasValidToken(supplied: string): boolean {
    if (!this.token || supplied.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token));
  }
}
