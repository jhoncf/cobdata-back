import { SetMetadata } from '@nestjs/common';

/** Marks the very small set of endpoints exposed to creditor-portal users. */
export const CREDITOR_PORTAL_KEY = 'creditorPortalAllowed';
export const CreditorPortalAccess = () => SetMetadata(CREDITOR_PORTAL_KEY, true);
