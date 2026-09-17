-- Additive change for existing db:push installations. Apply before app rollout.
-- One statement for prepared-statement query editors; target schema follows search_path.
DO $migration$
BEGIN
CREATE TABLE IF NOT EXISTS "generated_pages" (
  "id" UUID PRIMARY KEY, "path" TEXT NOT NULL, "visitorHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "generated_pages_createdAt_idx" ON "generated_pages"("createdAt");
CREATE INDEX IF NOT EXISTS "generated_pages_path_visitorHash_idx" ON "generated_pages"("path", "visitorHash");
CREATE TABLE IF NOT EXISTS "page_feedback" (
  "generationId" UUID PRIMARY KEY REFERENCES "generated_pages"("id") ON DELETE CASCADE,
  "value" INTEGER NOT NULL CHECK ("value" IN (-1, 0, 1)), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "hot_search_snapshots" (
  "source" TEXT PRIMARY KEY, "items" JSONB NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "user_search_logs_createdAt_path_userHash_idx" ON "user_search_logs"("createdAt", "path", "userHash");
ALTER TABLE "generated_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "page_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hot_search_snapshots" ENABLE ROW LEVEL SECURITY;
END;
$migration$;
