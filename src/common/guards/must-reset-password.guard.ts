import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ALLOW_MUST_RESET_KEY } from '../decorators';
import { AuthenticatedUser } from '../interfaces';

/**
 * Guard that blocks access to all endpoints for users who must reset their password,
 * except for routes marked with @AllowMustReset() or @Public().
 *
 * When a user logs in with mustResetPassword=true, they receive a restricted token.
 * This guard ensures that restricted token can only access password-change endpoints.
 */
@Injectable()
export class MustResetPasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip for @Public() routes (they don't have a user anyway)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Check for @AllowMustReset() decorator (for change-password endpoint)
    const allowMustReset = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_RESET_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowMustReset) {
      return true;
    }

    // Get the authenticated user from the request
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    // If user must reset password, block access to all other endpoints
    if (user?.mustResetPassword) {
      throw new ForbiddenException(
        'Password reset required. Please change your password.',
      );
    }

    return true;
  }
}
