import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, AlertTriangle, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/comments")({
  head: () => ({ meta: [{ title: "Comentários — PagePilot" }] }),
  component: CommentsPage,
});

function fmt(iso: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "dd/MM HH:mm:ss", { locale: ptBR });
}

function statusCls(s: string) {
  switch (s) {
    case "pending": return "bg-muted text-muted-foreground border-border";
    case "publishing": return "bg-amber-500/15 text-amber-300 border-amber-500/20";
    case "posted": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
    case "failed": return "bg-destructive/15 text-destructive border-destructive/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

type Row = {
  id: string;
  post_id: string;
  target_id: string | null;
  message: string;
  delay_seconds: number;
  status: string;
  fb_comment_id: string | null;
  error: string | null;
  run_at: string | null;
  posted_at: string | null;
  created_at: string;
  fb_post_id: string | null;
  page_name: string | null;
  fb_page_id: string | null;
  post_message: string | null;
};

function CommentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [onlyDups, setOnlyDups] = useState(false);

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["auto-comments", status],
    refetchInterval: 15_000,
    queryFn: async () => {
      const sel = `
        id, post_id, target_id, message, delay_seconds, status,
        fb_comment_id, error, run_at, posted_at, created_at,
        post_targets(fb_post_id, fb_pages(name, fb_page_id)),
        posts!inner(message)
      `;
      // Busca em duas frentes para não perder postados recentes quando há
      // milhares de pendentes futuros na fila:
      // 1) últimos postados/failed/publishing por posted_at/created_at desc
      // 2) próximos pendentes por run_at asc
      const applyStatus = (q: any) => (status !== "all" ? q.eq("status", status as any) : q);
      const [recent, upcoming] = await Promise.all([
        applyStatus(
          supabase.from("auto_comments").select(sel)
            .in("status", status !== "all" ? [status] : ["posted", "failed", "publishing", "pending"])
            .order("posted_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(1500),
        ),
        status === "all" || status === "pending"
          ? supabase.from("auto_comments").select(sel)
              .eq("status", "pending")
              .order("run_at", { ascending: true, nullsFirst: false })
              .limit(1500)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (recent.error) throw recent.error;
      if ((upcoming as any).error) throw (upcoming as any).error;
      const seen = new Set<string>();
      const data: any[] = [];
      for (const r of [...(recent.data ?? []), ...((upcoming as any).data ?? [])]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        data.push(r);
      }
      return (data ?? []).map((r: any): Row => ({
        id: r.id,
        post_id: r.post_id,
        target_id: r.target_id,
        message: r.message,
        delay_seconds: r.delay_seconds,
        status: r.status,
        fb_comment_id: r.fb_comment_id,
        error: r.error,
        run_at: r.run_at,
        posted_at: r.posted_at,
        created_at: r.created_at,
        fb_post_id: r.post_targets?.fb_post_id ?? null,
        page_name: r.post_targets?.fb_pages?.name ?? null,
        fb_page_id: r.post_targets?.fb_pages?.fb_page_id ?? null,
        post_message: r.posts?.message ?? null,
      }));
    },
  });

  // Duplicate detection: same (post_id, target_id, message) when target_id IS NOT NULL
  const dupKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.target_id) continue;
      const k = `${r.post_id}::${r.target_id}::${r.message}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyDups) {
        if (!r.target_id) return false;
        const k = `${r.post_id}::${r.target_id}::${r.message}`;
        if ((dupKeys.get(k) ?? 0) < 2) return false;
      }
      if (!s) return true;
      return (
        r.message.toLowerCase().includes(s) ||
        (r.page_name ?? "").toLowerCase().includes(s) ||
        (r.post_message ?? "").toLowerCase().includes(s) ||
        (r.error ?? "").toLowerCase().includes(s) ||
        r.post_id.includes(s) ||
        (r.target_id ?? "").includes(s)
      );
    });
  }, [rows, search, onlyDups, dupKeys]);

  const counts = useMemo(() => {
    const c = { total: rows.length, pending: 0, publishing: 0, posted: 0, failed: 0, dups: 0 };
    for (const r of rows) {
      (c as any)[r.status] = ((c as any)[r.status] ?? 0) + 1;
    }
    for (const [, v] of dupKeys) if (v > 1) c.dups += v;
    return c;
  }, [rows, dupKeys]);

  const removeOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("auto_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Comentário removido"); qc.invalidateQueries({ queryKey: ["auto-comments"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const dedupe = useMutation({
    mutationFn: async () => {
      // Group dups, keep oldest, delete others (client-side ids)
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        if (!r.target_id) continue;
        const k = `${r.post_id}::${r.target_id}::${r.message}`;
        const arr = groups.get(k) ?? [];
        arr.push(r);
        groups.set(k, arr);
      }
      const toDelete: string[] = [];
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        for (let i = 1; i < arr.length; i++) toDelete.push(arr[i].id);
      }
      if (!toDelete.length) return 0;
      const { error } = await supabase.from("auto_comments").delete().in("id", toDelete);
      if (error) throw error;
      return toDelete.length;
    },
    onSuccess: (n) => {
      if (!n) toast.info("Nenhuma duplicata encontrada");
      else toast.success(`${n} duplicata(s) removida(s)`);
      qc.invalidateQueries({ queryKey: ["auto-comments"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const retryStuck = useMutation({
    mutationFn: async (minutes: number) => {
      const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
      // failed OR publishing OR pending com run_at vencido há mais de N min
      const ids = rows
        .filter((r) =>
          r.target_id &&
          (
            r.status === "failed" ||
            r.status === "publishing" ||
            (r.status === "pending" && r.run_at && r.run_at < cutoff)
          )
        )
        .map((r) => r.id);
      if (!ids.length) return 0;
      const { error } = await supabase
        .from("auto_comments")
        .update({ status: "pending", error: null, run_at: new Date().toISOString() } as any)
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      if (!n) toast.info("Nada para reprocessar");
      else toast.success(`${n} comentário(s) reenfileirado(s)`);
      qc.invalidateQueries({ queryKey: ["auto-comments"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comentários automáticos</h1>
          <p className="text-sm text-muted-foreground">
            Auditoria por template, target, agendamento e erros. {isLoading ? "Carregando…" : `${counts.total} registro(s)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const v = prompt("Reprocessar comentários travados/falhados há mais de quantos minutos?", "10");
              if (!v) return;
              const m = parseInt(v, 10);
              if (!Number.isFinite(m) || m < 0) return toast.error("Valor inválido");
              retryStuck.mutate(m);
            }}
            disabled={retryStuck.isPending}
          >
            <RefreshCw className={`size-4 mr-1 ${retryStuck.isPending ? "animate-spin" : ""}`} />
            Reprocessar travados
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Remover duplicatas mantendo o mais antigo de cada grupo?")) dedupe.mutate();
            }}
            disabled={dedupe.isPending || counts.dups === 0}
          >
            <Trash2 className="size-4 mr-1" />
            Limpar duplicatas ({counts.dups})
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: "Pendentes", v: counts.pending, cls: "text-muted-foreground" },
          { l: "Publicando", v: counts.publishing, cls: "text-amber-300" },
          { l: "Postados", v: counts.posted, cls: "text-emerald-300" },
          { l: "Falhas", v: counts.failed, cls: "text-destructive" },
          { l: "Duplicatas", v: counts.dups, cls: "text-orange-300" },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border border-border/60 bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.l}</div>
            <div className={`text-2xl font-semibold ${s.cls}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="publishing">Publicando</SelectItem>
            <SelectItem value="posted">Postado</SelectItem>
            <SelectItem value="failed">Falhou</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Buscar por mensagem, página, post_id, target_id, erro…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Button
          variant={onlyDups ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyDups((v) => !v)}
        >
          <AlertTriangle className="size-4 mr-1" />
          Só duplicatas
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Página</TableHead>
              <TableHead className="min-w-[260px]">Mensagem</TableHead>
              <TableHead>Delay</TableHead>
              <TableHead>Agendado p/</TableHead>
              <TableHead>Postado em</TableHead>
              <TableHead>Target / Post</TableHead>
              <TableHead className="min-w-[220px]">Último erro</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                {isLoading ? "Carregando…" : "Nenhum comentário encontrado"}
              </TableCell></TableRow>
            )}
            {filtered.map((r) => {
              const dupKey = r.target_id ? `${r.post_id}::${r.target_id}::${r.message}` : null;
              const isDup = dupKey && (dupKeys.get(dupKey) ?? 0) > 1;
              return (
                <TableRow key={r.id} className={isDup ? "bg-orange-500/5" : ""}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className={statusCls(r.status)}>{r.status}</Badge>
                      {isDup && (
                        <Badge variant="outline" className="bg-orange-500/15 text-orange-300 border-orange-500/20 text-[10px]">
                          dup ×{dupKeys.get(dupKey!)}
                        </Badge>
                      )}
                      {!r.target_id && (
                        <Badge variant="outline" className="bg-blue-500/15 text-blue-300 border-blue-500/20 text-[10px]">
                          template
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.page_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="line-clamp-2 max-w-md">{r.message}</div>
                    {r.fb_comment_id && (
                      <a
                        href={`https://facebook.com/${r.fb_comment_id}`}
                        target="_blank" rel="noreferrer"
                        className="text-[10px] text-primary inline-flex items-center gap-1 mt-1"
                      >
                        <ExternalLink className="size-3" /> ver no FB
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{r.delay_seconds}s</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(r.run_at)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(r.posted_at)}</TableCell>
                  <TableCell className="text-[10px] font-mono">
                    <div>tgt: {r.target_id ? r.target_id.slice(0, 8) : "—"}</div>
                    <div>post: {r.post_id.slice(0, 8)}</div>
                    {r.fb_post_id && <div className="text-muted-foreground">fb: {r.fb_post_id.slice(0, 14)}…</div>}
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-xs">
                    <div className="line-clamp-3">{r.error ?? "—"}</div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => {
                        if (confirm("Remover este comentário?")) removeOne.mutate(r.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
