UPDATE public.post_targets SET status='pending', next_retry_at=NULL WHERE status='publishing' AND fb_post_id IS NULL;
UPDATE public.posts SET status='scheduled' WHERE status='publishing';