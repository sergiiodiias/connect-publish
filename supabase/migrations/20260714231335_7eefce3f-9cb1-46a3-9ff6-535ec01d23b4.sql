
-- Destrava targets em 'publishing' sem fb_post_id (reaper manual imediato).
UPDATE public.post_targets
SET status = 'pending', error = NULL, next_retry_at = NULL
WHERE status = 'publishing' AND fb_post_id IS NULL;

-- Devolve para 'scheduled' posts travados em 'publishing' cujo horário já passou
-- e que ainda têm targets a enviar.
UPDATE public.posts p
SET status = 'scheduled', error = NULL
WHERE p.status = 'publishing'
  AND p.scheduled_at < now() - interval '5 minutes'
  AND EXISTS (
    SELECT 1 FROM public.post_targets t
    WHERE t.post_id = p.id AND t.fb_post_id IS NULL AND t.status IN ('pending','failed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.post_targets t
    WHERE t.post_id = p.id AND t.status = 'publishing'
  );

-- Zera cooldowns futuros para os targets atrasados poderem sair agora.
UPDATE public.post_targets t
SET next_retry_at = NULL
FROM public.posts p
WHERE t.post_id = p.id
  AND t.status = 'pending'
  AND t.fb_post_id IS NULL
  AND p.scheduled_at < now()
  AND t.next_retry_at IS NOT NULL
  AND t.next_retry_at > now();
