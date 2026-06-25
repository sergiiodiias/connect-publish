ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fb_app_id_2 text,
  ADD COLUMN IF NOT EXISTS fb_app_secret_2 text,
  ADD COLUMN IF NOT EXISTS fb_app_usage jsonb NOT NULL DEFAULT '{}'::jsonb;