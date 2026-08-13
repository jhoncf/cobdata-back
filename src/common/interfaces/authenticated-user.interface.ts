export interface AuthenticatedUser {
  id: string;
  accountId: string;
  role: 'ADMIN' | 'OPERATIONAL' | 'VIEWER';
  sessionId: string;
  mustResetPassword?: boolean;
}
