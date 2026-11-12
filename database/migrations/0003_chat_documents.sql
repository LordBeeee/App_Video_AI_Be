ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;
