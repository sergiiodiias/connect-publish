import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getApiCallStats, labelForEndpoint } from "@/lib/api-usage.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useState } from "react";

function fmtTime(ms?: number) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  return `${Math.round(h / 24)} d atrás`;
}

function UsageBar({ pct, threshold }: { pct: number; threshold: number }) {
  const tone = pct >= 95 ? "bg-destructive" : pct >= threshold ? "bg-warning" : "bg-success";
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${tone} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function ApiUsagePanel() {
  const fn = useServerFn(getApiCallStats);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["api-usage-stats"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Carregando estatísticas de uso…
      </div>
    );
  }
  if (!data) return null;

  const showAlert = data.economyMode || data.apps.app1.pct >= data.threshold || data.apps.app2.pct >= data.threshold;
  const visibleEndpoints = expanded ? data.last7d : data.last7d.slice(0, 6);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`size-9 rounded-lg grid place-items-center ${showAlert ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>
            <Activity className="size-5" />
          </div>
          <div>
            <div className="font-medium">Uso da Graph API</div>
            <div className="text-xs text-muted-foreground">
              {data.totals.today} chamada(s) hoje · {data.totals.last7d} nos últimos 7 dias
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} title="Atualizar">
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {showAlert && (
        <div className="mx-4 mb-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
          <div>
            {data.economyMode ? (
              <>
                <strong>Modo econômico ativado.</strong> Todos os Apps configurados estão ≥ {data.threshold}% da quota.
                O sistema só vai renovar tokens que expiram em menos de 7 dias até a quota cair.
              </>
            ) : (
              <>
                <strong>Quota alta.</strong> Um dos Apps está próximo do limite ({data.threshold}%). O sistema vai
                preferir o outro App nas próximas chamadas.
              </>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(["app1", "app2"] as const).map((key) => {
          const a = data.apps[key];
          if (!a.configured) {
            return (
              <div key={key} className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                App #{key === "app1" ? 1 : 2}: não configurado
              </div>
            );
          }
          const tone = a.pct >= 95 ? "destructive" : a.pct >= data.threshold ? "warning" : "success";
          return (
            <div key={key} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">App #{key === "app1" ? 1 : 2}</span>
                <Badge variant="outline" className={
                  tone === "destructive" ? "border-destructive/40 text-destructive" :
                  tone === "warning" ? "border-warning/40 text-warning" : "border-success/40 text-success"
                }>{a.pct}%</Badge>
              </div>
              <UsageBar pct={a.pct} threshold={data.threshold} />
              <div className="text-xs text-muted-foreground flex justify-between">
                <span>calls: {a.call_count ?? 0} · time: {a.total_time ?? 0}% · cpu: {a.total_cputime ?? 0}%</span>
                <span>{fmtTime(a.ts)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border">
        <div className="px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>Chamadas por endpoint (últimos 7 dias)</span>
          {data.last7d.length > 6 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setExpanded(v => !v)}>
              {expanded ? <>menos <ChevronUp className="size-3 ml-1" /></> : <>ver tudo ({data.last7d.length}) <ChevronDown className="size-3 ml-1" /></>}
            </Button>
          )}
        </div>
        {data.last7d.length === 0 ? (
          <div className="px-4 pb-4 text-sm text-muted-foreground">Nenhuma chamada registrada ainda.</div>
        ) : (
          <div className="divide-y divide-border">
            {visibleEndpoints.map((ep) => {
              const todayCount = data.today.find((x) => x.endpoint === ep.endpoint)?.count ?? 0;
              const max = data.last7d[0]?.count ?? 1;
              return (
                <div key={ep.endpoint} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{labelForEndpoint(ep.endpoint)}</div>
                    <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary/60" style={{ width: `${(ep.count / max) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-sm">{ep.count}</div>
                    <div className="text-[10px] text-muted-foreground">hoje: {todayCount}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
