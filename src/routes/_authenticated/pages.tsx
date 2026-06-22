import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, connectPage, deletePage, testPageToken, inspectTokens } from "@/lib/pages.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pages")({
  head: () => ({ meta: [{ title: "Páginas — PagePilot" }] }),
  component: PagesPage,
});

function formatExpiry(expiresAt: number | null): { label: string; tone: "ok" | "warn" | "bad" | "never" } {
  if (expiresAt === null) return { label: "desconhecido", tone: "warn" };
  if (expiresAt === 0) return { label: "não expira", tone: "never" };
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return { label: "expirado", tone: "bad" };
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  let label: string;
  if (days >= 1) label = `${days}d ${hours}h`;
  else {
    const mins = Math.floor((diff % 3600) / 60);
    label = `${hours}h ${mins}m`;
  }
  const tone: "ok" | "warn" | "bad" = days >= 7 ? "ok" : days >= 1 ? "warn" : "bad";
  return { label, tone };
}

function PagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPages);
  const connectFn = useServerFn(connectPage);
  const delFn = useServerFn(deletePage);
  const testFn = useServerFn(testPageToken);
  const inspectFn = useServerFn(inspectTokens);
  const { data: pages = [], isLoading } = useQuery({ queryKey: ["pages"], queryFn: () => listFn() });
  const { data: tokenInfo = {}, isFetching: tokenLoading, refetch: refetchTokens } = useQuery({
    queryKey: ["pages-token-info"],
    queryFn: () => inspectFn(),
    enabled: pages.length > 0,
    staleTime: 60_000,
  });

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");

  const connect = useMutation({
    mutationFn: async () => {
      const response = await connectFn({ data: { accessToken: token.trim(), pageId: pageId.trim() || undefined } });
      if (!response.ok) throw new Error(response.error);
      return response;
    },
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchTokens()} disabled={tokenLoading || pages.length === 0}>
            <Clock className="size-4 mr-2" />{tokenLoading ? "Verificando…" : "Verificar validade"}
          </Button>
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
