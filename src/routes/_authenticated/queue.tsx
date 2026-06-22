import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { publishPostNow, cancelScheduled, deletePost } from "@/lib/posts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({ meta: [{ title: "Agenda — PagePilot" }] }),
  component: QueuePage,
});

function QueuePage() {
  const qc = useQueryClient();
  const publishFn = useServerFn(publishPostNow);
  const cancelFn = useServerFn(cancelScheduled);
  const delFn = useServerFn(deletePost);

  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["posts", status, search],
    queryFn: async () => {
      let q = supabase.from("posts").select("id, type, message, status, scheduled_at, published_at, created_at, tags").order("created_at", { ascending: false });
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

  return (
    <div className="p-8 space-y-6">
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
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>}
        {!isLoading && posts.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">Nada por aqui.</div>}
        {posts.map(p => (
          <div key={p.id} className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{p.message || <span className="italic text-muted-foreground">Sem texto</span>}</div>
              <div className="text-xs text-muted-foreground mt-1 flex gap-2 items-center">
                <Badge variant="outline">{p.type}</Badge>
                <span>{p.scheduled_at ? `agendado ${format(new Date(p.scheduled_at), "dd/MM HH:mm")}` : p.published_at ? `publicado ${format(new Date(p.published_at), "dd/MM HH:mm")}` : format(new Date(p.created_at), "dd/MM HH:mm")}</span>
                {p.tags?.length > 0 && p.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>)}
              </div>
            </div>
            <Badge variant={p.status === "failed" ? "destructive" : p.status === "published" ? "default" : "outline"}>{p.status}</Badge>
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
    </div>
  );
}
