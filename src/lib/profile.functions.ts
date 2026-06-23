import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyFbApp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("fb_app_id, fb_app_secret")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    return {
      fb_app_id: data?.fb_app_id ?? "",
      // Return only a masked indicator — never expose the real secret to the UI
      has_secret: !!data?.fb_app_secret,
    };
  });

export const updateMyFbApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      fb_app_id: z.string().trim().max(64).optional(),
      fb_app_secret: z.string().trim().max(256).optional(),
      clear: z.boolean().optional(),
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
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
