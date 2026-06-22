import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { CalendarClock, CheckCircle2, Layers, XCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PagePilot" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const fetchStats = useServerFn(getDashboardStats);
  const opts = queryOptions({ queryKey: ["dashboard"], queryFn: () => fetchStats(), refetchInterval: 15000 });
  const { data: s } = useSuspenseQuery(opts);

  const cards = [
    { label: "Páginas conectadas", value: s.pages, icon: Layers, color: "text-primary" },
    { label: "Agendadas", value: s.scheduled, icon: CalendarClock, color: "text-warning" },
    { label: "Publicadas hoje", value: s.publishedToday, icon: CheckCircle2, color: "text-success" },
    { label: "Falhas hoje", value: s.failedToday, icon: XCircle, color: "text-destructive" },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da sua operação no Facebook.</p>
        </div>
        <Link to="/composer"><Button><Plus className="size-4 mr-2" />Nova publicação</Button></Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.icon className={`size-5 ${c.color}`} />
            </div>
            <div className="mt-3 text-3xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Últimas publicações</h2>
          <Link to="/queue" className="text-xs text-muted-foreground hover:text-foreground">ver tudo →</Link>
        </div>
        <div className="divide-y divide-border">
          {s.recent.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma publicação ainda.</div>
          )}
          {s.recent.map(p => (
            <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm truncate">{p.message || <span className="text-muted-foreground italic">Sem texto</span>}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.type} · {p.scheduled_at ? `agendado ${format(new Date(p.scheduled_at), "dd/MM HH:mm")}` : p.published_at ? `publicado ${format(new Date(p.published_at), "dd/MM HH:mm")}` : format(new Date(p.created_at), "dd/MM HH:mm")}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { v: any; l: string }> = {
    draft: { v: "secondary", l: "Rascunho" },
    scheduled: { v: "outline", l: "Agendado" },
    publishing: { v: "default", l: "Publicando" },
    published: { v: "default", l: "Publicado" },
    failed: { v: "destructive", l: "Falhou" },
  };
  const x = map[status] ?? { v: "secondary", l: status };
  return <Badge variant={x.v}>{x.l}</Badge>;
}
