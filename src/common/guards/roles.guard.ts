import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CREDITOR_PORTAL_KEY, ROLES_KEY } from '../decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (user?.creditorId) {
      return this.reflector.getAllAndOverride<boolean>(CREDITOR_PORTAL_KEY, [
        context.getHandler(), context.getClass(),
      ]) === true;
    }
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles decorator, allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
