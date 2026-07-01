
ALTER TABLE public.fb_pages
  ADD COLUMN IF NOT EXISTS followers_count bigint,
  ADD COLUMN IF NOT EXISTS fan_count bigint,
  ADD COLUMN IF NOT EXISTS engaged_users_28d bigint,
  ADD COLUMN IF NOT EXISTS impressions_28d bigint,
  ADD COLUMN IF NOT EXISTS reach_28d bigint,
  ADD COLUMN IF NOT EXISTS post_engagements_28d bigint,
  ADD COLUMN IF NOT EXISTS stats_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stats_error text;

CREATE INDEX IF NOT EXISTS idx_fb_pages_followers ON public.fb_pages (user_id, followers_count DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_fb_pages_engaged ON public.fb_pages (user_id, engaged_users_28d DESC NULLS LAST);
