import * as fc from 'fast-check';
import { AuditService, AuditLogEntry } from '../audit.service';

/**
 * Property 26: Audit entry structural completeness
 *
 * **Validates: Requirements 20.1-20.5**
 *
 * For any valid audit log entry, the structure SHALL contain:
 * - action (non-empty string)
 * - userId (when applicable, valid UUID or null)
 * - resourceType (string or null)
 * - resourceId (string or null)
 * - timestamp in ISO 8601 format
 * - requestId as UUID v4
 * - metadata ≤ 4KB (when present)
 */
describe('Property 26: Audit entry structural completeness', () => {
  let service: AuditService;
  let createdEntries: any[];

  const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  // Valid audit actions from design doc
  const VALID_ACTIONS = [
    'AUTH_LOGIN_SUCCESS',
    'AUTH_LOGIN_FAILED',
    'AUTH_LOGOUT',
    'AUTH_REFRESH',
    'AUTH_PASSWORD_CHANGE',
    'AUTH_PASSWORD_RESET',
    'AUTH_FORCE_RESET',
    'AUTH_RATE_LIMIT_TRIGGERED',
    'USER_INVITE',
    'USER_ACTIVATE',
    'USER_UPDATE',
    'USER_DEACTIVATE',
    'CREDITOR_CREATE',
    'CREDITOR_UPDATE',
    'CREDITOR_DELETE',
    'WALLET_CREATE',
    'WALLET_UPDATE',
    'WALLET_DELETE',
    'CONTRACT_CREATE',
    'CONTRACT_UPDATE',
    'CONTRACT_DELETE',
    'CONTRACT_TAG_ADD',
    'CONTRACT_TAG_REMOVE',
    'IMPORT_UPLOAD',
    'IMPORT_CONFIRM',
    'IMPORT_CANCEL',
    'PROVIDER_CONFIG_CREATE',
    'PROVIDER_CONFIG_UPDATE',
    'PROVIDER_WALLET_MAP',
    'OPERATION_CREATE',
    'OPERATION_CANCEL',
    'WEBHOOK_RECEIVED',
    'WEBHOOK_PROCESSED',
  ] as const;

  // Arbitrary generators
  const uuidArb = fc.uuid().filter((u) => UUID_V4_REGEX.test(u));
  const actionArb = fc.constantFrom(...VALID_ACTIONS);
  const resourceTypeArb = fc.constantFrom(
    'session',
    'user',
    'creditor',
    'wallet',
    'contract',
    'import_batch',
    'provider',
    'operation',
    'webhook',
  );

  const safeMetadataArb = fc
    .dictionary(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z_]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
        // No PII patterns
        return (
          !/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(s) &&
          !/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(s) &&
          !/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(s) &&
          !s.includes('eyJ')
        );
      }),
      { minKeys: 0, maxKeys: 5 },
    )
    .filter((d) => JSON.stringify(d).length <= 4096);

  const auditEntryArb = fc.record({
    action: actionArb,
    userId: fc.option(uuidArb, { nil: null }),
    resourceType: fc.option(resourceTypeArb, { nil: null }),
    resourceId: fc.option(uuidArb, { nil: null }),
    requestId: uuidArb,
    ipAddress: fc.option(
      fc.ipV4().map((ip) => ip),
      { nil: null },
    ),
    metadata: fc.option(safeMetadataArb, { nil: null }),
  });

  beforeEach(() => {
    createdEntries = [];
    const mockPrisma = {
      auditLog: {
        create: jest.fn().mockImplementation(({ data }) => {
          const stored = {
            ...data,
            id: '00000000-0000-4000-8000-000000000000',
            createdAt: new Date(),
          };
          createdEntries.push(stored);
          return Promise.resolve(stored);
        }),
      },
    };

    service = new AuditService(mockPrisma as any);
  });

  it('every audit entry has required structural fields', async () => {
    await fc.assert(
      fc.asyncProperty(auditEntryArb, async (entry) => {
        createdEntries = [];
        await service.log(entry as AuditLogEntry);

        // Entry was persisted
        expect(createdEntries.length).toBe(1);
        const stored = createdEntries[0];

        // action is non-empty string
        expect(typeof stored.action).toBe('string');
        expect(stored.action.length).toBeGreaterThan(0);

        // requestId is UUID v4
        expect(UUID_V4_REGEX.test(stored.requestId)).toBe(true);

        // createdAt is a valid date (ISO 8601)
        expect(stored.createdAt instanceof Date).toBe(true);
        expect(ISO_8601_REGEX.test(stored.createdAt.toISOString())).toBe(true);

        // userId is either null or UUID
        if (stored.userId !== null) {
          expect(UUID_V4_REGEX.test(stored.userId)).toBe(true);
        }

        // If metadata is present (not Prisma.JsonNull), it's ≤ 4KB
        if (
          stored.metadata !== null &&
          typeof stored.metadata === 'object' &&
          !('__prisma_null' in (stored.metadata as object))
        ) {
          expect(JSON.stringify(stored.metadata).length).toBeLessThanOrEqual(
            4096,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
