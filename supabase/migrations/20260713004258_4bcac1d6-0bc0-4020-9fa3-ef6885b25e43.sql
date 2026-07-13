UPDATE public.auto_comments
SET run_at = now() + interval '5 minutes'
WHERE status='pending' AND target_id IS NOT NULL AND fb_comment_id IS NULL;