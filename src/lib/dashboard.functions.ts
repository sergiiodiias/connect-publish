import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [pages, scheduled, publishedToday, failedToday, recent] = await Promise.all([
      supabase.from("fb_pages").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "scheduled"),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "published").gte("published_at", today.toISOString()),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "failed").gte("updated_at", today.toISOString()),
      supabase.from("posts").select("id, type, message, status, scheduled_at, published_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    ]);

    return {
      pages: pages.count ?? 0,
      scheduled: scheduled.count ?? 0,
      publishedToday: publishedToday.count ?? 0,
      failedToday: failedToday.count ?? 0,
      recent: recent.data ?? [],
    };
  });
