ALTER TABLE public.fb_pages
  ADD COLUMN IF NOT EXISTS comment_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS comment_368_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_368_last_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_fb_pages_comment_cooldown ON public.fb_pages(comment_cooldown_until) WHERE comment_cooldown_until IS NOT NULL;