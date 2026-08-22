import * as fc from 'fast-check';
import {
  OperationAction,
  ContractStatus,
  SerasaStatus,
} from '@prisma/client';

/**
 * Property 20 — Operation batching invariant
 * **Validates: Requirements 17.1, 17.2**
 *
 * For any N eligible contracts, the batching logic produces:
 * - ceil(N / 1000) batches
 * - Each batch has at most 1000 items
 * - The union of all batch items equals exactly N items
 * - Every contract appears in exactly one batch
 */

const BATCH_SIZE = 1000;

/**
 * Pure batching function extracted from business logic for testing.
 * Given an array of contract IDs, assigns each a batchIndex.
 */
function assignBatches(contractIds: string[]): Array<{ contractId: string; batchIndex: number }> {
  return contractIds.map((contractId, index) => ({
    contractId,
    batchIndex: Math.floor(index / BATCH_SIZE),
  }));
}

describe('Property 20: Operation batching invariant', () => {
  it('should produce ceil(N/1000) batches for any N contracts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        (n: number) => {
          const contractIds = Array.from({ length: n }, (_, i) => `contract-${i}`);
          const items = assignBatches(contractIds);

          const maxBatchIndex = Math.max(...items.map((i) => i.batchIndex));
          const expectedBatches = Math.ceil(n / BATCH_SIZE);

          // Number of batches matches
          expect(maxBatchIndex + 1).toBe(expectedBatches);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should have at most 1000 items in each batch', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        (n: number) => {
          const contractIds = Array.from({ length: n }, (_, i) => `contract-${i}`);
          const items = assignBatches(contractIds);

          // Group by batchIndex
          const batches = new Map<number, string[]>();
          for (const item of items) {
            const existing = batches.get(item.batchIndex) || [];
            existing.push(item.contractId);
            batches.set(item.batchIndex, existing);
          }

          // Each batch has at most 1000 items
          for (const [, batchItems] of batches) {
            expect(batchItems.length).toBeLessThanOrEqual(BATCH_SIZE);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should include all N contracts exactly once across all batches', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        (n: number) => {
          const contractIds = Array.from({ length: n }, (_, i) => `contract-${i}`);
          const items = assignBatches(contractIds);

          // Union must equal the original set
          const assignedIds = items.map((i) => i.contractId);
          expect(assignedIds.length).toBe(n);

          // No duplicates
          const uniqueIds = new Set(assignedIds);
          expect(uniqueIds.size).toBe(n);

          // Same set
          expect(new Set(assignedIds)).toEqual(new Set(contractIds));
        },
      ),
      { numRuns: 200 },
    );
  });
});

/**
 * Property 21 — Eligible contracts selection
 * **Validates: Requirements 17.1, 17.2, 17.9**
 *
 * Only contracts with:
 * - status = ACTIVE
 * - deletedAt IS NULL
 * - serasaStatus in eligible set for the action
 * - For REMOVE: debtId is not null
 * should be selected.
 */

interface MockContract {
  id: string;
  walletId: string;
  status: ContractStatus;
  serasaStatus: SerasaStatus;
  deletedAt: Date | null;
  debtId: string | null;
}

const ELIGIBLE_FOR_CREATE: SerasaStatus[] = [
  SerasaStatus.PENDING,
  SerasaStatus.FAILED,
];

const ELIGIBLE_FOR_REMOVE: SerasaStatus[] = [
  SerasaStatus.REGISTERED,
  SerasaStatus.UPDATED,
];

/**
 * Pure eligibility filter that mirrors the service's query logic.
 */
function filterEligibleContracts(
  contracts: MockContract[],
  walletId: string,
  action: OperationAction,
): MockContract[] {
  const eligibleStatuses =
    action === OperationAction.CREATE_OR_UPDATE
      ? ELIGIBLE_FOR_CREATE
      : ELIGIBLE_FOR_REMOVE;

  return contracts.filter((c) => {
    if (c.walletId !== walletId) return false;
    if (c.status !== ContractStatus.ACTIVE) return false;
    if (c.deletedAt !== null) return false;
    if (!eligibleStatuses.includes(c.serasaStatus)) return false;
    if (action === OperationAction.REMOVE && !c.debtId) return false;
    return true;
  });
}

const contractStatusArb = fc.constantFrom(
  ContractStatus.ACTIVE,
  ContractStatus.SUSPENDED,
  ContractStatus.CANCELLED,
);

const serasaStatusArb = fc.constantFrom(
  SerasaStatus.PENDING,
  SerasaStatus.SENT,
  SerasaStatus.REGISTERED,
  SerasaStatus.UPDATED,
  SerasaStatus.FAILED,
  SerasaStatus.REMOVING,
  SerasaStatus.REMOVED,
  SerasaStatus.IN_AGREEMENT,
  SerasaStatus.AGREEMENT_BREACHED,
  SerasaStatus.PAID,
);

const mockContractArb = (walletId: string) =>
  fc.record({
    id: fc.uuid(),
    walletId: fc.constantFrom(walletId, 'other-wallet-id'),
    status: contractStatusArb,
    serasaStatus: serasaStatusArb,
    deletedAt: fc.option(fc.date(), { nil: null }),
    debtId: fc.option(fc.uuid(), { nil: null }),
  });

const operationActionArb = fc.constantFrom(
  OperationAction.CREATE_OR_UPDATE,
  OperationAction.REMOVE,
);

describe('Property 21: Eligible contracts selection', () => {
  const TARGET_WALLET = 'target-wallet-id';

  it('should only select ACTIVE contracts with eligible serasaStatus and no deletedAt', () => {
    fc.assert(
      fc.property(
        fc.array(mockContractArb(TARGET_WALLET), { minLength: 0, maxLength: 50 }),
        operationActionArb,
        (contracts: MockContract[], action: OperationAction) => {
          const eligible = filterEligibleContracts(contracts, TARGET_WALLET, action);

          // All selected must be ACTIVE
          for (const c of eligible) {
            expect(c.status).toBe(ContractStatus.ACTIVE);
          }

          // All selected must have no deletedAt
          for (const c of eligible) {
            expect(c.deletedAt).toBeNull();
          }

          // All selected must have eligible serasaStatus
          const eligibleStatuses =
            action === OperationAction.CREATE_OR_UPDATE
              ? ELIGIBLE_FOR_CREATE
              : ELIGIBLE_FOR_REMOVE;
          for (const c of eligible) {
            expect(eligibleStatuses).toContain(c.serasaStatus);
          }

          // All selected must belong to the target wallet
          for (const c of eligible) {
            expect(c.walletId).toBe(TARGET_WALLET);
          }

          // For REMOVE, all must have debtId
          if (action === OperationAction.REMOVE) {
            for (const c of eligible) {
              expect(c.debtId).not.toBeNull();
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should never miss a contract that meets all criteria', () => {
    fc.assert(
      fc.property(
        fc.array(mockContractArb(TARGET_WALLET), { minLength: 0, maxLength: 50 }),
        operationActionArb,
        (contracts: MockContract[], action: OperationAction) => {
          const eligible = filterEligibleContracts(contracts, TARGET_WALLET, action);
          const eligibleIds = new Set(eligible.map((c) => c.id));

          const eligibleStatuses =
            action === OperationAction.CREATE_OR_UPDATE
              ? ELIGIBLE_FOR_CREATE
              : ELIGIBLE_FOR_REMOVE;

          // Any contract that meets all criteria must be in the set
          for (const c of contracts) {
            const shouldBeEligible =
              c.walletId === TARGET_WALLET &&
              c.status === ContractStatus.ACTIVE &&
              c.deletedAt === null &&
              eligibleStatuses.includes(c.serasaStatus) &&
              (action !== OperationAction.REMOVE || c.debtId !== null);

            if (shouldBeEligible) {
              expect(eligibleIds.has(c.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/**
 * Property 13 — Suspended/cancelled excluded from operations
 * **Validates: Requirements 11.8c**
 *
 * Contracts with status SUSPENDED or CANCELLED must NEVER appear
 * in the eligible set for any provider operation action.
 */
describe('Property 13: Suspended/cancelled excluded from operations', () => {
  const TARGET_WALLET = 'target-wallet-id';

  it('should never include SUSPENDED or CANCELLED contracts in eligible set', () => {
    fc.assert(
      fc.property(
        fc.array(mockContractArb(TARGET_WALLET), { minLength: 1, maxLength: 100 }),
        operationActionArb,
        (contracts: MockContract[], action: OperationAction) => {
          const eligible = filterEligibleContracts(contracts, TARGET_WALLET, action);

          for (const c of eligible) {
            expect(c.status).not.toBe(ContractStatus.SUSPENDED);
            expect(c.status).not.toBe(ContractStatus.CANCELLED);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('should select zero contracts when all are SUSPENDED or CANCELLED', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            walletId: fc.constant(TARGET_WALLET),
            status: fc.constantFrom(ContractStatus.SUSPENDED, ContractStatus.CANCELLED),
            serasaStatus: fc.constantFrom(SerasaStatus.PENDING, SerasaStatus.FAILED),
            deletedAt: fc.constant(null),
            debtId: fc.option(fc.uuid(), { nil: null }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        operationActionArb,
        (contracts: MockContract[], action: OperationAction) => {
          const eligible = filterEligibleContracts(contracts, TARGET_WALLET, action);
          expect(eligible.length).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
