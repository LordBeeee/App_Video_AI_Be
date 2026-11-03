-- Durable jobs survive physical deletion of their asset row. Safe to rerun.
CREATE TABLE IF NOT EXISTS public.asset_deletion_jobs (
  asset_id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  stored_url TEXT NOT NULL,
  targets JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.asset_deletion_jobs DROP CONSTRAINT IF EXISTS asset_deletion_jobs_status_check;
ALTER TABLE public.asset_deletion_jobs ADD CONSTRAINT asset_deletion_jobs_status_check CHECK (status IN ('pending','completed','failed'));
CREATE INDEX IF NOT EXISTS idx_asset_deletion_pending ON public.asset_deletion_jobs(next_attempt_at) WHERE status = 'pending';

-- One canonical identity for metadata, legacy URLs, thumbnails and source URLs.
CREATE OR REPLACE FUNCTION public.asset_cloudinary_identity(url TEXT, metadata JSONB DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE saved JSONB := metadata->'cloudinary'; parts TEXT[]; path TEXT; segment TEXT; bytes BYTEA := ''::bytea;
BEGIN
  IF saved->>'publicId' <> '' AND saved->>'resourceType' IN ('image','video','raw')
    AND saved->>'deliveryType' IN ('upload','private','authenticated') THEN
    RETURN jsonb_build_object('publicId',saved->>'publicId','resourceType',saved->>'resourceType','deliveryType',saved->>'deliveryType');
  END IF;
  parts := regexp_match(split_part(url, '?', 1), '^https?://res[.]cloudinary[.]com/[^/]+/(image|video|raw)/(upload|private|authenticated)/(.*)$');
  IF parts IS NULL THEN RETURN NULL; END IF;
  path := parts[3];
  IF path ~ '(^|/)v[0-9]+/' THEN
    path := regexp_replace(path, '^(.*/)?v[0-9]+/', '');
  ELSE
    path := regexp_replace(path, '^((so_|c_|w_|h_|q_|f_)[^/]*/)+', '');
  END IF;
  IF parts[1] <> 'raw' THEN path := regexp_replace(path, '[.][^/.]+$', ''); END IF;
  FOR segment IN SELECT (regexp_matches(path, '%[0-9a-fA-F]{2}|.', 'g'))[1] LOOP
    bytes := bytes || CASE WHEN left(segment,1) = '%' AND length(segment) = 3 THEN decode(substr(segment,2), 'hex') ELSE convert_to(segment, 'UTF8') END;
  END LOOP;
  path := convert_from(bytes, 'UTF8');
  IF path = '' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('publicId',path,'resourceType',parts[1],'deliveryType',parts[2]);
EXCEPTION WHEN character_not_in_repertoire OR invalid_parameter_value THEN RETURN NULL;
END $$;

-- Lock all referenced source rows in ID order. Consumers and deletes serialize.
CREATE OR REPLACE FUNCTION public.guard_deleting_asset_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source public.assets%ROWTYPE; source_ids TEXT[]; identities JSONB[] := '{}'; references_urls TEXT[] := '{}';
BEGIN
  IF TG_TABLE_NAME = 'ai_generation_assets' THEN
    SELECT * INTO source FROM public.assets WHERE id = NEW.asset_id FOR UPDATE;
    IF source.metadata->>'deleteStatus' IN ('processing','failed') OR EXISTS (SELECT 1 FROM public.asset_deletion_jobs WHERE asset_id = NEW.asset_id) THEN
      RAISE EXCEPTION 'Tai nguyen dang duoc xoa' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'ai_generations' THEN
    IF TG_OP = 'UPDATE' AND NEW.options IS NOT DISTINCT FROM OLD.options THEN RETURN NEW; END IF;
    SELECT array_agg(url) INTO references_urls FROM (
      SELECT jsonb_array_elements_text(COALESCE(NEW.options->'referenceUrls','[]')) AS url
      UNION SELECT value->>'url' FROM jsonb_array_elements(COALESCE(NEW.options->'referenceInputs','[]'))
    ) refs;
  ELSE
    -- Deleted Kling records retain their source URLs for history, not active use.
    IF NEW.metadata->>'deleteStatus' = 'succeed' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.stored_url IS NOT DISTINCT FROM OLD.stored_url
      AND NEW.thumbnail_url IS NOT DISTINCT FROM OLD.thumbnail_url
      AND NEW.metadata->'sourceUrls' IS NOT DISTINCT FROM OLD.metadata->'sourceUrls'
      AND NEW.metadata->'sampleAssetId' IS NOT DISTINCT FROM OLD.metadata->'sampleAssetId'
      AND NEW.metadata->'cloudinary' IS NOT DISTINCT FROM OLD.metadata->'cloudinary'
      AND OLD.metadata->>'deleteStatus' IS DISTINCT FROM 'succeed' THEN RETURN NEW; END IF;
    references_urls := ARRAY[NEW.stored_url,NEW.thumbnail_url] || ARRAY(SELECT jsonb_array_elements_text(COALESCE(NEW.metadata->'sourceUrls','[]')));
    source_ids := ARRAY[NEW.metadata->>'sampleAssetId'];
    identities := ARRAY[public.asset_cloudinary_identity(NEW.stored_url,NEW.metadata)];
  END IF;
  identities := identities || ARRAY(SELECT public.asset_cloudinary_identity(url) FROM unnest(references_urls) url);
  FOR source IN SELECT * FROM public.assets a WHERE
    (TG_TABLE_NAME = 'ai_generations' OR a.id::text <> NEW.id::text) AND (
      a.id::text = ANY(source_ids) OR a.stored_url = ANY(references_urls) OR
      public.asset_cloudinary_identity(a.stored_url,a.metadata) = ANY(identities)
    ) ORDER BY a.id FOR UPDATE
  LOOP
    IF source.metadata->>'deleteStatus' IN ('processing','failed') THEN
      RAISE EXCEPTION 'Tai nguyen dang duoc xoa' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.asset_deletion_jobs j WHERE
    (TG_TABLE_NAME = 'ai_generations' OR j.asset_id::text <> NEW.id::text) AND (
      j.asset_id::text = ANY(source_ids) OR j.stored_url = ANY(references_urls) OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(j.targets) target WHERE target = ANY(identities))
    )) THEN
    RAISE EXCEPTION 'Tai nguyen dang duoc xoa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_asset_link_deletion ON public.ai_generation_assets;
CREATE TRIGGER guard_asset_link_deletion BEFORE INSERT OR UPDATE OF asset_id ON public.ai_generation_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_deleting_asset_references();
DROP TRIGGER IF EXISTS guard_generation_reference_deletion ON public.ai_generations;
CREATE TRIGGER guard_generation_reference_deletion BEFORE INSERT OR UPDATE OF options ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION public.guard_deleting_asset_references();
DROP TRIGGER IF EXISTS guard_custom_asset_source_deletion ON public.assets;
CREATE TRIGGER guard_custom_asset_source_deletion BEFORE INSERT OR UPDATE OF stored_url, thumbnail_url, metadata ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_deleting_asset_references();
CREATE OR REPLACE FUNCTION public.asset_deletion_schema_version() RETURNS INTEGER LANGUAGE sql IMMUTABLE AS 'SELECT 2';
