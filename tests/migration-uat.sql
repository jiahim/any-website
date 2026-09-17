-- Dedicated disposable schema in the isolated local UAT database.
CREATE SCHEMA IF NOT EXISTS migration_uat;
SET search_path TO migration_uat;
CREATE TABLE IF NOT EXISTS user_search_logs (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, "userHash" TEXT NOT NULL,
  date TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO user_search_logs(id,path,"userHash",date) VALUES('preserved','保留原始日志','visitor','2026-09-14') ON CONFLICT DO NOTHING;
\i prisma/changes/20260914-hot-search-feedback.sql
\i prisma/changes/20260914-hot-search-feedback.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_search_logs WHERE id='preserved') THEN RAISE EXCEPTION 'legacy data lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='page_feedback'::regclass AND contype='c') THEN RAISE EXCEPTION 'missing feedback constraint'; END IF;
  IF (SELECT count(*) FROM pg_class WHERE relnamespace='migration_uat'::regnamespace AND relname IN ('generated_pages','page_feedback','hot_search_snapshots') AND relrowsecurity) <> 3 THEN RAISE EXCEPTION 'missing RLS'; END IF;
END $$;
SELECT 'migration passed; legacy data preserved; repeatable' AS result;
