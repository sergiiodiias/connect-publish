ALTER TABLE public.fb_pages
  ADD COLUMN IF NOT EXISTS daily_comment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_comment_reset_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_auto_comments_page_link_recent
  ON public.auto_comments (target_id, posted_at DESC)
  WHERE fb_comment_id IS NOT NULL;