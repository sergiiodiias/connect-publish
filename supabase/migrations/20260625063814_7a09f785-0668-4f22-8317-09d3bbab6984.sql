REVOKE ALL ON FUNCTION public.bump_fb_api_call(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_fb_api_call(UUID, TEXT, INTEGER) TO service_role;