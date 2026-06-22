import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { publishPostNow, cancelScheduled, deletePost, deleteAllPosts, getPostDetails } from "@/lib/posts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { Send, Trash2, X, AlertCircle, Info, RefreshCw, ExternalLink, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

function explainStatus(p: { status: string; scheduled_at: string | null; published_at: string | null; error: string | null }): string {
  switch (p.status) {
    case "draft":
      return "Rascunho: ainda não foi agendado nem enviado ao Facebook. Clique em Publicar para enviar agora ou defina um horário.";
    case "scheduled":
      return p.scheduled_at
        ? `Agendado para ${format(new Date(p.scheduled_at), "dd/MM/yyyy HH:mm")}. O cron interno vai chamar a Graph API (/{page-id}/feed, /photos ou /videos) no horário marcado.`
        : "Agendado, mas sem horário definido — será publicado na próxima execução do cron.";
    case "publishing":
      return "Em publicação: a Graph API foi chamada e estamos aguardando a resposta de cada página-alvo. Se travar aqui, provavelmente uma das chamadas /feed ou /photos não respondeu.";
    case "published":
      return p.published_at
        ? `Publicado em ${format(new Date(p.published_at), "dd/MM/yyyy HH:mm")}. A Graph API retornou um id de post para todas as páginas-alvo (post_targets.status = published, com fb_post_id salvo).`
        : "Publicado: a Graph API confirmou o envio em todas as páginas-alvo.";
    case "partial":
      return "Parcial: a Graph API publicou em algumas páginas e falhou em outras. Veja em Detalhes qual página retornou erro (token, permissão ou mídia inacessível).";
    case "failed":
      return p.error
        ? `Falhou: a Graph API retornou erro em todas as páginas. Motivo: ${p.error}`
        : "Falhou: a Graph API rejeitou a publicação. Abra Detalhes para ver o código/subcódigo retornado por página.";
    case "canceled":
      return "Cancelado manualmente antes do horário agendado. Nenhuma chamada foi feita à Graph API.";
    default:
      return `Status: ${p.status}`;
  }
}

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({ meta: [{ title: "Agenda — PagePilot" }] }),
  component: QueuePage,
});

function QueuePage() {
  const qc = useQueryClient();
  const publishFn = useServerFn(publishPostNow);
  const cancelFn = useServerFn(cancelScheduled);
  const delFn = useServerFn(deletePost);
  const delAllFn = useServerFn(deleteAllPosts);
  const detailsFn = useServerFn(getPostDetails);

  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["posts", status, search],
    queryFn: async () => {
      let q = supabase.from("posts").select("id, type, message, status, scheduled_at, published_at, created_at, tags, error").order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status as any);
      if (search) q = q.ilike("message", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const publish = useMutation({ mutationFn: (id: string) => publishFn({ data: { postId: id } }), onSuccess: () => { toast.success("Publicado"); qc.invalidateQueries({ queryKey: ["posts"] }); }, onError: (e: any) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: (id: string) => cancelFn({ data: { postId: id } }), onSuccess: () => { toast.success("Cancelado"); qc.invalidateQueries({ queryKey: ["posts"] }); }, onError: (e: any) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => delFn({ data: { postId: id } }), onSuccess: () => { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["posts"] }); }, onError: (e: any) => toast.error(e.message) });
  const removeAll = useMutation({
    mutationFn: (s: string) => delAllFn({ data: { status: s as any } }),
    onSuccess: (r: any) => { toast.success(`${r.count} post(s) removido(s)`); qc.invalidateQueries({ queryKey: ["posts"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const details = useQuery({
    queryKey: ["post-details", detailId],
    queryFn: () => detailsFn({ data: { postId: detailId! } }),
    enabled: !!detailId,
  });

  return (
    <div className="p-8 space-y-6">
    <TooltipProvider delayDuration={150}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agenda & fila</h1>
        <p className="text-sm text-muted-foreground">Acompanhe agendamentos, rascunhos e publicações.</p>
      </div>

      <div className="flex gap-3">
        <Input placeholder="Buscar texto…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Rascunhos</SelectItem>
            <SelectItem value="scheduled">Agendados</SelectItem>
            <SelectItem value="publishing">Publicando</SelectItem>
            <SelectItem value="published">Publicados</SelectItem>
            <SelectItem value="failed">Falhou</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="destructive"
          className="ml-auto"
          disabled={removeAll.isPending || posts.length === 0}
          onClick={() => {
            const label = status === "all" ? "TODOS os posts" : `todos os posts com status "${status}"`;
            if (confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) removeAll.mutate(status);
          }}
        >
          <Trash2 className="size-4 mr-1" />
          {status === "all" ? "Excluir todos" : `Excluir filtrados (${posts.length})`}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>}
        {!isLoading && posts.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">Nada por aqui.</div>}
        {posts.map(p => (
          <div key={p.id} className="p-4 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{p.message || <span className="italic text-muted-foreground">Sem texto</span>}</div>
              <div className="text-xs text-muted-foreground mt-1 flex gap-2 items-center flex-wrap">
                <Badge variant="outline">{p.type}</Badge>
                <span>{p.scheduled_at ? `agendado ${format(new Date(p.scheduled_at), "dd/MM HH:mm")}` : p.published_at ? `publicado ${format(new Date(p.published_at), "dd/MM HH:mm")}` : format(new Date(p.created_at), "dd/MM HH:mm")}</span>
                {p.tags?.length > 0 && p.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>)}
              </div>
              {p.error && (
                <div className="text-xs text-destructive mt-2 flex items-start gap-1">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span className="break-words">{p.error}</span>
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 cursor-help">
                  <Badge variant={p.status === "failed" ? "destructive" : p.status === "published" ? "default" : "outline"}>{p.status}</Badge>
                  <HelpCircle className="size-3 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
                {explainStatus(p)}
              </TooltipContent>
            </Tooltip>
            {(p.status === "failed" || p.error) && (
              <Button size="sm" variant="outline" onClick={() => setDetailId(p.id)}>
                <Info className="size-3 mr-1" /> detalhes
              </Button>
            )}
            {p.status === "failed" && (
              <Button size="sm" variant="outline" onClick={() => publish.mutate(p.id)}>
                <RefreshCw className="size-3 mr-1" /> tentar novamente
              </Button>
            )}
            {(p.status === "draft" || p.status === "scheduled") && (
              <Button size="sm" onClick={() => publish.mutate(p.id)}><Send className="size-3 mr-1" />Publicar</Button>
            )}
            {p.status === "scheduled" && (
              <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)}><X className="size-4" /></Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Excluir post?")) remove.mutate(p.id); }}><Trash2 className="size-4 text-destructive" /></Button>
          </div>
        ))}
      </div>

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
              <div className="text-sm font-medium">Páginas-alvo</div>
              <div className="border border-border rounded-md divide-y divide-border">
                {details.data.targets.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">Nenhuma página-alvo encontrada.</div>
                )}
                {details.data.targets.map((t: any) => (
                  <div key={t.id} className="p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{t.fb_pages?.name ?? "(página removida)"}</span>
                      <Badge variant={t.status === "failed" ? "destructive" : t.status === "published" ? "default" : "outline"} className="text-[10px]">
                        {t.status}
                      </Badge>
                      {t.fb_post_id && (
                        <a
                          href={`https://www.facebook.com/${t.fb_post_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" /> ver no Facebook
                        </a>
                      )}
                    </div>
                    {t.error && (
                      <div className="text-xs text-destructive break-words flex items-start gap-1">
                        <AlertCircle className="size-3 mt-0.5 shrink-0" />
                        {t.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
    </div>
  );
}
