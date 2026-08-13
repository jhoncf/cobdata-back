import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditMetadata {
  action: string;
  resourceType: string;
}

export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_ACTION_KEY, metadata);
