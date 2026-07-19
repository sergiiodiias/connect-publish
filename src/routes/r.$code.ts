import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Redirecionador público: /r/<code> → target_url original.
// Cada grupo de envio recebe um code diferente apontando para o mesmo destino final,
// permitindo variar o link visível nos comentários sem duplicar destinos.
export const Route = createFileRoute("/r/$code")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const code = params.code;
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
              h.set("apikey", key);
              return fetch(input, { ...init, headers: h });
            },
          },
        });
        const { data } = await supabase
          .from("short_links")
          .select("id, target_url")
          .eq("code", code)
          .maybeSingle();
        if (!data) return new Response("Link não encontrado", { status: 404 });
        // Contabiliza clique best-effort — não bloqueia o redirect.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          void supabaseAdmin.rpc("increment_shortlink_click" as any, { p_id: data.id } as any).then(() => {}, () => {});
        } catch {}
        return new Response(null, {
          status: 302,
          headers: { Location: data.target_url, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
