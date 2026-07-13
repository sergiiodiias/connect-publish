UPDATE public.auto_comments
SET status='pending',
    error=NULL,
    attempts=0,
    run_at=now() + interval '30 seconds'
WHERE status='failed'
  AND error ILIKE '%post não publicado%';