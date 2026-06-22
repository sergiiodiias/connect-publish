import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Histórico — PagePilot" }] }),
  component: LogsPage,
});

function LogsPage() {
  const [search, setSearch] = useState("");
  const { data: logs = [] } = useQuery({
    queryKey: ["logs", search],
    queryFn: async () => {
      let q = supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (search) q = q.ilike("action", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
        <p className="text-sm text-muted-foreground">Tudo o que aconteceu na sua conta.</p>
      </div>
      <Input placeholder="Buscar ação…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {logs.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Sem atividade ainda.</div>}
        {logs.map(l => (
          <div key={l.id} className="p-4 flex items-center gap-4">
            <Badge variant={l.status === "ok" ? "default" : l.status === "partial" ? "outline" : "destructive"}>{l.status ?? "-"}</Badge>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono">{l.action}</div>
              <div className="text-xs text-muted-foreground">{l.entity ?? ""} {l.entity_id ?? ""}</div>
            </div>
            <span className="text-xs text-muted-foreground">{format(new Date(l.created_at), "dd/MM HH:mm:ss")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
