-- Fast path for the wallet contract table: account/wallet scoping, active rows,
-- and the default newest-first ordering are served by a single index.
CREATE INDEX "Contract_accountId_walletId_deletedAt_createdAt_idx"
ON "Contract"("accountId", "walletId", "deletedAt", "createdAt" DESC);
