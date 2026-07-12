
REVOKE EXECUTE ON FUNCTION public.report_fb_app_usage(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_fb_app_usage(UUID, INTEGER, INTEGER, INTEGER) TO service_role;
