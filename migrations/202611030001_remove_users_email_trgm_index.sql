-- The legacy trigram index forces PostgreSQL to load pg_trgm when planning
-- email lookups, failing on Windows hosts where App Control blocks its DLL.
-- Exact email lookups remain covered by the unique users_email_key B-tree.
-- No user data or uniqueness constraints are removed.
DROP INDEX IF EXISTS public.idx_users_email_trgm;

-- Optional rollback, after resolving the DLL block:
-- CREATE INDEX idx_users_email_trgm ON public.users USING gin (email gin_trgm_ops);
