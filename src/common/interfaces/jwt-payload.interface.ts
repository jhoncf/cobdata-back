export interface JwtPayload {
  sub: string; // userId (UUID)
  accountId: string; // Account UUID
  creditorId?: string | null;
  role: 'ADMIN' | 'OPERATIONAL' | 'VIEWER';
  sessionId: string; // Session UUID
  mustResetPassword?: boolean; // Present and true when user must reset
  iat: number;
  exp: number;
}
