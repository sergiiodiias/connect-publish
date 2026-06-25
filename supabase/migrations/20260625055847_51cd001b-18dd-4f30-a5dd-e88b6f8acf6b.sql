CREATE TABLE public.refresh_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb
);

GRANT SELECT, INSERT, DELETE ON public.refresh_reports TO authenticated;
GRANT ALL ON public.refresh_reports TO service_role;

ALTER TABLE public.refresh_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own refresh reports"
  ON public.refresh_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own refresh reports"
  ON public.refresh_reports FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX refresh_reports_user_created_idx
  ON public.refresh_reports (user_id, created_at DESC);

-- Mantém só os últimos 30 relatórios por usuário (limpeza no momento da inserção).
CREATE OR REPLACE FUNCTION public.trim_refresh_reports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.refresh_reports
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM public.refresh_reports
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC LIMIT 30
    );
  RETURN NEW;
END;$$;

CREATE TRIGGER refresh_reports_trim
AFTER INSERT ON public.refresh_reports
FOR EACH ROW EXECUTE FUNCTION public.trim_refresh_reports();