import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/services/session.service';
import { InviteUserDto, InviteCreditorUserDto, ListUsersQueryDto, UpdateUserDto } from './dto';
import { PaginatedResponse } from '../common/dto';
import { EmailService } from '../common/email';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Invite a new user to the system.
   * - Validates email not already in use by an active user (409)
   * - Creates or reuses inactive user record
   * - Generates invite token with 72h expiry
   * - Creates UserScope records for VIEWER role
   * - Sends an activation email through the configured provider
   */
  async invite(dto: InviteUserDto, accountId: string) {
    const email = dto.email.toLowerCase().trim();

    // 1. Check if email already in use by active user → 409
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing && existing.isActive) {
      throw new ConflictException('Email already in use');
    }

    // 2. Create User (isActive=false) or reuse existing inactive user
    let user = existing;

    if (!existing) {
      user = await this.prisma.user.create({
        data: {
          accountId,
          email,
          role: dto.role,
          isActive: false,
        },
      });
    } else {
      // 3. If user already existed but inactive, update role
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { role: dto.role },
      });
    }

    // 4. Generate invite token (72h expiry)
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72);

    // 5. Create Invite record
    await this.prisma.invite.create({
      data: {
        userId: user!.id,
        token,
        role: dto.role,
        scopes: dto.scopes ? dto.scopes : undefined,
        expiresAt,
      },
    });

    // 6. If VIEWER, create UserScope records
    if (dto.role === 'VIEWER' && dto.scopes?.length) {
      await this.prisma.userScope.createMany({
        data: dto.scopes.map((walletId) => ({
          userId: user!.id,
          walletId,
        })),
        skipDuplicates: true,
      });
    }

    // 7. Send the activation email
    await this.emailService.sendInvitation(email, token);

    return {
      id: user!.id,
      email: user!.email,
      role: dto.role,
      status: 'PENDING',
    };
  }

  /** Invites a read-only user bound permanently to exactly one creditor. */
  async inviteCreditorUser(creditorId: string, dto: InviteCreditorUserDto, accountId: string) {
    const creditor = await this.prisma.creditor.findFirst({ where: { id: creditorId, accountId, deletedAt: null }, select: { id: true } });
    if (!creditor) throw new NotFoundException('Creditor not found');
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.isActive) throw new ConflictException('Email already in use');

    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data: { accountId, creditorId, role: 'VIEWER', name: dto.name ?? existing.name, isActive: false } })
      : await this.prisma.user.create({ data: { accountId, creditorId, email, name: dto.name, role: 'VIEWER', isActive: false } });

    await this.prisma.invite.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72);
    await this.prisma.invite.create({ data: { userId: user.id, token, role: 'VIEWER', expiresAt } });
    await this.emailService.sendInvitation(email, token);
    return { id: user.id, email: user.email, name: user.name, role: user.role, creditorId, status: 'PENDING' };
  }

  async listCreditorUsers(creditorId: string, accountId: string) {
    return this.prisma.user.findMany({
      where: { accountId, creditorId }, orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, isActive: true, passwordHash: true, createdAt: true },
    }).then((users) => users.map(({ passwordHash, ...user }) => ({ ...user, status: this.computeUserStatus(user.isActive, passwordHash) })));
  }

  /**
   * List users with pagination and optional status filter.
   * Status mapping:
   *   PENDING  = isActive=false AND passwordHash IS NULL
   *   ACTIVE   = isActive=true
   *   INACTIVE = isActive=false AND passwordHash IS NOT NULL
   */
  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<any>> {
    const { page, limit, status } = query;
    const skip = (page - 1) * limit;

    // Build where clause based on status filter
    const where = this.buildStatusFilter(status);

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          passwordHash: true,
          createdAt: true,
          updatedAt: true,
          scopes: {
            select: {
              walletId: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Compute status for each user and remove passwordHash from response
    const data = users.map((user) => {
      const computedStatus = this.computeUserStatus(user.isActive, user.passwordHash);
      const { passwordHash, scopes, ...rest } = user;
      return {
        ...rest,
        status: computedStatus,
        scopes: scopes.map((s) => s.walletId),
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a user's role, isActive status, and scopes.
   * Enforces last ADMIN protection (Req 4.10):
   * Cannot deactivate or demote the last active ADMIN.
   */
  async update(id: string, dto: UpdateUserDto) {
    // 1. Find user by ID
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { scopes: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Last ADMIN protection (Req 4.10)
    if (user.role === 'ADMIN' && user.isActive) {
      const wouldLoseAdmin =
        (dto.isActive === false) ||
        (dto.role !== undefined && dto.role !== 'ADMIN');

      if (wouldLoseAdmin) {
        // Count other active ADMINs
        const otherActiveAdmins = await this.prisma.user.count({
          where: {
            role: 'ADMIN',
            isActive: true,
            id: { not: id },
          },
        });

        if (otherActiveAdmins === 0) {
          throw new ConflictException(
            'The system must maintain at least one active ADMIN',
          );
        }
      }
    }

    // 3. Build update data
    const updateData: any = {};

    if (dto.role !== undefined) {
      updateData.role = dto.role;
    }

    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
    }

    // 4. Update user and scopes in a transaction
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      // Update user fields
      const updated = await tx.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          passwordHash: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // If scopes are provided, replace existing UserScopes
      if (dto.scopes !== undefined) {
        await tx.userScope.deleteMany({ where: { userId: id } });

        if (dto.scopes.length > 0) {
          await tx.userScope.createMany({
            data: dto.scopes.map((walletId) => ({
              userId: id,
              walletId,
            })),
          });
        }
      }

      // Fetch final scopes
      const scopes = await tx.userScope.findMany({
        where: { userId: id },
        select: { walletId: true },
      });

      return { ...updated, scopes };
    });

    const { passwordHash, scopes, ...rest } = updatedUser;
    return {
      ...rest,
      status: this.computeUserStatus(updatedUser.isActive, passwordHash),
      scopes: scopes.map((s) => s.walletId),
    };
  }

  /**
   * Resend invite for a PENDING user (Req 4.8).
   * - User must be PENDING (isActive=false, no passwordHash)
   * - Invalidates existing invite(s) for user (set to EXPIRED)
   * - Generates new 72h token
   * - Creates new Invite record
   * - Sends email (stub)
   */
  async resendInvite(userId: string) {
    // 1. Find user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Must be PENDING (isActive=false AND no passwordHash)
    const status = this.computeUserStatus(user.isActive, user.passwordHash);
    if (status !== 'PENDING') {
      throw new ConflictException(
        'Invite can only be resent for users with PENDING status',
      );
    }

    // 3. Invalidate existing pending invites for this user
    await this.prisma.invite.updateMany({
      where: {
        userId: user.id,
        status: 'PENDING',
      },
      data: { status: 'EXPIRED' },
    });

    // 4. Generate new token (72h expiry)
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72);

    // 5. Create new Invite record
    await this.prisma.invite.create({
      data: {
        userId: user.id,
        token,
        role: user.role,
        expiresAt,
      },
    });

    // 6. Send the activation email
    await this.emailService.sendInvitation(user.email, token);

    return {
      message: 'Invite resent successfully',
      userId: user.id,
      email: user.email,
    };
  }

  /**
   * Force password reset for a user (Req 5.6).
   * - User must exist and be active
   * - Sets mustResetPassword=true
   * - Revokes ALL sessions for the user
   */
  async forceReset(userId: string) {
    // 1. Find user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. User must be active
    if (!user.isActive) {
      throw new ConflictException(
        'Force reset can only be applied to active users',
      );
    }

    // 3. Set mustResetPassword = true
    await this.prisma.user.update({
      where: { id: userId },
      data: { mustResetPassword: true },
    });

    // 4. Revoke ALL sessions for the user
    await this.sessionService.revokeAll(userId);

    this.logger.log(`Force reset applied for user ${user.email}`);

    return {
      message: 'Password reset forced successfully',
      userId: user.id,
      email: user.email,
    };
  }

  /**
   * Compute user status from isActive and passwordHash fields.
   */
  private computeUserStatus(
    isActive: boolean,
    passwordHash: string | null,
  ): 'PENDING' | 'ACTIVE' | 'INACTIVE' {
    if (isActive) return 'ACTIVE';
    if (!passwordHash) return 'PENDING';
    return 'INACTIVE';
  }

  /**
   * Build Prisma where filter based on status.
   */
  private buildStatusFilter(status?: string) {
    switch (status) {
      case 'ACTIVE':
        return { isActive: true };
      case 'PENDING':
        return { isActive: false, passwordHash: null };
      case 'INACTIVE':
        return { isActive: false, passwordHash: { not: null } };
      default:
        return {};
    }
  }
}
