ALTER TABLE public.ai_generations
  ADD COLUMN IF NOT EXISTS provider_status varchar(30),
  ADD COLUMN IF NOT EXISTS processing_stage varchar(40),
  ADD COLUMN IF NOT EXISTS sync_error_code varchar(50),
  ADD COLUMN IF NOT EXISTS sync_error_message text,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;
