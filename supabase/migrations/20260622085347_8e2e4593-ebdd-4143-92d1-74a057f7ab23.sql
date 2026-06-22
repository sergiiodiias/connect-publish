
ALTER TABLE public.fb_pages
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_data_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_scopes text[],
  ADD COLUMN IF NOT EXISTS token_last_debugged_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_debug_error text;
