CREATE INDEX IF NOT EXISTS idx_posts_status_sched ON public.posts(status, scheduled_at) WHERE status='scheduled';
CREATE INDEX IF NOT EXISTS idx_targets_post_status ON public.post_targets(post_id, status);
CREATE INDEX IF NOT EXISTS idx_targets_pending ON public.post_targets(status) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_comments_due ON public.auto_comments(status, run_at) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_target_post_page ON public.post_targets(post_id, page_id);