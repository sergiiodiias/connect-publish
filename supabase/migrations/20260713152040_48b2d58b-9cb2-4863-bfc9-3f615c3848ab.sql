
-- Destrava targets em "publishing" (voltam para pending para reprocessar)
UPDATE public.post_targets
SET status = 'pending', error = NULL
WHERE status = 'publishing';

-- Reagenda comentários marcados como failed por falso-positivo de verificação
UPDATE public.auto_comments
SET status = 'pending',
    error = NULL,
    run_at = NOW() + (INTERVAL '1 minute' * (2 + floor(random()*8)::int))
WHERE status = 'failed'
  AND (error ILIKE '%nonexisting field%' OR error ILIKE '%post não encontrado%' OR error ILIKE '%post não publicado%');
