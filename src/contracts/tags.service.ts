import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalize a tag: lowercase + trim.
   */
  normalizeTag(tag: string): string {
    return tag.toLowerCase().trim();
  }

  /**
   * Normalize an array of tags and deduplicate.
   */
  normalizeTags(tags: string[]): string[] {
    const normalized = tags.map((t) => this.normalizeTag(t));
    return [...new Set(normalized)];
  }

  /**
   * Add tags to a contract.
   * - Normalizes each tag (lowercase + trim)
   * - Deduplicates
   * - Enforces max 20 tags per contract (existing + new unique)
   * - Uses skipDuplicates to avoid conflicts on re-add
   */
  async addTags(
    contractId: string,
    tags: string[],
    accountId: string,
  ): Promise<{ contractId: string; tags: string[] }> {
    // Validate contract exists and belongs to account
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Normalize and deduplicate incoming tags
    const normalizedTags = this.normalizeTags(tags);

    // Count existing tags
    const existingTagCount = await this.prisma.contractTag.count({
      where: { contractId },
    });

    // Get existing tag values to calculate truly new tags
    const existingTags = await this.prisma.contractTag.findMany({
      where: { contractId },
      select: { tag: true },
    });
    const existingTagSet = new Set(existingTags.map((t) => t.tag));

    // Calculate how many truly new tags would be added
    const newUniqueTags = normalizedTags.filter((t) => !existingTagSet.has(t));
    const totalAfterAdd = existingTagCount + newUniqueTags.length;

    if (totalAfterAdd > 20) {
      throw new UnprocessableEntityException(
        `Adding these tags would exceed the limit of 20 tags per contract. Current: ${existingTagCount}, new unique: ${newUniqueTags.length}.`,
      );
    }

    // Create tags (skipDuplicates handles race conditions)
    await this.prisma.contractTag.createMany({
      data: normalizedTags.map((tag) => ({
        contractId,
        tag,
      })),
      skipDuplicates: true,
    });

    // Return updated tag list
    const updatedTags = await this.prisma.contractTag.findMany({
      where: { contractId },
      select: { tag: true },
    });

    return {
      contractId,
      tags: updatedTags.map((t) => t.tag),
    };
  }

  /**
   * Remove tags from a contract.
   * - Normalizes tags before deletion
   */
  async removeTags(
    contractId: string,
    tags: string[],
    accountId: string,
  ): Promise<void> {
    // Validate contract exists and belongs to account
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    const normalizedTags = this.normalizeTags(tags);

    await this.prisma.contractTag.deleteMany({
      where: {
        contractId,
        tag: { in: normalizedTags },
      },
    });
  }

  /**
   * List distinct tags with contract count.
   * VIEWER: filtered by wallets in scopes only.
   */
  async listDistinctTags(
    accountId: string,
    userRole: string,
    userScopes?: string[],
  ): Promise<Array<{ tag: string; count: number }>> {
    // Build where clause for contract filtering
    const contractWhere: any = {
      accountId,
      deletedAt: null,
    };

    if (userRole === 'VIEWER') {
      if (!userScopes || userScopes.length === 0) {
        return [];
      }
      contractWhere.walletId = { in: userScopes };
    }

    // Use raw groupBy on ContractTag joining with Contract filter
    const results = await this.prisma.contractTag.groupBy({
      by: ['tag'],
      where: {
        contract: contractWhere,
      },
      _count: {
        tag: true,
      },
      orderBy: {
        tag: 'asc',
      },
    });

    return results.map((r) => ({
      tag: r.tag,
      count: r._count.tag,
    }));
  }
}
