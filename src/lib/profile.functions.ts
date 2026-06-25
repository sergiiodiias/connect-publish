import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyFbApp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("fb_app_id, fb_app_secret, fb_app_id_2, fb_app_secret_2, fb_app_usage")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    const usage = (data?.fb_app_usage ?? {}) as Record<string, { pct: number; ts: number }>;
    return {
      fb_app_id: data?.fb_app_id ?? "",
      has_secret: !!data?.fb_app_secret,
      fb_app_id_2: data?.fb_app_id_2 ?? "",
      has_secret_2: !!data?.fb_app_secret_2,
      usage: {
        app1: usage.app1 ?? null,
        app2: usage.app2 ?? null,
      },
    };
  });

export const updateMyFbApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      fb_app_id: z.string().trim().max(64).optional(),
      fb_app_secret: z.string().trim().max(256).optional(),
      fb_app_id_2: z.string().trim().max(64).optional(),
      fb_app_secret_2: z.string().trim().max(256).optional(),
      clear: z.boolean().optional(),
      clear_2: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, string | null> = {};
    if (data.clear) {
      patch.fb_app_id = null;
      patch.fb_app_secret = null;
    } else {
      if (data.fb_app_id !== undefined) patch.fb_app_id = data.fb_app_id || null;
      if (data.fb_app_secret !== undefined && data.fb_app_secret !== "") {
        patch.fb_app_secret = data.fb_app_secret;
      }
    }
    if (data.clear_2) {
      patch.fb_app_id_2 = null;
      patch.fb_app_secret_2 = null;
    } else {
      if (data.fb_app_id_2 !== undefined) patch.fb_app_id_2 = data.fb_app_id_2 || null;
      if (data.fb_app_secret_2 !== undefined && data.fb_app_secret_2 !== "") {
        patch.fb_app_secret_2 = data.fb_app_secret_2;
      }
    }
    if (Object.keys(patch).length === 0) return { ok: true as const };
    const { error } = await supabase.from("profiles").update(patch as any).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
