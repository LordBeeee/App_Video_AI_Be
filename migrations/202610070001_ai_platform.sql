BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP VIEW IF EXISTS v_active_models CASCADE;
DROP VIEW IF EXISTS v_generation_costs CASCADE;
DROP VIEW IF EXISTS v_project_cost_summary CASCADE;
DROP VIEW IF EXISTS v_project_progress CASCADE;
DROP VIEW IF EXISTS v_system_daily_stats CASCADE;
DROP VIEW IF EXISTS v_user_stats CASCADE;

ALTER TABLE ai_models RENAME TO legacy_ai_models;
ALTER SEQUENCE IF EXISTS ai_models_id_seq RENAME TO legacy_ai_models_id_seq;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_generations_user_created ON ai_generations(user_id, created_at DESC);
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
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(18,10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at);

CREATE TEMP TABLE legacy_video_map (
  legacy_id BIGINT PRIMARY KEY,
  generation_id UUID NOT NULL DEFAULT gen_random_uuid()
) ON COMMIT DROP;
INSERT INTO legacy_video_map (legacy_id) SELECT id FROM video_generations;

INSERT INTO ai_generations (
  id, user_id, project_id, modality, model_slug, source, model_name_snapshot,
  provider_snapshot, status, prompt, options, external_job_id, output_urls,
  estimated_min_vnd, estimated_max_vnd, charged_vnd, error_message,
  completed_at, created_at, updated_at
)
SELECT
  map.generation_id,
  p.user_id,
  vg.project_id,
  'video',
  'legacy/' || lm.code,
  'legacy_kling',
  lm.name,
  jsonb_build_object('provider', lp.code, 'legacyModelId', lm.id, 'legacyGenerationId', vg.id),
  vg.status,
  vg.motion_prompt,
  COALESCE(vg.params, '{}') || jsonb_build_object(
    'duration', vg.duration_seconds,
    'aspectRatio', vg.generation_ratio,
    'fps', vg.fps,
    'sound', vg.generation_sound,
    'generationMode', vg.generation_mode
  ),
  vg.external_task_id,
  CASE WHEN output_asset.stored_url IS NULL THEN '[]'::jsonb
       ELSE jsonb_build_array(output_asset.stored_url) END,
  COALESCE(vg.cost, 0),
  COALESCE(vg.cost, 0),
  vg.cost,
  vg.error_message,
  vg.completed_at,
  vg.created_at,
  vg.updated_at
FROM video_generations vg
JOIN legacy_video_map map ON map.legacy_id = vg.id
JOIN projects p ON p.id = vg.project_id
JOIN legacy_ai_models lm ON lm.id = vg.model_id
JOIN ai_providers lp ON lp.id = lm.provider_id
LEFT JOIN assets output_asset ON output_asset.id = vg.output_asset_id;

INSERT INTO ai_generation_assets (generation_id, asset_id, role)
SELECT map.generation_id, links.asset_id, links.role
FROM video_generations vg
JOIN legacy_video_map map ON map.legacy_id = vg.id
CROSS JOIN LATERAL (
  VALUES
    (vg.image_begin_asset_id, 'input'),
    (vg.image_end_asset_id, 'reference'),
    (vg.output_asset_id, 'output'),
    (vg.thumbnail_asset_id, 'thumbnail')
) AS links(asset_id, role)
WHERE links.asset_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE legacy_count BIGINT;
DECLARE migrated_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_count FROM video_generations;
  SELECT COUNT(*) INTO migrated_count FROM ai_generations WHERE source = 'legacy_kling';
  IF migrated_count <> legacy_count THEN
    RAISE EXCEPTION 'Legacy video migration mismatch: expected %, got %', legacy_count, migrated_count;
  END IF;
END $$;

DROP TABLE IF EXISTS video_generation_elements CASCADE;
DROP TABLE IF EXISTS ai_element_images CASCADE;
DROP TABLE IF EXISTS ai_element_videos CASCADE;
DROP TABLE IF EXISTS ai_elements CASCADE;
DROP TABLE IF EXISTS motion_generations CASCADE;
DROP TABLE IF EXISTS video_generations CASCADE;
DROP TABLE IF EXISTS image_generations CASCADE;
DROP TABLE IF EXISTS prompt_generations CASCADE;
DROP TABLE legacy_ai_models CASCADE;
DROP TABLE ai_providers CASCADE;

CREATE VIEW v_active_models AS
SELECT id, openrouter_slug AS code, name, modalities, capabilities, pricing
FROM ai_models WHERE is_active = true;

CREATE VIEW v_user_stats AS
SELECT
  u.id AS user_id,
  COUNT(g.id) FILTER (WHERE g.modality = 'chat' AND g.status = 'succeeded') AS total_prompts,
  COUNT(g.id) FILTER (WHERE g.modality = 'image' AND g.status = 'succeeded') AS total_images,
  COUNT(g.id) FILTER (WHERE g.modality = 'video' AND g.status = 'succeeded') AS total_videos,
  0::bigint AS total_motions,
  COALESCE(SUM(g.charged_vnd) FILTER (WHERE g.status = 'succeeded'), 0)::bigint AS total_cost
FROM users u LEFT JOIN ai_generations g ON g.user_id = u.id
GROUP BY u.id;

CREATE VIEW v_system_daily_stats AS
SELECT
  (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
  modality AS task_type,
  COUNT(*)::bigint AS cnt,
  COALESCE(SUM(charged_vnd), 0)::bigint AS cost
FROM ai_generations
WHERE status = 'succeeded'
GROUP BY 1, 2;

COMMIT;
