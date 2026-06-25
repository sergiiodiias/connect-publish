import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPages, connectPage, deletePage, deletePages, testPageToken, inspectTokens, updatePageToken, refreshTokensNow, listRefreshReports, refreshOnePage } from "@/lib/pages.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Clock, Copy, Eye, EyeOff, KeyRound, History, ChevronDown } from "lucide-react";
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

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function deltaLabel(prev: string | null, next: string | null): string {
  const a = daysUntil(prev);
  const b = daysUntil(next);
  if (a === null && b === null) return "—";
  if (a === null) return `agora ${b}d`;
  if (b === null) return `${a}d → ?`;
  if (a === b) return `${a}d (sem mudança)`;
  return `${a}d → ${b}d`;
}

function PagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPages);
  const connectFn = useServerFn(connectPage);
  const delFn = useServerFn(deletePage);
  const delManyFn = useServerFn(deletePages);
  const testFn = useServerFn(testPageToken);
  const inspectFn = useServerFn(inspectTokens);
  const { data: pages = [], isLoading } = useQuery({ queryKey: ["pages"], queryFn: () => listFn() });
  const { data: tokenInfo = {}, isFetching: tokenLoading, refetch: refetchTokens } = useQuery({
    queryKey: ["pages-token-info"],
    queryFn: () => inspectFn(),
    enabled: false,
    staleTime: 60_000,
  });

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [updateFor, setUpdateFor] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = pages.length > 0 && selected.size === pages.length;
  const [newToken, setNewToken] = useState("");
  const updateTokenFn = useServerFn(updatePageToken);
  const updateMut = useMutation({
    mutationFn: async () => {
      if (!updateFor) throw new Error("Nenhuma página");
      const r = await updateTokenFn({ data: { pageId: updateFor.id, accessToken: newToken.trim() } });
      if (!r.ok) throw new Error(r.error);
      return r;
    },
    onSuccess: () => {
      toast.success("Token atualizado");
      setUpdateFor(null);
      setNewToken("");
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["pages-token-info"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

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
  const removeMany = useMutation({
    mutationFn: (opts: { ids?: string[]; all?: boolean }) => delManyFn({ data: { pageIds: opts.ids, all: opts.all } }),
    onSuccess: (r) => { toast.success(`${r.deleted} página(s) removida(s)`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["pages"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (id: string) => testFn({ data: { pageId: id } }),
    onSuccess: (r) => { r.ok ? toast.success("Token válido") : toast.error(r.error ?? "Token inválido"); qc.invalidateQueries({ queryKey: ["pages"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const refreshOneFn = useServerFn(refreshOnePage);
  const refreshOne = useMutation({
    mutationFn: (pageId: string) => refreshOneFn({ data: { pageId } }),
    onSuccess: (r: any, pageId) => {
      const res = (r?.results ?? [])[0];
      if (res?.extended) toast.success(`Token estendido: ${res.name}`);
      else if (res?.needsReconnect) toast.error(`${res.name}: ${res.reconnectReason ?? "precisa reconectar"}`);
      else if (res?.exchangeError) toast.error(`${res.name}: ${res.exchangeError}`);
      else if (res?.skipped) toast.message(`${res.name}: ${res.isValid ? "token válido — não precisa renovar" : "pulado"}`);
      else if (res?.isValid) toast.success(`${res.name}: token válido`);
      else toast.error(`${res?.name ?? "Página"}: falha ao verificar`);
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["pages-token-info"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const refreshFn = useServerFn(refreshTokensNow);
  const [refreshReport, setRefreshReport] = useState<any | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const refreshAll = useMutation({
    mutationFn: (vars?: { withinDays?: number; force?: boolean }) => refreshFn({ data: vars ?? {} }),

    onSuccess: (r) => {
      const extendedNames = (r.results ?? []).filter((x: any) => x.extended).map((x: any) => x.name);
      const failed = (r.results ?? []).filter((x: any) => (x.exchangeError || x.debugError) && !x.needsReconnect);
      const reconnect = (r.results ?? []).filter((x: any) => x.needsReconnect).length;
      const skipped = (r.results ?? []).filter((x: any) => x.skipped).length;
      if (r.refreshed > 0) {
        toast.success(`${r.refreshed} token(s) estendido(s)${extendedNames.length <= 3 ? `: ${extendedNames.join(", ")}` : ""}`);
      } else {
        toast.message("Nenhum token precisou ser estendido", { description: `${r.debugged}/${r.total} verificados${skipped ? ` · ${skipped} adiados` : ""}` });
      }
      if (reconnect > 0) toast.error(`${reconnect} página(s) precisam ser reconectadas (token revogado no Facebook)`);
      if (r.economyMode) toast.warning("Modo econômico ativo: quota dos Apps ≥ 80% — só os urgentes foram processados");
      if (failed.length) toast.error(`${failed.length} página(s) com erro temporário — veja o relatório`);
      setRefreshReport(r);
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["pages-token-info"] });
      qc.invalidateQueries({ queryKey: ["refresh-reports"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const listReportsFn = useServerFn(listRefreshReports);
  const { data: reports = [] } = useQuery({
    queryKey: ["refresh-reports"],
    queryFn: () => listReportsFn(),
    enabled: historyOpen,
  });

  // Alerts derived from persisted token_expires_at
  const now = Date.now();
  const expiringSoon = pages.filter((p: any) => {
    if (!p.token_expires_at) return false;
    const ms = new Date(p.token_expires_at).getTime() - now;
    return ms > 0 && ms < 7 * 24 * 3600 * 1000;
  });
  const expired = pages.filter((p: any) => {
    if (!p.token_expires_at) return false;
    return new Date(p.token_expires_at).getTime() <= now;
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Páginas conectadas</h1>
          <p className="text-sm text-muted-foreground">Gerencie os Access Tokens das suas Páginas do Facebook.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex">
            <Button variant="outline" className="rounded-r-none" onClick={() => refreshAll.mutate(undefined)} disabled={refreshAll.isPending || pages.length === 0} title="Renova tokens, pulando os que ainda têm >30 dias de validade">
              <RefreshCw className={`size-4 mr-2 ${refreshAll.isPending ? "animate-spin" : ""}`} />
              {refreshAll.isPending ? "Renovando…" : "Renovar agora"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-l-none border-l-0 px-2" disabled={refreshAll.isPending || pages.length === 0} title="Opções de renovação">
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Renovar somente as que expiram em</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => refreshAll.mutate({ withinDays: 7 })}>menos de 7 dias</DropdownMenuItem>
                <DropdownMenuItem onClick={() => refreshAll.mutate({ withinDays: 15 })}>menos de 15 dias</DropdownMenuItem>
                <DropdownMenuItem onClick={() => refreshAll.mutate({ withinDays: 30 })}>menos de 30 dias</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => refreshAll.mutate({ force: true })} title="Ignora o filtro de 30d e renova todos">
                  <RefreshCw className="size-4 mr-2" />Forçar todas (ignorar filtros)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}><History className="size-4 mr-2" />Ver histórico</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
          <Button variant="outline" onClick={async () => { await refetchTokens(); await qc.invalidateQueries({ queryKey: ["pages"] }); }} disabled={tokenLoading || pages.length === 0}>
            <Clock className="size-4 mr-2" />{tokenLoading ? "Verificando…" : "Verificar validade"}
          </Button>
          {selected.size > 0 && (
            <Button variant="destructive" onClick={() => { if (confirm(`Excluir ${selected.size} página(s) selecionada(s)?`)) removeMany.mutate({ ids: Array.from(selected) }); }} disabled={removeMany.isPending}>
              <Trash2 className="size-4 mr-2" />Excluir selecionadas ({selected.size})
            </Button>
          )}
          {pages.length > 0 && (
            <Button variant="outline" onClick={() => { if (confirm(`Excluir TODAS as ${pages.length} páginas conectadas? Esta ação não pode ser desfeita.`)) removeMany.mutate({ all: true }); }} disabled={removeMany.isPending} title="Excluir todas as páginas">
              <Trash2 className="size-4 mr-2 text-destructive" />Excluir todas
            </Button>
          )}
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

      



      {(expiringSoon.length > 0 || expired.length > 0) && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
            <div className="space-y-1">
              {expired.length > 0 && (
                <div><strong>{expired.length}</strong> página(s) com token expirado: {expired.map((p: any) => p.name).join(", ")}</div>
              )}
              {expiringSoon.length > 0 && (
                <div><strong>{expiringSoon.length}</strong> página(s) expirando em menos de 7 dias: {expiringSoon.map((p: any) => p.name).join(", ")}</div>
              )}
              <div className="text-xs text-muted-foreground">A depuração automática roda todo dia 1 do mês. Clique em "Renovar agora" para forçar.</div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading && <div className="p-8 text-sm text-muted-foreground text-center">Carregando…</div>}
        {!isLoading && pages.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma página conectada ainda.</p>
          </div>
        )}
        {pages.length > 0 && (
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-3 text-xs">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => setSelected(v ? new Set(pages.map((p: any) => p.id)) : new Set())}
            />
            <span className="text-muted-foreground">
              {selected.size > 0 ? `${selected.size} de ${pages.length} selecionada(s)` : "Selecionar todas"}
            </span>
          </div>
        )}
        {pages.map((p: any) => {
          const info = tokenInfo[p.id];
          // Prefer fresh on-demand data; fall back to persisted token_expires_at from monthly cron.
          const persistedSeconds = p.token_expires_at
            ? Math.floor(new Date(p.token_expires_at).getTime() / 1000)
            : (p.token_last_debugged_at && p.is_active ? 0 : null);
          const effectiveExpiresAt = info?.expiresAt ?? persistedSeconds;
          const hasVerificationError = !!(info?.error || p.token_debug_error);
          const isKnownInvalid = info?.isValid === false || (p.token_last_debugged_at && !p.is_active);
          const exp = effectiveExpiresAt !== undefined && effectiveExpiresAt !== null
            ? formatExpiry(effectiveExpiresAt)
            : null;
          const toneClass =
            p.needs_reconnect || isKnownInvalid ? "border-destructive/40 text-destructive" :
            exp?.tone === "ok" ? "border-success/40 text-success" :
            exp?.tone === "never" ? "border-success/40 text-success" :
            exp?.tone === "warn" ? "border-warning/40 text-warning" :
            exp?.tone === "bad" ? "border-destructive/40 text-destructive" : "";
          const expiryDateStr = effectiveExpiresAt && effectiveExpiresAt > 0
            ? new Date(effectiveExpiresAt * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
            : null;
          const expiryLabel = p.needs_reconnect ? "precisa reconectar"
            : isKnownInvalid ? "token inválido"
            : hasVerificationError && !exp ? "erro ao verificar"
            : !exp ? "validade desconhecida"
            : exp.tone === "never" ? "longa duração · não expira"
            : `expira ${expiryDateStr} (em ${exp.label})`;
          const refreshedAt = p.token_last_refreshed_at ? new Date(p.token_last_refreshed_at) : null;
          const debuggedAt = p.token_last_debugged_at ? new Date(p.token_last_debugged_at) : null;
          return (
            <div key={p.id} className="p-4 space-y-3">
              <div className="flex items-center gap-4">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSel(p.id)} />
                <div className="size-12 rounded-full bg-muted overflow-hidden grid place-items-center">
                  {p.picture_url ? <img src={p.picture_url} alt="" className="w-full h-full object-cover" /> : <span className="text-muted-foreground text-xs">FB</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    {p.needs_reconnect ? <Badge variant="destructive" className="gap-1" title={p.reconnect_reason ?? "Token revogado pelo Facebook — atualize o Access Token"}><AlertTriangle className="size-3" />precisa reconectar</Badge>
                      : p.is_active ? <Badge variant="outline" className="gap-1"><CheckCircle2 className="size-3 text-success" />ativa</Badge>
                      : <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />inativa</Badge>}
                    <Badge variant="outline" className={`gap-1 ${toneClass}`} title={
                      p.needs_reconnect ? (p.reconnect_reason ?? "Token revogado pelo Facebook — atualize o Access Token") :
                      isKnownInvalid ? (info?.error ?? p.token_debug_error ?? "Token inválido ou expirado") :
                      hasVerificationError && !exp ? (info?.error ?? p.token_debug_error) :
                      effectiveExpiresAt && effectiveExpiresAt > 0
                        ? `Expira em ${new Date(effectiveExpiresAt * 1000).toLocaleString("pt-BR")}`
                        : effectiveExpiresAt === 0 ? "Token de longa duração — não expira" : "Validade ainda não verificada — clique em Verificar validade"
                    }>
                      <Clock className="size-3" />
                      {expiryLabel}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    <span>{p.category ?? "—"} · ID {p.fb_page_id}</span>
                    {refreshedAt && (
                      <span className="text-success">✓ renovado em {refreshedAt.toLocaleDateString("pt-BR")} {refreshedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                    {!refreshedAt && debuggedAt && (
                      <span>verificado em {debuggedAt.toLocaleDateString("pt-BR")} {debuggedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    )}
                    {!refreshedAt && !debuggedAt && (
                      <span className="text-warning">nunca verificado — clique em Verificar validade</span>
                    )}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    const url = `https://www.facebook.com/profile.php?id=${p.fb_page_id}`;
                    await navigator.clipboard.writeText(url);
                    toast.success("Link copiado");
                  }}
                  title="Copiar link do Facebook"
                >
                  <Copy className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { setUpdateFor({ id: p.id, name: p.name }); setNewToken(""); }} title="Atualizar token"><KeyRound className="size-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => test.mutate(p.id)} title="Testar token"><RefreshCw className="size-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm("Remover esta página?")) remove.mutate(p.id); }}><Trash2 className="size-4 text-destructive" /></Button>
              </div>
              {info && (
                <div className="ml-16 space-y-2">
                  <TokenRow
                    label="Token enviado"
                    token={info.accessToken}
                    revealed={revealed[`${p.id}:sent`]}
                    onToggle={() => setRevealed(s => ({ ...s, [`${p.id}:sent`]: !s[`${p.id}:sent`] }))}
                  />
                  <TokenRow
                    label="Token estendido (longa duração)"
                    token={info.longLivedToken}
                    placeholder={info.extendError ?? "—"}
                    revealed={revealed[`${p.id}:ext`]}
                    onToggle={() => setRevealed(s => ({ ...s, [`${p.id}:ext`]: !s[`${p.id}:ext`] }))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!updateFor} onOpenChange={(o) => !o && setUpdateFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar token{updateFor ? ` — ${updateFor.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Novo Access Token (estendido)</Label>
            <Textarea
              rows={5}
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="Cole aqui o token estendido (longa duração) da página"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              O token precisa pertencer à mesma página — validamos antes de salvar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUpdateFor(null)}>Cancelar</Button>
            <Button disabled={!newToken.trim() || updateMut.isPending} onClick={() => updateMut.mutate()}>
              {updateMut.isPending ? "Salvando…" : "Salvar token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refreshReport} onOpenChange={(o) => !o && setRefreshReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Relatório de renovação</DialogTitle>
          </DialogHeader>
          {refreshReport && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div className="rounded border p-2"><div className="text-lg font-semibold">{refreshReport.total}</div><div className="text-muted-foreground">total</div></div>
                <div className="rounded border p-2"><div className="text-lg font-semibold text-success">{refreshReport.refreshed}</div><div className="text-muted-foreground">estendidos</div></div>
                <div className="rounded border p-2"><div className="text-lg font-semibold">{refreshReport.debugged}</div><div className="text-muted-foreground">verificados</div></div>
                <div className="rounded border p-2"><div className="text-lg font-semibold text-warning">{refreshReport.skipped ?? 0}</div><div className="text-muted-foreground">adiados</div></div>
                <div className="rounded border p-2"><div className="text-lg font-semibold text-destructive">{refreshReport.invalidated}</div><div className="text-muted-foreground">inválidos</div></div>
              </div>
              {refreshReport.economyMode && (
                <div className="rounded border border-warning/40 bg-warning/5 p-2 text-xs">
                  ⚠️ Modo econômico: a quota dos Apps configurados está ≥ 80%. Só foram renovados tokens que expiram em menos de 7 dias.
                </div>
              )}
              {!refreshReport.canExtend && (
                <div className="rounded border border-warning/40 bg-warning/5 p-2 text-xs">
                  Sem App ID/Secret configurado em Ajustes — só foi possível verificar, não estender.
                </div>
              )}
              <div className="max-h-[50vh] overflow-auto rounded border divide-y">
                {(refreshReport.results ?? []).map((r: any) => (
                  <div key={r.pageId} className="p-2 flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {deltaLabel(r.previousExpiresAt, r.newExpiresAt)}
                        {r.appSlot ? ` · App #${r.appSlot}` : ""}
                      </div>
                      {(r.debugError || r.exchangeError) && (
                        <div className="text-xs text-destructive truncate" title={r.debugError ?? r.exchangeError}>
                          {r.debugError ?? r.exchangeError}
                        </div>
                      )}
                    </div>
                    {r.extended ? (
                      <Badge variant="outline" className="border-success/40 text-success gap-1"><CheckCircle2 className="size-3" />estendido</Badge>
                    ) : r.needsReconnect ? (
                      <Badge variant="destructive" className="gap-1" title={r.reconnectReason}><AlertTriangle className="size-3" />reconectar</Badge>
                    ) : r.skipped === "quota_high" ? (
                      <Badge variant="outline" className="border-warning/40 text-warning">adiado (quota)</Badge>
                    ) : r.skipped === "outside_window" ? (
                      <Badge variant="outline">fora da janela</Badge>
                    ) : r.skipped === "fresh" ? (
                      <Badge variant="outline" className="text-muted-foreground">ainda fresco (&gt;30d)</Badge>
                    ) : r.isValid ? (
                      <Badge variant="outline">já válido</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />falha temporária</Badge>
                    )}
                  </div>
                ))}

              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRefreshReport(null); setHistoryOpen(true); }}><History className="size-4 mr-2" />Ver histórico</Button>
            <Button onClick={() => setRefreshReport(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de renovações</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {reports.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum relatório ainda.</p>}
            {reports.map((rep: any) => (
              <details key={rep.id} className="rounded border p-2 text-sm">
                <summary className="cursor-pointer flex items-center justify-between gap-2">
                  <span>
                    <span className="text-xs text-muted-foreground">{new Date(rep.created_at).toLocaleString("pt-BR")}</span>
                    {" "}<Badge variant="outline" className="text-[10px]">{rep.source}</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {rep.summary?.refreshed ?? 0} estendidos · {rep.summary?.total ?? 0} páginas
                    {rep.summary?.economyMode ? " · econômico" : ""}
                  </span>
                </summary>
                <div className="mt-2 divide-y border-t">
                  {(rep.results ?? []).map((r: any) => (
                    <div key={r.pageId} className="py-1.5 flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="text-muted-foreground">{deltaLabel(r.previousExpiresAt, r.newExpiresAt)}</span>
                      {r.extended ? <Badge variant="outline" className="border-success/40 text-success text-[10px]">estendido</Badge>
                        : r.skipped ? <Badge variant="outline" className="text-[10px]">adiado</Badge>
                        : r.isValid ? <Badge variant="outline" className="text-[10px]">válido</Badge>
                        : <Badge variant="destructive" className="text-[10px]">inválido</Badge>}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
          <DialogFooter><Button onClick={() => setHistoryOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TokenRow({
  label, token, placeholder, revealed, onToggle,
}: {
  label: string;
  token: string | null;
  placeholder?: string;
  revealed: boolean;
  onToggle: () => void;
}) {
  const display = !token
    ? (placeholder ?? "—")
    : revealed
      ? token
      : `${token.slice(0, 14)}${"•".repeat(20)}${token.slice(-6)}`;
  const copy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    toast.success(`${label} copiado`);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-muted-foreground w-44 shrink-0">{label}</div>
      <code className="flex-1 text-[11px] font-mono bg-muted/40 rounded px-2 py-1 truncate" title={revealed && token ? token : undefined}>
        {display}
      </code>
      <Button variant="ghost" size="icon" className="size-7" onClick={onToggle} disabled={!token} title={revealed ? "Ocultar" : "Mostrar"}>
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={copy} disabled={!token} title="Copiar">
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
