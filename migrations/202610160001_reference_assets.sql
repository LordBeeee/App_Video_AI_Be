BEGIN;

ALTER TABLE public.assets
  DROP CONSTRAINT chk_assets_source_type;

ALTER TABLE public.assets
  ADD CONSTRAINT chk_assets_source_type
  CHECK (source_type IN ('uploaded', 'generated', 'external', 'reference'));

COMMIT;
