import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { publishPostNow, cancelScheduled, deletePost, deleteAllPosts, getPostDetails, migrateScheduledToFacebook } from "@/lib/posts.functions";
import { verifyPostPublished } from "@/lib/verify-posts.functions";
import { importFbScheduled } from "@/lib/import-fb-scheduled.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Send, Trash2, X, AlertCircle, Info, RefreshCw, ExternalLink,
  ShieldCheck, CheckCircle2, XCircle, MoreHorizontal, ImageIcon,
  Video, Link as LinkIcon, FileText, Plus, Calendar, Download,
  ChevronLeft, ChevronRight, Clock, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({ meta: [{ title: "Agenda — PagePilot" }] }),
  component: QueuePage,
});

// ---------- helpers ----------

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isToday(d)) return `Hoje ${format(d, "HH:mm")}`;
  if (isTomorrow(d)) return `Amanhã ${format(d, "HH:mm")}`;
  return format(d, "dd MMM HH:mm", { locale: ptBR });
}

function typeMeta(t: string) {
  switch (t) {
    case "photo": return { label: "Foto", icon: ImageIcon, cls: "text-blue-400 bg-blue-500/10" };
    case "video": return { label: "Vídeo", icon: Video, cls: "text-purple-400 bg-purple-500/10" };
    case "link": return { label: "Link", icon: LinkIcon, cls: "text-emerald-400 bg-emerald-500/10" };
    default: return { label: "Texto", icon: FileText, cls: "text-slate-400 bg-slate-500/10" };
  }
}

const AVATAR_HUES = [
  "bg-blue-500/15 text-blue-300 border-blue-500/20",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  "bg-purple-500/15 text-purple-300 border-purple-500/20",
  "bg-amber-500/15 text-amber-300 border-amber-500/20",
  "bg-rose-500/15 text-rose-300 border-rose-500/20",
  "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
];
function hueFor(seed: string): string {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function statusBadge(s: string) {
  switch (s) {
    case "scheduled": return { label: "Agendado", cls: "bg-primary/15 text-primary border-primary/20" };
    case "publishing": return { label: "Publicando", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" };
    case "published": return { label: "Publicado", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" };
    case "failed": return { label: "Falhou", cls: "bg-destructive/15 text-destructive border-destructive/20" };
    case "pending": return { label: "Aguardando", cls: "bg-muted text-muted-foreground border-border" };
    case "draft": return { label: "Rascunho", cls: "bg-muted text-muted-foreground border-border" };
    default: return { label: s, cls: "bg-muted text-muted-foreground border-border" };
  }
}

// ---------- types ----------

type Row = {
  target_id: string;
  page_id: string;
  page_name: string;
  fb_page_id: string;
  target_status: string;
  target_error: string | null;
  fb_post_id: string | null;
  post_id: string;
  type: string;
  message: string | null;
  media_urls: string[];
  link_url: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
};

// ---------- page ----------

function QueuePage() {
  const qc = useQueryClient();
  const publishFn = useServerFn(publishPostNow);
  const cancelFn = useServerFn(cancelScheduled);
  const delFn = useServerFn(deletePost);
  const delAllFn = useServerFn(deleteAllPosts);
  const detailsFn = useServerFn(getPostDetails);
  const verifyFn = useServerFn(verifyPostPublished);
  const importFn = useServerFn(importFbScheduled);
  const migrateFn = useServerFn(migrateScheduledToFacebook);

  const [status, setStatus] = useState<string>("scheduled");
  const [search, setSearch] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [mediaFilter, setMediaFilter] = useState<string>("all"); // all | with | without
  const [sortOrder, setSortOrder] = useState<string>("asc"); // asc | desc
  const [currentPage, setCurrentPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, Awaited<ReturnType<typeof verifyPostPublished>> | undefined>>({});

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [status, search, pageFilter, typeFilter, mediaFilter, sortOrder]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["queue", status, search, pageFilter, sortOrder],
    queryFn: async () => {
      let q = supabase
        .from("post_targets")
        .select(`
          id, status, error, fb_post_id, page_id,
          fb_pages!inner(name, fb_page_id),
          posts!inner(id, type, message, media_urls, link_url, status, scheduled_at, published_at, created_at)
        `)
        .order("scheduled_at", { foreignTable: "posts", ascending: sortOrder === "asc" });
      if (status !== "all") q = q.eq("posts.status", status as any);
      if (pageFilter !== "all") q = q.eq("page_id", pageFilter);
      if (search) q = q.ilike("posts.message", `%${search}%`);
      const { data, error } = await q.limit(2000);
      if (error) throw error;
      return (data ?? []).map((r: any): Row => ({
        target_id: r.id,
        page_id: r.page_id,
        page_name: r.fb_pages?.name ?? "(página removida)",
        fb_page_id: r.fb_pages?.fb_page_id ?? "",
        target_status: r.status,
        target_error: r.error,
        fb_post_id: r.fb_post_id,
        post_id: r.posts.id,
        type: r.posts.type,
        message: r.posts.message,
        media_urls: r.posts.media_urls ?? [],
        link_url: r.posts.link_url,
        status: r.posts.status,
        scheduled_at: r.posts.scheduled_at,
        published_at: r.posts.published_at,
        created_at: r.posts.created_at,
      }));
    },
  });

  // List of pages for the filter
  const { data: allPages = [] } = useQuery({
    queryKey: ["queue-pages"],
    queryFn: async () => {
      const { data } = await supabase.from("fb_pages").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Apply client-side filters (type, media)
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (mediaFilter === "with" && (!r.media_urls || r.media_urls.length === 0)) return false;
      if (mediaFilter === "without" && r.media_urls && r.media_urls.length > 0) return false;
      return true;
    });
  }, [rows, typeFilter, mediaFilter]);

  const totalFiltered = filteredRows.length;

  // Per-page expansion: show 5 next per page, with "Ver mais" to expand
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const toggleExpand = (pageId: string) =>
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  // Group ALL filtered rows by page (no global pagination)
  const groups = useMemo(() => {
    const map = new Map<string, { pageId: string; pageName: string; rows: Row[] }>();
    for (const r of filteredRows) {
      const g = map.get(r.page_id) ?? { pageId: r.page_id, pageName: r.page_name, rows: [] };
      g.rows.push(r);
      map.set(r.page_id, g);
    }
    return [...map.values()].sort((a, b) => a.pageName.localeCompare(b.pageName));
  }, [filteredRows]);

  const totalPosts = totalFiltered;

  const publish = useMutation({
    mutationFn: (id: string) => publishFn({ data: { postId: id } }),
    onSuccess: () => { toast.success("Publicado"); qc.invalidateQueries({ queryKey: ["queue"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { postId: id } }),
    onSuccess: () => { toast.success("Cancelado"); qc.invalidateQueries({ queryKey: ["queue"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { postId: id } }),
    onSuccess: () => { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["queue"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const removeAll = useMutation({
    mutationFn: (s: string) => delAllFn({ data: { status: s as any } }),
    onSuccess: (r: any) => { toast.success(`${r.count} post(s) removido(s)`); qc.invalidateQueries({ queryKey: ["queue"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const verify = useMutation({
    mutationFn: (id: string) => verifyFn({ data: { postId: id } }),
    onSuccess: (r, id) => {
      setVerifyResults((prev) => ({ ...prev, [id]: r }));
      const msg = `${r.verified}/${r.total} confirmadas · ${r.missing} sumiram · ${r.errored} erro`;
      if (r.missing + r.errored === 0 && r.verified > 0) toast.success(msg);
      else if (r.verified === 0) toast.error(msg);
      else toast.warning(msg);
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["post-details", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const importScheduled = useMutation({
    mutationFn: (pid?: string) => importFn({ data: pid ? { pageId: pid } : {} }),
    onSuccess: (r: any) => {
      const errMsg = r.errors?.length ? ` · ${r.errors.length} erro(s)` : "";
      if (r.imported === 0 && r.skipped === 0) toast.info("Nenhum post agendado encontrado no Facebook");
      else toast.success(`${r.imported} importado(s) · ${r.skipped} já existiam${errMsg}`);
      if (r.errors?.length) console.warn("Import errors:", r.errors);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const details = useQuery({
    queryKey: ["post-details", detailId],
    queryFn: () => detailsFn({ data: { postId: detailId! } }),
    enabled: !!detailId,
  });

  // Stuck-post alerts: pending targets whose post was due >5min ago,
  // or any target marked failed after exhausting retries.
  const STUCK_AFTER_MIN = 5;
  const { data: stuckRows = [] } = useQuery({
    queryKey: ["queue-stuck"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MIN * 60_000).toISOString();
      const { data } = await supabase
        .from("post_targets")
        .select(`
          id, status, error, attempts, last_attempt_at, next_retry_at, page_id,
          fb_pages!inner(name),
          posts!inner(id, message, scheduled_at, status)
        `)
        .in("status", ["pending", "failed"])
        .order("last_attempt_at", { ascending: false, nullsFirst: false })
        .limit(200);
      const rows = (data ?? []) as any[];
      return rows.filter((r) => {
        const sched = r.posts?.scheduled_at;
        if (r.status === "failed") return (r.attempts ?? 0) > 0 || (sched && sched < cutoff);
        // pending: stuck if scheduled before cutoff
        return sched && sched < cutoff;
      });
    },
  });

  const stuckByPost = useMemo(() => {
    const m = new Map<string, { postId: string; message: string | null; scheduledAt: string | null; targets: any[] }>();
    for (const r of stuckRows as any[]) {
      const k = r.posts.id;
      const g = m.get(k) ?? { postId: k, message: r.posts.message, scheduledAt: r.posts.scheduled_at, targets: [] as any[] };
      g.targets.push(r);
      m.set(k, g);
    }
    return [...m.values()];
  }, [stuckRows]);

  const retryStuck = useMutation({
    mutationFn: async (postId: string) => {
      // Reset failed targets back to pending and clear retry gate so the next cron tick picks them up.
      await supabase.from("post_targets")
        .update({ status: "pending", attempts: 0, next_retry_at: null, error: null } as any)
        .eq("post_id", postId)
        .in("status", ["failed"]);
      // Also drop the retry gate on pending targets so they're tried immediately.
      await supabase.from("post_targets")
        .update({ next_retry_at: null } as any)
        .eq("post_id", postId)
        .eq("status", "pending");
      // Make sure the post is scheduled so the cron picks it up.
      await supabase.from("posts").update({ status: "scheduled", error: null }).eq("id", postId);
    },
    onSuccess: () => {
      toast.success("Reagendado — próxima execução do cron tentará novamente");
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["queue-stuck"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-8 space-y-8">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">Fila de Publicações</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Carregando…"
              : `${totalPosts} ${totalPosts === 1 ? "publicação" : "publicações"} em ${groups.length} ${groups.length === 1 ? "página" : "páginas"}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => importScheduled.mutate(pageFilter === "all" ? undefined : pageFilter)}
            disabled={importScheduled.isPending}
          >
            <Download className="size-4 mr-1" />
            {importScheduled.isPending ? "Importando…" : "Importar do Facebook"}
          </Button>
          <Button asChild>
            <Link to="/composer">
              <Plus className="size-4 mr-1" /> Criar post
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Buscar texto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="scheduled">Agendados</SelectItem>
            <SelectItem value="publishing">Publicando</SelectItem>
            <SelectItem value="published">Publicados</SelectItem>
            <SelectItem value="partial">Parciais</SelectItem>
            <SelectItem value="failed">Falhou</SelectItem>
            <SelectItem value="draft">Rascunhos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={pageFilter} onValueChange={setPageFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Todas as páginas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as páginas</SelectItem>
            {allPages.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tipos</SelectItem>
            <SelectItem value="photo">Foto</SelectItem>
            <SelectItem value="video">Vídeo</SelectItem>
            <SelectItem value="link">Link</SelectItem>
            <SelectItem value="text">Texto</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mediaFilter} onValueChange={setMediaFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Com/sem mídia</SelectItem>
            <SelectItem value="with">Com mídia</SelectItem>
            <SelectItem value="without">Sem mídia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Mais antigo primeiro</SelectItem>
            <SelectItem value="desc">Mais recente primeiro</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={removeAll.isPending || totalPosts === 0}
          onClick={() => {
            const label = status === "all" ? "TODOS os posts" : `todos os posts ${statusBadge(status).label.toLowerCase()}`;
            if (confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) removeAll.mutate(status);
          }}
        >
          <Trash2 className="size-4 mr-1" />
          Excluir {status === "all" ? "todos" : `(${new Set(filteredRows.map((r) => r.post_id)).size})`}
        </Button>
      </div>

      {/* Stuck-posts alert banner */}
      {stuckByPost.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-destructive">
                {stuckByPost.length} {stuckByPost.length === 1 ? "post travado" : "posts travados"} há mais de {STUCK_AFTER_MIN} min
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                O cron tenta automaticamente até 3 vezes (backoff de 1, 5 e 15 min). Use "Tentar agora" para forçar uma nova tentativa imediata.
              </p>
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {stuckByPost.map((g) => {
              const failedAll = g.targets.every((t) => t.status === "failed");
              const waiting = g.targets.find((t) => t.next_retry_at && t.next_retry_at > new Date().toISOString());
              const maxAttempts = Math.max(...g.targets.map((t) => t.attempts ?? 0));
              const firstError = g.targets.find((t) => t.error)?.error;
              return (
                <div key={g.postId} className="rounded-md border border-border bg-card p-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium truncate max-w-[24rem]">
                        {g.message?.trim() || <span className="italic text-muted-foreground">Sem texto</span>}
                      </span>
                      <Badge variant={failedAll ? "destructive" : "outline"} className="text-[10px]">
                        {failedAll ? "Falhou" : "Aguardando retry"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        agendado {formatWhen(g.scheduledAt)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {g.targets.length} pág · tentativa {maxAttempts}/3
                      </span>
                      {waiting && (
                        <span className="text-[10px] text-amber-400 inline-flex items-center gap-1">
                          <RefreshCw className="size-3" />
                          próximo retry {formatWhen(waiting.next_retry_at)}
                        </span>
                      )}
                    </div>
                    {firstError && (
                      <div className="text-[11px] text-destructive break-words line-clamp-2 flex items-start gap-1">
                        <AlertCircle className="size-3 mt-0.5 shrink-0" /> {firstError}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(g.postId)}>
                      <Info className="size-3.5 mr-1" /> Detalhes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryStuck.isPending}
                      onClick={() => retryStuck.mutate(g.postId)}
                    >
                      <RefreshCw className="size-3.5 mr-1" /> Tentar agora
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Empty / loading */}
      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      )}
      {!isLoading && groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-16 text-center">
          <Calendar className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Nenhuma publicação aqui</p>
          <p className="text-xs text-muted-foreground mt-1">Crie um novo post para começar a agendar.</p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/composer"><Plus className="size-4 mr-1" /> Criar post</Link>
          </Button>
        </div>
      )}

      {/* Page groups */}
      {!isLoading && groups.map((group) => {
        const initial = group.pageName.charAt(0).toUpperCase() || "?";
        const hue = hueFor(group.pageId);
        return (
          <section key={group.pageId} className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-2 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`size-10 shrink-0 rounded-full grid place-items-center font-bold border ${hue}`}>
                  {initial}
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-foreground truncate">{group.pageName}</h2>
                  <p className="text-xs text-muted-foreground">
                    {group.rows.length} {group.rows.length === 1 ? "publicação" : "publicações"}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPageFilter(group.pageId)} className="shrink-0">
                Ver só esta
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {(expandedPages.has(group.pageId) ? group.rows : group.rows.slice(0, 5)).map((r) => (
                <PostCard
                  key={r.target_id}
                  row={r}
                  onPublish={() => publish.mutate(r.post_id)}
                  onCancel={() => cancel.mutate(r.post_id)}
                  onDelete={() => { if (confirm("Excluir esta publicação (todas as páginas)?")) remove.mutate(r.post_id); }}
                  onDetails={() => setDetailId(r.post_id)}
                  onVerify={() => verify.mutate(r.post_id)}
                  verifying={verify.isPending && verify.variables === r.post_id}
                  verifyResult={verifyResults[r.post_id]}
                />
              ))}
            </div>
            {group.rows.length > 5 && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpand(group.pageId)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {expandedPages.has(group.pageId)
                    ? "Mostrar só os 5 próximos"
                    : `Ver mais ${group.rows.length - 5} publicaç${group.rows.length - 5 === 1 ? "ão" : "ões"}`}
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {/* Details dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes da publicação</DialogTitle>
          </DialogHeader>
          {details.isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
          {details.data && (
            <div className="space-y-3">
              {details.data.post.error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="font-medium mb-1">Erro do post</div>
                  <div className="text-xs break-words">{details.data.post.error}</div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">Páginas-alvo</div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={verify.isPending && verify.variables === detailId}
                  onClick={() => detailId && verify.mutate(detailId)}
                >
                  <ShieldCheck className="size-3 mr-1" />
                  {verify.isPending && verify.variables === detailId ? "Verificando…" : "Verificar no Facebook"}
                </Button>
              </div>
              {detailId && verifyResults[detailId] && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1">
                  <div className="flex flex-wrap gap-3">
                    <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> {verifyResults[detailId]!.verified} confirmadas</span>
                    {verifyResults[detailId]!.missing > 0 && <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="size-3" /> {verifyResults[detailId]!.missing} sumiram</span>}
                    {verifyResults[detailId]!.errored > 0 && <span className="inline-flex items-center gap-1 text-warning"><AlertCircle className="size-3" /> {verifyResults[detailId]!.errored} erro</span>}
                    {verifyResults[detailId]!.skipped > 0 && <span className="text-muted-foreground">{verifyResults[detailId]!.skipped} ainda pendentes</span>}
                  </div>
                </div>
              )}
              <div className="border border-border rounded-md divide-y divide-border max-h-96 overflow-y-auto">
                {details.data.targets.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">Nenhuma página-alvo encontrada.</div>
                )}
                {details.data.targets.map((t: any) => {
                  const vr = detailId ? verifyResults[detailId]?.results.find((x) => x.targetId === t.id) : undefined;
                  return (
                    <div key={t.id} className="p-3 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{t.fb_pages?.name ?? "(página removida)"}</span>
                        <Badge variant={t.status === "failed" || t.status === "missing" ? "destructive" : t.status === "published" ? "default" : "outline"} className="text-[10px]">
                          {t.status}
                        </Badge>
                        {vr && (
                          <Badge
                            variant={vr.status === "verified" ? "default" : vr.status === "missing" ? "destructive" : "outline"}
                            className="text-[10px] gap-1"
                          >
                            {vr.status === "verified" ? <CheckCircle2 className="size-3" /> : vr.status === "missing" ? <XCircle className="size-3" /> : <AlertCircle className="size-3" />}
                            {vr.status}
                          </Badge>
                        )}
                        {(vr?.permalink || t.fb_post_id) && (
                          <a
                            href={vr?.permalink ?? `https://www.facebook.com/${t.fb_post_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="size-3" /> ver no Facebook
                          </a>
                        )}
                      </div>
                      {(t.error || vr?.message) && (
                        <div className="text-xs text-destructive break-words flex items-start gap-1">
                          <AlertCircle className="size-3 mt-0.5 shrink-0" />
                          {vr?.message ?? t.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- card ----------

function PostCard({
  row, onPublish, onCancel, onDelete, onDetails, onVerify, verifying, verifyResult,
}: {
  row: Row;
  onPublish: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onDetails: () => void;
  onVerify: () => void;
  verifying: boolean;
  verifyResult?: Awaited<ReturnType<typeof verifyPostPublished>>;
}) {
  const type = typeMeta(row.type);
  const TypeIcon = type.icon;
  const badge = statusBadge(row.target_status === "failed" ? "failed" : row.status);
  const whenSrc = row.scheduled_at ?? row.published_at ?? row.created_at;
  const thumb = row.media_urls?.[0];
  const isImage = thumb && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(thumb);
  const isVideo = thumb && /\.(mp4|mov|webm)(\?|$)/i.test(thumb);

  return (
    <article className="group bg-card rounded-lg border border-border overflow-hidden shadow-sm hover:border-primary/30 hover:shadow-md transition-all flex flex-col">
      {/* Thumbnail */}
      <div className="aspect-square bg-muted relative overflow-hidden">
        {isImage ? (
          <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : isVideo ? (
          <video src={thumb} className="w-full h-full object-cover" muted playsInline />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <TypeIcon className="size-6" />
          </div>
        )}
        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-background/90 backdrop-blur rounded text-[9px] font-bold text-foreground shadow-sm uppercase tracking-wider">
          {formatWhen(whenSrc)}
        </span>
        <span className={`absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${type.cls}`}>
          <TypeIcon className="size-2.5" /> {type.label}
        </span>
      </div>

      {/* Body */}
      <div className="p-2.5 flex flex-col gap-2 flex-1">
        <p className="text-xs text-foreground/80 line-clamp-2 min-h-[2rem]">
          {row.message?.trim() || <span className="italic text-muted-foreground">Sem texto</span>}
        </p>

        <div className="flex items-center justify-between gap-2 mt-auto">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${badge.cls}`}>
            {badge.label}
          </span>

          <div className="flex items-center gap-1">
            {verifyResult && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <ShieldCheck className="size-3" />
                {verifyResult.verified}/{verifyResult.total}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Ações"
                  className="size-7 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {(row.status === "draft" || row.status === "scheduled") && (
                  <DropdownMenuItem onClick={onPublish}>
                    <Send className="size-3.5 mr-2" /> Publicar agora
                  </DropdownMenuItem>
                )}
                {(row.status === "failed" || row.status === "partial") && (
                  <DropdownMenuItem onClick={onPublish}>
                    <RefreshCw className="size-3.5 mr-2" /> Tentar novamente
                  </DropdownMenuItem>
                )}
                {(row.status === "published" || row.status === "partial" || row.status === "failed") && (
                  <DropdownMenuItem onClick={onVerify} disabled={verifying}>
                    <ShieldCheck className="size-3.5 mr-2" />
                    {verifying ? "Verificando…" : "Verificar no FB"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onDetails}>
                  <Info className="size-3.5 mr-2" /> Detalhes
                </DropdownMenuItem>
                {row.fb_post_id && (
                  <DropdownMenuItem asChild>
                    <a href={`https://www.facebook.com/${row.fb_post_id}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5 mr-2" /> Ver no Facebook
                    </a>
                  </DropdownMenuItem>
                )}
                {row.status === "scheduled" && (
                  <DropdownMenuItem onClick={onCancel}>
                    <X className="size-3.5 mr-2" /> Cancelar agendamento
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  <Trash2 className="size-3.5 mr-2" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {(row.target_error || (row.status === "failed" && row.media_urls.length === 0)) && (
          <div className="text-[11px] text-destructive flex items-start gap-1 leading-relaxed">
            <AlertCircle className="size-3 mt-0.5 shrink-0" />
            <span className="break-words line-clamp-2">{row.target_error ?? "Falhou — abra os detalhes"}</span>
          </div>
        )}
      </div>
    </article>
  );
}
