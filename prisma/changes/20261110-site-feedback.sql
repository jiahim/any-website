-- Additive migration for existing db:push installations. Apply before the application update.
DO $migration$
BEGIN
  CREATE TABLE IF NOT EXISTS "site_feedback" (
    "id" UUID PRIMARY KEY,
    "visitorHash" TEXT NOT NULL,
    "submissionId" UUID NOT NULL,
    "message" TEXT NOT NULL CHECK (char_length("message") BETWEEN 1 AND 500),
    "screenshotMimeType" TEXT,
    "screenshotBytes" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailStatus" TEXT NOT NULL DEFAULT 'disabled'
      CHECK ("mailStatus" IN ('disabled', 'pending', 'sending', 'sent', 'failed', 'unknown')),
    "mailAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("mailAttempts" BETWEEN 0 AND 4),
    "mailNextAttemptAt" TIMESTAMP(3),
    "mailClaimedAt" TIMESTAMP(3),
    "mailSentAt" TIMESTAMP(3),
    CONSTRAINT "site_feedback_screenshot_check" CHECK (
      ("screenshotMimeType" IS NULL AND "screenshotBytes" IS NULL)
      OR ("screenshotMimeType" IS NOT NULL AND "screenshotBytes" IS NOT NULL
        AND "screenshotMimeType" IN ('image/png', 'image/jpeg', 'image/webp')
        AND octet_length("screenshotBytes") BETWEEN 1 AND 2097152)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "site_feedback_visitorHash_submissionId_key"
    ON "site_feedback" ("visitorHash", "submissionId");
  CREATE INDEX IF NOT EXISTS "site_feedback_visitorHash_createdAt_idx"
    ON "site_feedback" ("visitorHash", "createdAt");
  CREATE INDEX IF NOT EXISTS "site_feedback_mailStatus_mailNextAttemptAt_idx"
    ON "site_feedback" ("mailStatus", "mailNextAttemptAt");
  ALTER TABLE "site_feedback" ENABLE ROW LEVEL SECURITY;
END;
$migration$;
