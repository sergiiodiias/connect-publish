CREATE INDEX IF NOT EXISTS idx_post_insights_target_captured ON public.post_insights (post_target_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_targets_status_published ON public.post_targets (status, published_at DESC) WHERE fb_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auto_comments_run_at ON public.auto_comments (run_at DESC);