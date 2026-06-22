import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { captureInsights } from "@/lib/insights.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, Heart, MessageCircle, Share2, Eye, Repeat2, Trophy,
  ExternalLink, ChevronLeft, ChevronRight, ImageIcon, Video, Link as LinkIcon, FileText,
  TrendingUp, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/engagement")({
  head: () => ({ meta: [{ title: "Engajamento — PagePilot" }] }),
  component: EngagementPage,
});

const PAGE_SIZE = 24;

type Row = {
  target_id: string;
  post_id: string;
  page_id: string;
  page_name: string;
  fb_post_id: string;
  type: string;
  message: string | null;
  media_urls: string[];
  link_url: string | null;
  published_at: string | null;
  // metrics (latest snapshot)
  likes: number;
  comments: number;
  shares: number;
  reactions: number;
  video_views: number | null;
  reach: number | null;
  impressions: number | null;
  score: number;
  captured_at: string | null;
  snapshot_type: string | null;
};

function typeMeta(t: string) {
  switch (t) {
    case "photo": return { label: "Foto", Icon: ImageIcon };
    case "video": return { label: "Vídeo", Icon: Video };
    case "link": return { label: "Link", Icon: LinkIcon };
    default: return { label: "Texto", Icon: FileText };
  }
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function EngagementPage() {
  const qc = useQueryClient();
  const captureFn = useServerFn(captureInsights);

  const [pageFilter, setPageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("score"); // score | likes | comments | shares | views
  const [period, setPeriod] = useState<string>("30"); // days
  const [minMetric, setMinMetric] = useState<string>("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => { setCurrentPage(1); }, [pageFilter, typeFilter, sortBy, period, minMetric, search]);

  // Pages list for filter
  const { data: allPages = [] } = useQuery({
    queryKey: ["engagement-pages"],
    queryFn: async () => {
      const { data } = await supabase.from("fb_pages").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Query published targets joined with latest insights snapshot
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["engagement", period, pageFilter],
    queryFn: async (): Promise<Row[]> => {
      const sinceIso = period === "all"
        ? null
        : new Date(Date.now() - parseInt(period) * 86400_000).toISOString();

      let q = supabase
        .from("post_targets")
        .select(`
          id, page_id, fb_post_id, published_at,
          fb_pages!inner(name),
          posts!inner(id, type, message, media_urls, link_url, published_at),
          post_insights(snapshot_type, captured_at, likes, comments, shares, reactions, video_views, reach, impressions, engagement_score)
        `)
        .eq("status", "published")
        .not("fb_post_id", "is", null)
        .order("published_at", { ascending: false })
        .limit(500);

      if (sinceIso) q = q.gte("published_at", sinceIso);
      if (pageFilter !== "all") q = q.eq("page_id", pageFilter);

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((r: any) => {
        // pick newest insight snapshot
        const snaps = (r.post_insights ?? []).slice().sort(
          (a: any, b: any) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
        );
        const s = snaps[0];
        return {
          target_id: r.id,
          post_id: r.posts.id,
          page_id: r.page_id,
          page_name: r.fb_pages?.name ?? "(página)",
          fb_post_id: r.fb_post_id,
          type: r.posts.type,
          message: r.posts.message,
          media_urls: r.posts.media_urls ?? [],
          link_url: r.posts.link_url,
          published_at: r.published_at ?? r.posts.published_at,
          likes: s?.likes ?? 0,
          comments: s?.comments ?? 0,
          shares: s?.shares ?? 0,
          reactions: s?.reactions ?? 0,
          video_views: s?.video_views ?? null,
          reach: s?.reach ?? null,
          impressions: s?.impressions ?? null,
          score: s?.engagement_score ?? 0,
          captured_at: s?.captured_at ?? null,
          snapshot_type: s?.snapshot_type ?? null,
        };
      });
    },
  });

  // Filter / sort
  const filtered = useMemo(() => {
    const min = parseInt(minMetric) || 0;
    const out = rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (search && !(r.message ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (min > 0) {
        const v = sortBy === "likes" ? r.likes
                : sortBy === "comments" ? r.comments
                : sortBy === "shares" ? r.shares
                : sortBy === "views" ? (r.video_views ?? 0)
                : r.score;
        if (v < min) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const va = sortBy === "likes" ? a.likes
              : sortBy === "comments" ? a.comments
              : sortBy === "shares" ? a.shares
              : sortBy === "views" ? (a.video_views ?? 0)
              : a.score;
      const vb = sortBy === "likes" ? b.likes
              : sortBy === "comments" ? b.comments
              : sortBy === "shares" ? b.shares
              : sortBy === "views" ? (b.video_views ?? 0)
              : b.score;
      return vb - va;
    });
    return out;
  }, [rows, typeFilter, search, sortBy, minMetric]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const top3 = useMemo(() => filtered.slice(0, 3), [filtered]);

  // Totals
  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        likes: acc.likes + r.likes,
        comments: acc.comments + r.comments,
        shares: acc.shares + r.shares,
        views: acc.views + (r.video_views ?? 0),
      }),
      { likes: 0, comments: 0, shares: 0, views: 0 },
    );
  }, [filtered]);

  const refresh = useMutation({
    mutationFn: async (postId?: string) => captureFn({ data: postId ? { postId, snapshotType: "manual" } : { snapshotType: "manual" } }),
    onSuccess: (r: any) => {
      toast.success(`${r.ok}/${r.total} métricas atualizadas`);
      qc.invalidateQueries({ queryKey: ["engagement"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const refreshAll = useMutation({
    mutationFn: async () => {
      const targetIds = filtered.map((r) => r.target_id);
      // Bootstrap: if no rows yet, ask server to capture for ALL of user's published targets
      if (targetIds.length === 0) {
        const r: any = await captureFn({ data: { snapshotType: "manual" } });
        return { ok: r.ok, total: r.total };
      }
      // chunk to keep request size reasonable
      const chunks: string[][] = [];
      for (let i = 0; i < targetIds.length; i += 50) chunks.push(targetIds.slice(i, i + 50));
      let ok = 0, total = 0;
      for (const c of chunks) {
        const r: any = await captureFn({ data: { targetIds: c, snapshotType: "manual" } });
        ok += r.ok; total += r.total;
      }
      return { ok, total };
    },
    onSuccess: (r) => {
      if (r.total === 0) toast.info("Nenhum post publicado encontrado para capturar métricas");
      else toast.success(`${r.ok}/${r.total} métricas atualizadas`);
      qc.invalidateQueries({ queryKey: ["engagement"] });
    },
    onError: (e: any) => toast.error(e.message),
  });


  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="size-6 text-primary" /> Engajamento
          </h1>
          <p className="text-sm text-muted-foreground">
            Análise de curtidas, comentários, compartilhamentos e visualizações das publicações
          </p>
        </div>
        <Button onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending || filtered.length === 0}>
          <RefreshCw className={`size-4 mr-1 ${refreshAll.isPending ? "animate-spin" : ""}`} />
          {refreshAll.isPending ? "Atualizando…" : "Atualizar métricas"}
        </Button>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Heart} label="Curtidas" value={totals.likes} color="text-rose-400" />
        <StatCard icon={MessageCircle} label="Comentários" value={totals.comments} color="text-blue-400" />
        <StatCard icon={Share2} label="Compartilhamentos" value={totals.shares} color="text-emerald-400" />
        <StatCard icon={Eye} label="Visualizações (vídeo)" value={totals.views} color="text-purple-400" />
      </div>

      {/* Top 3 */}
      {top3.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Trophy className="size-4 text-amber-400" /> Mais engajados
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {top3.map((r, idx) => (
              <TopCard key={r.target_id} row={r} rank={idx + 1} sortBy={sortBy} />
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center sticky top-0 z-10 bg-background/80 backdrop-blur py-2 -mx-2 px-2 rounded-lg">
        <Input
          placeholder="Buscar texto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Engajamento total (score)</SelectItem>
            <SelectItem value="likes">Mais curtidas</SelectItem>
            <SelectItem value="comments">Mais comentários</SelectItem>
            <SelectItem value="shares">Mais compartilhamentos</SelectItem>
            <SelectItem value="views">Mais visualizações</SelectItem>
          </SelectContent>
        </Select>
        <Select value={pageFilter} onValueChange={setPageFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Todas as páginas" /></SelectTrigger>
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
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="all">Todo período</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          placeholder="Mínimo"
          value={minMetric}
          onChange={(e) => setMinMetric(e.target.value)}
          className="w-28"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "post" : "posts"} · página {safePage}/{totalPages}
        </span>
      </div>

      {/* Grid */}
      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-16 text-center">
          <TrendingUp className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Sem publicações com métricas</p>
          <p className="text-xs text-muted-foreground mt-1">
            Publique posts e clique em "Atualizar métricas" para puxar curtidas, comentários e views do Facebook.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {paged.map((r) => (
          <PostCard
            key={r.target_id}
            row={r}
            onRefresh={() => refresh.mutate(r.post_id)}
            refreshing={refresh.isPending && refresh.variables === r.post_id}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <span className="text-sm text-muted-foreground px-2">Página {safePage} de {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// -------- Components --------

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className={`size-10 rounded-lg bg-muted grid place-items-center ${color}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tracking-tight">{fmtNum(value)}</div>
      </div>
    </div>
  );
}

function TopCard({ row, rank, sortBy }: { row: Row; rank: number; sortBy: string }) {
  const { Icon } = typeMeta(row.type);
  const thumb = row.media_urls?.[0];
  const isImage = thumb && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(thumb);
  const isVideo = thumb && /\.(mp4|mov|webm)(\?|$)/i.test(thumb);
  const highlight =
    sortBy === "likes" ? row.likes
    : sortBy === "comments" ? row.comments
    : sortBy === "shares" ? row.shares
    : sortBy === "views" ? row.video_views
    : row.score;

  return (
    <article className="rounded-xl border border-border bg-gradient-to-br from-card to-card/50 p-3 flex gap-3 hover:border-primary/40 transition-colors">
      <div className="relative size-20 rounded-lg overflow-hidden bg-muted shrink-0">
        {isImage ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
        : isVideo ? <video src={thumb} className="w-full h-full object-cover" muted playsInline />
        : <div className="grid place-items-center h-full text-muted-foreground"><Icon className="size-6" /></div>}
        <div className={`absolute -top-1 -left-1 size-6 rounded-full grid place-items-center text-[11px] font-bold shadow ${
          rank === 1 ? "bg-amber-400 text-amber-950"
          : rank === 2 ? "bg-slate-300 text-slate-900"
          : "bg-orange-400 text-orange-950"
        }`}>{rank}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground truncate">{row.page_name}</div>
        <p className="text-xs text-foreground/80 line-clamp-2 mb-1">
          {row.message?.trim() || <span className="italic text-muted-foreground">Sem texto</span>}
        </p>
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          <Metric icon={Heart} value={row.likes} color="text-rose-400" />
          <Metric icon={MessageCircle} value={row.comments} color="text-blue-400" />
          <Metric icon={Share2} value={row.shares} color="text-emerald-400" />
          {row.video_views != null && <Metric icon={Eye} value={row.video_views} color="text-purple-400" />}
        </div>
        <div className="text-[10px] text-amber-300 mt-1 flex items-center gap-1">
          <Sparkles className="size-3" /> {fmtNum(highlight as number)} {sortBy === "score" ? "pts" : ""}
        </div>
      </div>
    </article>
  );
}

function Metric({ icon: Icon, value, color }: { icon: any; value: number | null; color: string }) {
  if (value == null) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`}>
      <Icon className="size-3" /> {fmtNum(value)}
    </span>
  );
}

function PostCard({ row, onRefresh, refreshing }: { row: Row; onRefresh: () => void; refreshing: boolean }) {
  const { Icon, label } = typeMeta(row.type);
  const thumb = row.media_urls?.[0];
  const isImage = thumb && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(thumb);
  const isVideo = thumb && /\.(mp4|mov|webm)(\?|$)/i.test(thumb);

  return (
    <article className="group bg-card rounded-lg border border-border overflow-hidden shadow-sm hover:border-primary/30 hover:shadow-md transition-all flex flex-col">
      <div className="aspect-square bg-muted relative overflow-hidden">
        {isImage ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
        : isVideo ? <video src={thumb} className="w-full h-full object-cover" muted playsInline />
        : <div className="absolute inset-0 grid place-items-center text-muted-foreground"><Icon className="size-6" /></div>}
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-background/90 backdrop-blur">
          <Icon className="size-2.5" /> {label}
        </span>
        {row.snapshot_type === "24h" && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/90 text-emerald-50 backdrop-blur">
            24h
          </span>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-2 flex-1">
        <div className="text-[10px] text-muted-foreground truncate">{row.page_name}</div>
        <p className="text-xs text-foreground/80 line-clamp-2 min-h-[2rem]">
          {row.message?.trim() || <span className="italic text-muted-foreground">Sem texto</span>}
        </p>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          <Metric icon={Heart} value={row.likes} color="text-rose-400" />
          <Metric icon={MessageCircle} value={row.comments} color="text-blue-400" />
          <Metric icon={Share2} value={row.shares} color="text-emerald-400" />
          {row.video_views != null ? (
            <Metric icon={Eye} value={row.video_views} color="text-purple-400" />
          ) : row.reach != null ? (
            <Metric icon={Eye} value={row.reach} color="text-purple-400" />
          ) : null}
        </div>
        {row.captured_at && (
          <div className="text-[9px] text-muted-foreground">
            Atualizado {formatDistanceToNow(new Date(row.captured_at), { locale: ptBR, addSuffix: true })}
          </div>
        )}
        {row.published_at && (
          <div className="text-[9px] text-muted-foreground">
            Publicado {format(new Date(row.published_at), "dd MMM HH:mm", { locale: ptBR })}
          </div>
        )}
        <div className="flex items-center gap-1 mt-auto pt-1 border-t border-border/40">
          <Button asChild size="sm" variant="ghost" className="flex-1 h-7 text-[11px]">
            <Link to="/composer" search={{ reusePostId: row.post_id } as any}>
              <Repeat2 className="size-3 mr-1" /> Reutilizar
            </Link>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onRefresh} disabled={refreshing} aria-label="Atualizar">
            <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          {row.fb_post_id && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2" aria-label="Abrir no Facebook">
              <a href={`https://www.facebook.com/${row.fb_post_id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
