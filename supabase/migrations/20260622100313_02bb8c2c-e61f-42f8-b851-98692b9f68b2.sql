CREATE TABLE public.post_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_target_id uuid NOT NULL REFERENCES public.post_targets(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.fb_pages(id) ON DELETE CASCADE,
  fb_post_id text NOT NULL,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('24h','manual')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  reactions integer NOT NULL DEFAULT 0,
  video_views integer,
  reach integer,
  impressions integer,
  engagement_score integer NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_insights_user ON public.post_insights(user_id, captured_at DESC);
CREATE INDEX idx_post_insights_target_type ON public.post_insights(post_target_id, snapshot_type);
CREATE INDEX idx_post_insights_post ON public.post_insights(post_id);
CREATE UNIQUE INDEX idx_post_insights_target_24h ON public.post_insights(post_target_id) WHERE snapshot_type = '24h';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_insights TO authenticated;
GRANT ALL ON public.post_insights TO service_role;

ALTER TABLE public.post_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own insights" ON public.post_insights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);