import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

@Injectable()
export class DeduplicationService {
  /**
   * Compute the deduplication key for a contract.
   * The key is a SHA-256 hash of the concatenation:
   *   creditorId | sha256(debtorDocument) | contractNumber | sha256(debtOriginDocument) or ''
   *
   * IMPORTANT: creditorId is resolved from wallet.creditorId by the caller.
   * The API receives walletId, the service resolves creditorId via lookup.
   */
  computeDeduplicationKey(data: {
    creditorId: string;
    debtorDocument: string;
    contractNumber: string;
    debtOriginDocument?: string;
  }): string {
    const input = [
      data.creditorId,
      this.sha256(data.debtorDocument),
      data.contractNumber,
      data.debtOriginDocument ? this.sha256(data.debtOriginDocument) : '',
    ].join('|');

    return this.sha256(input);
  }

  /**
   * Compute SHA-256 hash of a string, returning hex digest.
   */
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
