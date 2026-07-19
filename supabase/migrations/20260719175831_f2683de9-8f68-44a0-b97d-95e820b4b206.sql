
CREATE TABLE public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  target_url text NOT NULL,
  group_id uuid NULL,
  page_id uuid NULL,
  click_count integer NOT NULL DEFAULT 0,
  last_click_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX short_links_user_idx ON public.short_links(user_id);
CREATE INDEX short_links_group_target_idx ON public.short_links(user_id, group_id, target_url);

GRANT SELECT ON public.short_links TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.short_links TO authenticated;
GRANT ALL ON public.short_links TO service_role;

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read short links for redirect"
  ON public.short_links FOR SELECT TO anon USING (true);

CREATE POLICY "Users manage their short links"
  ON public.short_links FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
