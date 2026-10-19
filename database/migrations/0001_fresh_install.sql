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


CREATE VIEW v_active_models AS SELECT id, openrouter_slug AS code, name, modalities, capabilities, pricing FROM ai_models WHERE is_active = true;
