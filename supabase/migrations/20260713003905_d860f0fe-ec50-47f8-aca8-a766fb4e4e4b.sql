UPDATE public.auto_comments
SET run_at = GREATEST(run_at, now() + interval '3 minutes')
WHERE status='pending' AND target_id IS NOT NULL AND fb_comment_id IS NULL;