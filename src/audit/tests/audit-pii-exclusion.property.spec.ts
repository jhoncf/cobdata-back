import * as fc from 'fast-check';
import { AuditService, AuditLogEntry } from '../audit.service';

/**
 * Property 27: Audit entries exclude PII
 *
 * **Validates: Requirements 20.3, 20.4**
 *
 * For any audit entry, the metadata field SHALL NOT contain:
 * - CPF (Brazilian individual tax ID: 11 digits, with or without formatting)
 * - CNPJ (Brazilian corporate tax ID: 14 digits, with or without formatting)
 * - Email addresses
 * - Phone numbers (Brazilian format)
 * - Password values
 * - JWT tokens
 */
describe('Property 27: Audit entries exclude PII', () => {
  let service: AuditService;
  let createdEntries: any[];

  // PII generators
  const cpfArb = fc
    .tuple(
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 10, max: 99 }),
    )
    .map(([a, b, c, d]) => `${a}.${b}.${c}-${d}`);

  const cnpjArb = fc
    .tuple(
      fc.integer({ min: 10, max: 99 }),
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 1000, max: 9999 }),
      fc.integer({ min: 10, max: 99 }),
    )
    .map(([a, b, c, d, e]) => `${a}.${b}.${c}/${String(d).padStart(4, '0')}-${e}`);

  const emailArb = fc
    .tuple(
      fc.string({ minLength: 3, maxLength: 10 }).filter((s) => /^[a-z]+$/.test(s)),
      fc.string({ minLength: 3, maxLength: 8 }).filter((s) => /^[a-z]+$/.test(s)),
    )
    .map(([user, domain]) => `${user}@${domain}.com`);

  const phoneArb = fc
    .tuple(
      fc.integer({ min: 11, max: 99 }),
      fc.integer({ min: 90000, max: 99999 }),
      fc.integer({ min: 1000, max: 9999 }),
    )
    .map(([ddd, prefix, suffix]) => `+55 ${ddd} ${prefix}-${suffix}`);

  const jwtArb = fc.constant(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  );

  // Combine all PII into metadata
  const piiMetadataArb = fc.oneof(
    cpfArb.map((cpf) => ({ document: cpf })),
    cnpjArb.map((cnpj) => ({ corporateId: cnpj })),
    emailArb.map((email) => ({ userEmail: email })),
    phoneArb.map((phone) => ({ phone: phone })),
    jwtArb.map((jwt) => ({ token: jwt })),
  );

  beforeEach(() => {
    createdEntries = [];
    const mockPrisma = {
      auditLog: {
        create: jest.fn().mockImplementation(({ data }) => {
          createdEntries.push(data);
          return Promise.resolve({ ...data, id: 'test-id', createdAt: new Date() });
        }),
      },
    };

    service = new AuditService(mockPrisma as any);
  });

  it('metadata with PII is always discarded (set to null)', async () => {
    await fc.assert(
      fc.asyncProperty(piiMetadataArb, async (piiMetadata) => {
        createdEntries = [];

        const entry: AuditLogEntry = {
          action: 'TEST_ACTION',
          requestId: '770e8400-e29b-41d4-a716-446655440000',
          metadata: piiMetadata as Record<string, unknown>,
        };

        await service.log(entry);

        expect(createdEntries.length).toBe(1);
        const stored = createdEntries[0];

        // When metadata contains PII, it should be discarded
        const metadataStr = JSON.stringify(stored.metadata);
        // Verify no PII patterns in stored metadata
        const piiPatterns = [
          /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,  // CPF
          /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/, // CNPJ
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
          /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}/, // Phone
          /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, // JWT
        ];

        for (const pattern of piiPatterns) {
          expect(pattern.test(metadataStr)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('containsPII correctly identifies all PII types', () => {
    fc.assert(
      fc.property(
        fc.oneof(cpfArb, cnpjArb, emailArb, phoneArb, jwtArb),
        (piiValue) => {
          expect(service.containsPII(piiValue)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('non-PII metadata is preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z_]+$/.test(s)),
          fc.constantFrom('GET', 'POST', 'PATCH', 'DELETE', '/api/wallets', '/api/contracts', 'success', 'failed'),
          { minKeys: 1, maxKeys: 3 },
        ),
        async (safeMetadata) => {
          createdEntries = [];

          const entry: AuditLogEntry = {
            action: 'TEST_ACTION',
            requestId: '770e8400-e29b-41d4-a716-446655440000',
            metadata: safeMetadata,
          };

          await service.log(entry);

          expect(createdEntries.length).toBe(1);
          const stored = createdEntries[0];

          // Safe metadata should be preserved
          expect(stored.metadata).toEqual(safeMetadata);
        },
      ),
      { numRuns: 50 },
    );
  });
});
