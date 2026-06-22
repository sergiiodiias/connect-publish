
CREATE TABLE public.upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  total_count int NOT NULL DEFAULT 0,
  processed_count int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  payload jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.upload_jobs TO authenticated;
GRANT ALL ON public.upload_jobs TO service_role;
ALTER TABLE public.upload_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own upload jobs"
ON public.upload_jobs FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.upload_jobs;
ALTER TABLE public.upload_jobs REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.increment_job_counts(
  p_job_id uuid,
  p_success_inc int,
  p_error_inc int,
  p_processed int,
  p_should_complete boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.upload_jobs
  SET success_count = success_count + COALESCE(p_success_inc, 0),
      error_count = error_count + COALESCE(p_error_inc, 0),
      processed_count = processed_count + COALESCE(p_processed, 0),
      status = CASE WHEN p_should_complete THEN 'completed' ELSE status END,
      completed_at = CASE WHEN p_should_complete THEN now() ELSE completed_at END
  WHERE id = p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_job_counts(uuid,int,int,int,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_job_counts(uuid,int,int,int,boolean) TO service_role;
