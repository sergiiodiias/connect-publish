import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, connectPage, deletePage, testPageToken } from "@/lib/pages.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pages")({
  head: () => ({ meta: [{ title: "Páginas — PagePilot" }] }),
  component: PagesPage,
});

function PagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPages);
  const connectFn = useServerFn(connectPage);
  const delFn = useServerFn(deletePage);
  const testFn = useServerFn(testPageToken);
  const { data: pages = [], isLoading } = useQuery({ queryKey: ["pages"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");

  const connect = useMutation({
    mutationFn: () => connectFn({ data: { accessToken: token.trim(), pageId: pageId.trim() || undefined } }),
    onSuccess: () => { toast.success("Página conectada"); setOpen(false); setToken(""); setPageId(""); qc.invalidateQueries({ queryKey: ["pages"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { pageId: id } }),
    onSuccess: () => { toast.success("Página removida"); qc.invalidateQueries({ queryKey: ["pages"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (id: string) => testFn({ data: { pageId: id } }),
    onSuccess: (r) => { r.ok ? toast.success("Token válido") : toast.error(r.error ?? "Token inválido"); qc.invalidateQueries({ queryKey: ["pages"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Páginas conectadas</h1>
          <p className="text-sm text-muted-foreground">Gerencie os Access Tokens das suas Páginas do Facebook.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4 mr-2" />Conectar página</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Conectar página do Facebook</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Access Token</Label>
                <Textarea rows={4} value={token} onChange={e => setToken(e.target.value)} placeholder="Cole o Page Access Token (ou User Token com permissão pages_manage_posts)" />
                <p className="text-xs text-muted-foreground">Você pode gerar em developers.facebook.com → Graph API Explorer.</p>
              </div>
              <div className="space-y-2">
                <Label>Page ID <span className="text-muted-foreground">(opcional, se usar User Token)</span></Label>
                <Input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="ex: 1234567890" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button disabled={!token || connect.isPending} onClick={() => connect.mutate()}>Conectar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading && <div className="p-8 text-sm text-muted-foreground text-center">Carregando…</div>}
        {!isLoading && pages.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma página conectada ainda.</p>
          </div>
        )}
        {pages.map(p => (
          <div key={p.id} className="p-4 flex items-center gap-4">
            <div className="size-12 rounded-full bg-muted overflow-hidden grid place-items-center">
              {p.picture_url ? <img src={p.picture_url} alt="" className="w-full h-full object-cover" /> : <span className="text-muted-foreground text-xs">FB</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.is_active ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="size-3 text-success" />ativa</Badge>
                  : <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />inativa</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{p.category ?? "—"} · ID {p.fb_page_id}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => test.mutate(p.id)} title="Testar token"><RefreshCw className="size-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => { if (confirm("Remover esta página?")) remove.mutate(p.id); }}><Trash2 className="size-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
