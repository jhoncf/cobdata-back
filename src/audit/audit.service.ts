import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponse } from '../common/dto';
import { QueryAuditLogsDto } from './dto';

export interface AuditLogEntry {
  action: string;
  userId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId: string;
  operationId?: string | null;
  jobId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

// PII patterns for validation
const PII_PATTERNS = {
  CPF: /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
  CNPJ: /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/,
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  PHONE: /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}/,
  JWT: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
};

const MAX_METADATA_SIZE = 4096; // 4KB

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Logs an audit entry in a best-effort manner.
   * Failures are caught and logged but never propagate.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const sanitizedMetadata = this.sanitizeMetadata(entry.metadata);

      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          userId: entry.userId || null,
          resourceType: entry.resourceType || null,
          resourceId: entry.resourceId || null,
          requestId: entry.requestId,
          operationId: entry.operationId || null,
          jobId: entry.jobId || null,
          ipAddress: entry.ipAddress || null,
          metadata:
            sanitizedMetadata === null
              ? Prisma.JsonNull
              : (sanitizedMetadata as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Best-effort: do not rethrow
    }
  }

  /**
   * Queries audit logs with pagination and filters. Admin only.
   */
  async findAll(
    query: QueryAuditLogsDto,
  ): Promise<PaginatedResponse<any>> {
    const { page, limit, action, userId, resourceType, resourceId, startDate, endDate } = query;

    const where: Prisma.AuditLogWhereInput = {};

    if (action) {
      where.action = action;
    }
    if (userId) {
      where.userId = userId;
    }
    if (resourceType) {
      where.resourceType = resourceType;
    }
    if (resourceId) {
      where.resourceId = resourceId;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

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
   * Validates metadata does not contain PII and is within size limit.
   * Returns null if metadata is invalid or absent.
   */
  private sanitizeMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const serialized = JSON.stringify(metadata);

    // Check size limit (4KB)
    if (serialized.length > MAX_METADATA_SIZE) {
      this.logger.warn('Audit metadata exceeds 4KB limit, discarding');
      return null;
    }

    // Check for PII patterns
    if (this.containsPII(serialized)) {
      this.logger.warn('Audit metadata contains PII patterns, discarding');
      return null;
    }

    return metadata;
  }

  /**
   * Checks if the given string contains PII patterns.
   */
  containsPII(value: string): boolean {
    for (const pattern of Object.values(PII_PATTERNS)) {
      if (pattern.test(value)) {
        return true;
      }
    }
    // Check for common password field names with values
    if (/["']?password["']?\s*[:=]\s*["'][^"']+["']/i.test(value)) {
      return true;
    }
    return false;
  }
}
