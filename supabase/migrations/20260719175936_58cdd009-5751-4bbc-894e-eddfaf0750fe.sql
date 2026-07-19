
CREATE OR REPLACE FUNCTION public.increment_shortlink_click(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.short_links
  SET click_count = click_count + 1, last_click_at = now()
  WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.increment_shortlink_click(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_shortlink_click(uuid) TO service_role;
