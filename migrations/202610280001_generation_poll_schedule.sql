ALTER TABLE public.ai_generations
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_generations_video_next_check
  ON public.ai_generations (next_check_at, created_at)
  WHERE modality = 'video' AND status IN ('pending', 'submitted', 'queued', 'processing', 'running');
