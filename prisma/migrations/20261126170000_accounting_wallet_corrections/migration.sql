-- Admin wallet write-offs are balance corrections, not profit or loss: give them their own
-- equity account and move the journal lines already derived from them out of "Unmatched".
INSERT INTO "LedgerAccounts" ("id", "code", "name", "type", "description", "isSystem")
VALUES ('acc_wallet_corrections', '3200', 'Wallet balance corrections', 'equity',
        'Manual wallet adjustments made by an administrator. Not part of profit.', true)
ON CONFLICT ("code") DO NOTHING;

UPDATE "JournalLines" AS l
SET "accountId" = (SELECT "id" FROM "LedgerAccounts" WHERE "code" = '3200')
FROM "JournalEntries" AS e
WHERE l."entryId" = e."id"
  AND l."accountId" = (SELECT "id" FROM "LedgerAccounts" WHERE "code" = '6990')
  AND e."source" = 'auto'
  AND e."sourceKey" IN (
    SELECT 'cwl:' || "id" FROM "CustomerWalletLedger" WHERE "kind" = 'admin_adjustment'
    UNION ALL
    SELECT 'twl:' || "id" FROM "TaskerWalletLedger" WHERE "kind" = 'admin_adjustment'
  );
