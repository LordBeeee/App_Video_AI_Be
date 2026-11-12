-- Fresh databases only. Run through npm run db:setup, which wraps this in a transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES roles(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  username VARCHAR(100) UNIQUE,
  avatar_url TEXT,
  phone VARCHAR(30),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  workflow_mode VARCHAR(50) NOT NULL DEFAULT 'video_only',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  prompt_step_status VARCHAR(50) NOT NULL DEFAULT 'skipped',
  image_step_status VARCHAR(50) NOT NULL DEFAULT 'skipped',
  video_step_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  scene_id BIGINT,
  asset_type VARCHAR(50) NOT NULL,
  asset_role VARCHAR(50),
  source_type VARCHAR(50) NOT NULL DEFAULT 'generated',
  original_url TEXT,
  stored_url TEXT NOT NULL,
  thumbnail_url TEXT,
  storage_provider VARCHAR(50),
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  duration_seconds INTEGER,
  fps INTEGER,
  width INTEGER,
  height INTEGER,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_assets_source_type CHECK (source_type IN ('uploaded', 'generated', 'external'))
);
CREATE INDEX idx_assets_user_created ON assets(user_id, created_at DESC);

-- The AI and wallet tables below match the current application schema.
CREATE TABLE ai_models (
  id BIGSERIAL PRIMARY KEY,
  openrouter_slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  author VARCHAR(100),
  description TEXT,
  modalities JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL DEFAULT '{}',
  pricing JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fx_rates (
  id BIGSERIAL PRIMARY KEY,
  base_currency VARCHAR(3) NOT NULL,
  quote_currency VARCHAR(3) NOT NULL,
  rate_date DATE NOT NULL,
  rate NUMERIC(18,6) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'frankfurter',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency, rate_date)
);

CREATE TABLE pricing_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modality VARCHAR(20) NOT NULL CHECK (modality IN ('image','video','audio','chat')),
  model_slug VARCHAR(255) NOT NULL,
  request JSONB NOT NULL DEFAULT '{}',
  provider_cost_min_usd NUMERIC(18,10) NOT NULL,
  provider_cost_max_usd NUMERIC(18,10) NOT NULL,
  usd_vnd_rate NUMERIC(18,6) NOT NULL,
  markup_rate NUMERIC(8,6) NOT NULL,
  min_price_vnd BIGINT NOT NULL,
  max_price_vnd BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricing_quotes_user_created ON pricing_quotes(user_id, created_at DESC);

CREATE TABLE wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_vnd BIGINT NOT NULL DEFAULT 0 CHECK (balance_vnd >= 0),
  held_vnd BIGINT NOT NULL DEFAULT 0 CHECK (held_vnd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  amount_vnd BIGINT NOT NULL,
  balance_after_vnd BIGINT NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_transactions_user_created ON wallet_transactions(user_id, created_at DESC);

CREATE TABLE topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  order_code BIGINT NOT NULL UNIQUE,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_link_id VARCHAR(255),
  checkout_url TEXT,
  qr_code TEXT,
  provider_reference VARCHAR(255) UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES pricing_quotes(id) ON DELETE SET NULL,
  wallet_hold_id UUID,
  modality VARCHAR(20) NOT NULL CHECK (modality IN ('image','video','audio','chat')),
  model_slug VARCHAR(255) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'openrouter',
  model_name_snapshot VARCHAR(255),
  provider_snapshot JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '{}',
  external_job_id VARCHAR(255),
  provider_generation_id VARCHAR(255),
  output_urls JSONB NOT NULL DEFAULT '[]',
  usage JSONB NOT NULL DEFAULT '{}',
  estimated_min_vnd BIGINT NOT NULL DEFAULT 0,
  estimated_max_vnd BIGINT NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(18,10),
  charged_vnd BIGINT,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  provider_status VARCHAR(30),
  processing_stage VARCHAR(40),
  sync_error_code VARCHAR(50),
  sync_error_message TEXT,
  last_sync_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_generations_user_created ON ai_generations(user_id, created_at DESC);
CREATE INDEX idx_ai_generations_video_next_check ON ai_generations(next_check_at, created_at)
  WHERE modality = 'video' AND status IN ('pending', 'submitted', 'queued', 'processing', 'running');
CREATE UNIQUE INDEX idx_ai_generations_external_job ON ai_generations(external_job_id)
  WHERE external_job_id IS NOT NULL;

CREATE TABLE wallet_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL UNIQUE REFERENCES pricing_quotes(id) ON DELETE CASCADE,
  generation_id UUID REFERENCES ai_generations(id) ON DELETE SET NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  settled_amount_vnd BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ai_generations ADD CONSTRAINT fk_ai_generations_wallet_hold
  FOREIGN KEY (wallet_hold_id) REFERENCES wallet_holds(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ai_generation_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL CHECK (role IN ('input','reference','output','thumbnail')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (generation_id, asset_id, role)
);
CREATE INDEX idx_ai_generation_assets_asset ON ai_generation_assets(asset_id);
CREATE UNIQUE INDEX uq_assets_generated_video_generation
  ON assets ((metadata->>'generationId'))
  WHERE asset_type = 'video' AND asset_role = 'output'
    AND source_type = 'generated' AND jsonb_exists(metadata, 'generationId')
    AND NOT jsonb_exists(metadata, 'duplicateOf');

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'Cuộc trò chuyện mới',
  model_slug VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user_updated ON conversations(user_id, updated_at DESC);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(18,10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at);


CREATE VIEW v_active_models AS SELECT id, openrouter_slug AS code, name, modalities, capabilities, pricing FROM ai_models WHERE is_active = true;

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
