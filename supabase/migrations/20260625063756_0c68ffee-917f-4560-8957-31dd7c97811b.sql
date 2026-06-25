CREATE TABLE public.fb_api_calls (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, endpoint)
);

GRANT SELECT ON public.fb_api_calls TO authenticated;
GRANT ALL ON public.fb_api_calls TO service_role;

ALTER TABLE public.fb_api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own api call stats"
ON public.fb_api_calls FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX fb_api_calls_user_day_idx ON public.fb_api_calls (user_id, day DESC);

CREATE OR REPLACE FUNCTION public.bump_fb_api_call(p_user_id UUID, p_endpoint TEXT, p_inc INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_inc IS NULL OR p_inc <= 0 THEN RETURN; END IF;
  INSERT INTO public.fb_api_calls (user_id, day, endpoint, count, last_at)
  VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, p_endpoint, p_inc, now())
  ON CONFLICT (user_id, day, endpoint)
  DO UPDATE SET count = public.fb_api_calls.count + EXCLUDED.count, last_at = now();
END;$$;

GRANT EXECUTE ON FUNCTION public.bump_fb_api_call(UUID, TEXT, INTEGER) TO service_role;