
CREATE TABLE IF NOT EXISTS public.fb_app_usage (
  user_id UUID NOT NULL PRIMARY KEY,
  call_count INTEGER NOT NULL DEFAULT 0,
  total_time INTEGER NOT NULL DEFAULT 0,
  total_cputime INTEGER NOT NULL DEFAULT 0,
  max_pct INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fb_app_usage TO authenticated;
GRANT ALL ON public.fb_app_usage TO service_role;
ALTER TABLE public.fb_app_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own app usage" ON public.fb_app_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Upsert que mantém o valor mais alto observado nos últimos 10 minutos
-- (após 10 min sem update, considera stale e substitui pelo novo valor).
CREATE OR REPLACE FUNCTION public.report_fb_app_usage(
  p_user_id UUID,
  p_call_count INTEGER,
  p_total_time INTEGER,
  p_total_cputime INTEGER
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max INTEGER := GREATEST(COALESCE(p_call_count,0), COALESCE(p_total_time,0), COALESCE(p_total_cputime,0));
BEGIN
  INSERT INTO public.fb_app_usage (user_id, call_count, total_time, total_cputime, max_pct, updated_at)
  VALUES (p_user_id, p_call_count, p_total_time, p_total_cputime, v_max, now())
  ON CONFLICT (user_id) DO UPDATE
  SET call_count = CASE
        WHEN public.fb_app_usage.updated_at < now() - INTERVAL '10 minutes' THEN EXCLUDED.call_count
        ELSE GREATEST(public.fb_app_usage.call_count, EXCLUDED.call_count) END,
      total_time = CASE
        WHEN public.fb_app_usage.updated_at < now() - INTERVAL '10 minutes' THEN EXCLUDED.total_time
        ELSE GREATEST(public.fb_app_usage.total_time, EXCLUDED.total_time) END,
      total_cputime = CASE
        WHEN public.fb_app_usage.updated_at < now() - INTERVAL '10 minutes' THEN EXCLUDED.total_cputime
        ELSE GREATEST(public.fb_app_usage.total_cputime, EXCLUDED.total_cputime) END,
      max_pct = CASE
        WHEN public.fb_app_usage.updated_at < now() - INTERVAL '10 minutes' THEN EXCLUDED.max_pct
        ELSE GREATEST(public.fb_app_usage.max_pct, EXCLUDED.max_pct) END,
      updated_at = now();
END;
$$;
