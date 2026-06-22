import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listPages } from "@/lib/pages.functions";
import { createPost, publishPostNow } from "@/lib/posts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, CalendarClock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/composer")({
  validateSearch: (s: Record<string, unknown>) => ({
    reusePostId: typeof s.reusePostId === "string" ? s.reusePostId : undefined,
  }),
  head: () => ({ meta: [{ title: "Agendar postagens — PagePilot" }] }),
  component: ComposerPage,
});

function ComposerPage() {
  const { reusePostId } = Route.useSearch();
  const qc = useQueryClient();
  const listFn = useServerFn(listPages);
  const createFn = useServerFn(createPost);
  const publishFn = useServerFn(publishPostNow);
  const { data: pages = [] } = useQuery({ queryKey: ["pages"], queryFn: () => listFn() });
  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("page_groups")
        .select("id, name, page_group_members(page_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [type, setType] = useState<"text" | "photo" | "video" | "link">("text");
  const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [autoOn, setAutoOn] = useState(false);
  const [commentMsg, setCommentMsg] = useState("");
  const [commentDelay, setCommentDelay] = useState(60);
  const [tagsInput, setTagsInput] = useState("");

  const applyGroup = (groupId: string) => {
    setGroupFilter(groupId);
    if (groupId === "all") {
      setSelected(pages.map((p) => p.id));
    } else {
      const g = groups.find((x: any) => x.id === groupId);
      const ids = (g?.page_group_members ?? []).map((m: any) => m.page_id);
      setSelected(ids);
    }
  };

  const toggleAll = () => setSelected(selected.length === pages.length ? [] : pages.map(p => p.id));

  const upload = async (file: File): Promise<string> => {
    const path = `${crypto.randomUUID()}-${file.name}`;
    const { data, error } = await supabase.storage.from("media").upload(path, file);
    if (error) throw new Error(error.message);
    const { data: signed } = await supabase.storage.from("media").createSignedUrl(data.path, 60 * 60 * 24 * 7);
    if (!signed?.signedUrl) throw new Error("não foi possível gerar URL");
    return signed.signedUrl;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const t = toast.loading("Enviando mídia…");
    try { const url = await upload(f); setMediaUrl(url); toast.success("Mídia pronta", { id: t }); }
    catch (err: any) { toast.error(err.message, { id: t }); }
  };

  const submit = useMutation({
    mutationFn: async (mode: "now" | "schedule") => {
      if (selected.length === 0) throw new Error("Selecione ao menos uma página");
      const payload = {
        type,
        message,
        linkUrl: linkUrl || undefined,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        pageIds: selected,
        scheduledAt: mode === "schedule" ? new Date(scheduledAt).toISOString() : null,
        tags: tagsInput.split(",").map(s => s.trim()).filter(Boolean),
        autoComment: autoOn ? { message: commentMsg, delaySeconds: commentDelay } : null,
      };
      const r = await createFn({ data: payload });
      if (mode === "now") await publishFn({ data: { postId: r.postId } });
      return r;
    },
    onSuccess: (_d, mode) => {
      toast.success(mode === "now" ? "Publicando…" : "Agendado");
      setMessage(""); setLinkUrl(""); setMediaUrl(""); setCommentMsg("");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agendar postagens</h1>
          <p className="text-sm text-muted-foreground">Componha uma vez, publique ou agende em várias páginas.</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="photo">Foto</SelectItem>
                  <SelectItem value="video">Vídeo</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tags (separadas por vírgula)</Label>
              <Input className="mt-2" value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="promo, lancamento" />
            </div>
          </div>

          <div>
            <Label>Mensagem</Label>
            <Textarea className="mt-2" rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder="O que você quer publicar?" />
          </div>

          {type === "link" && (
            <div><Label>URL</Label><Input className="mt-2" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" /></div>
          )}
          {(type === "photo" || type === "video") && (
            <div className="space-y-2">
              <Label>Mídia</Label>
              <Input type="file" accept={type === "photo" ? "image/*" : "video/*"} onChange={onFile} />
              {mediaUrl && type === "photo" && <img src={mediaUrl} className="mt-2 max-h-48 rounded-md border border-border" />}
              {mediaUrl && type === "video" && <p className="text-xs text-success">vídeo carregado ✓</p>}
            </div>
          )}

          <div className="rounded-md bg-muted/40 border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div><Label>Agendar</Label><p className="text-xs text-muted-foreground">Programe para publicar depois.</p></div>
              <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} />
            </div>
            {scheduleOn && <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />}
          </div>

          <div className="rounded-md bg-muted/40 border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div><Label>Auto-comentário</Label><p className="text-xs text-muted-foreground">Comentar no próprio post após publicação.</p></div>
              <Switch checked={autoOn} onCheckedChange={setAutoOn} />
            </div>
            {autoOn && (
              <div className="grid grid-cols-3 gap-3">
                <Textarea className="col-span-2" rows={3} value={commentMsg} onChange={e => setCommentMsg(e.target.value)} placeholder="Texto do comentário" />
                <div>
                  <Label className="text-xs">Delay (segundos)</Label>
                  <Input type="number" min={0} max={86400} value={commentDelay} onChange={e => setCommentDelay(Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" disabled={!scheduleOn || !scheduledAt || submit.isPending} onClick={() => submit.mutate("schedule")}>
              <CalendarClock className="size-4 mr-2" />Agendar
            </Button>
            <Button disabled={submit.isPending || scheduleOn} onClick={() => submit.mutate("now")}>
              <Send className="size-4 mr-2" />Publicar agora
            </Button>
          </div>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-3 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Páginas-alvo</span>
              <button onClick={toggleAll} className="text-xs text-primary hover:underline">{selected.length === pages.length ? "limpar" : "selecionar todas"}</button>
            </div>
            <div>
              <Label className="text-xs">Selecionar por grupo</Label>
              <Select value={groupFilter} onValueChange={applyGroup}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha um grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as páginas</SelectItem>
                  {groups.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.page_group_members?.length ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {pages.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Conecte páginas primeiro.</div>}
            {pages.map(p => (
              <label key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/40 cursor-pointer">
                <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter(x => x !== p.id))} />
                {p.picture_url ? <img src={p.picture_url} className="size-8 rounded-full object-cover" /> : <div className="size-8 rounded-full bg-muted" />}
                <span className="text-sm truncate flex-1">{p.name}</span>
              </label>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">{selected.length} selecionada(s)</div>
        </div>
      </aside>
    </div>
  );
}
