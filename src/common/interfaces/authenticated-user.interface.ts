export interface AuthenticatedUser {
  id: string;
  accountId: string;
  creditorId?: string | null;
  role: 'ADMIN' | 'OPERATIONAL' | 'VIEWER';
  sessionId: string;
  mustResetPassword?: boolean;
}
