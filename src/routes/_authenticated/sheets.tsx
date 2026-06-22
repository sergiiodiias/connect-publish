import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listPages } from "@/lib/pages.functions";
import { readSheet, type SheetRow } from "@/lib/sheets.functions";
import { createPost } from "@/lib/posts.functions";
import { publicAssetUrl } from "@/lib/public-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, Wand2, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ImportPreviewDialog } from "@/components/import-preview-dialog";

export const Route = createFileRoute("/_authenticated/sheets")({
  head: () => ({ meta: [{ title: "Importar Planilha — PagePilot" }] }),
  component: ImportPage,
});

function ImportPage() {
  const qc = useQueryClient();
  const readFn = useServerFn(readSheet);
  const createFn = useServerFn(createPost);
  const listFn = useServerFn(listPages);

  const [sheetUrl, setSheetUrl] = useState("");
  const [data, setData] = useState<{ rows: SheetRow[]; sheetName?: string; tabs: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupId, setGroupId] = useState<string>("all");
  const [pageSel, setPageSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ row: number; ok: boolean; error?: string }[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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

  const applyGroup = (gid: string) => {
    setGroupId(gid);
    if (gid === "all") setPageSel(pages.map((p) => p.id));
    else {
      const g = groups.find((x: any) => x.id === gid);
      setPageSel((g?.page_group_members ?? []).map((m: any) => m.page_id));
    }
  };

  const load = async () => {
    if (!sheetUrl.trim()) { toast.error("Cole o link da planilha"); return; }
    setLoading(true);
    try {
      const r = await readFn({ data: { sheetUrl } });
      setData(r);
      // Pre-select rows that look usable (have photo URL or are text)
      const usable = new Set<number>();
      r.rows.forEach((row) => {
        if (row.fotoOk || row.tipo === "text") usable.add(row.rowIndex);
      });
      setSelected(usable);
      toast.success(`${r.rows.length} linha(s) carregada(s) da aba "${r.sheetName}"`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (idx: number) => {
    const n = new Set(selected);
    n.has(idx) ? n.delete(idx) : n.add(idx);
    setSelected(n);
  };

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.rows.length) setSelected(new Set());
    else setSelected(new Set(data.rows.map((r) => r.rowIndex)));
  };

  const stats = useMemo(() => {
    if (!data) return null;
    const sel = data.rows.filter((r) => selected.has(r.rowIndex));
    return {
      total: data.rows.length,
      selected: sel.length,
      withPhoto: sel.filter((r) => r.fotoOk).length,
      badPhoto: sel.filter((r) => r.foto && !r.fotoOk).length,
      scheduled: sel.filter((r) => r.scheduledAt).length,
      withComment: sel.filter((r) => r.comentario).length,
    };
  }, [data, selected]);

  const importAll = async (rowIndexes?: number[], scheduleOverride?: Map<number, string | null>) => {
    if (!data) return;
    const allowed = rowIndexes ? new Set(rowIndexes) : selected;
    const list = data.rows.filter((r) => allowed.has(r.rowIndex));
    if (list.length === 0) return toast.error("Selecione ao menos uma linha");
    if (pageSel.length === 0) return toast.error("Selecione ao menos uma página de destino");

    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: list.length });
    const out: typeof results = [];
    let i = 0;
    for (const r of list) {
      try {
        const useMedia = r.fotoOk;
        const type = useMedia ? r.tipo : (r.tipo === "photo" ? "text" : r.tipo);
        const scheduledAt = scheduleOverride ? (scheduleOverride.get(r.rowIndex) ?? null) : r.scheduledAt;

        await createFn({
          data: {
            type: type as any,
            message: r.titulo,
            mediaUrls: useMedia ? [r.foto.startsWith("/") ? `${window.location.origin}${r.foto}` : r.foto] : [],
            linkUrl: undefined,
            pageIds: pageSel,
            scheduledAt,
            tags: r.tags,
            autoComment: r.comentario ? { message: r.comentario, delaySeconds: r.delayComentario } : null,
          },
        });
        out.push({ row: r.rowIndex, ok: true });
      } catch (e: any) {
        out.push({ row: r.rowIndex, ok: false, error: e?.message ?? "erro" });
      }
      i++;
      setProgress({ done: i, total: list.length });
      setResults([...out]);
    }
    setBusy(false);
    setProgress(null);
    setPreviewOpen(false);
    qc.invalidateQueries();
    const okCount = out.filter((x) => x.ok).length;
    if (okCount === list.length) toast.success(`${okCount} postagem(ns) importada(s)`);
    else toast.error(`${list.length - okCount} falha(s) na importação`);
  };

  const selectedRows = useMemo(
    () => (data ? data.rows.filter((r) => selected.has(r.rowIndex)) : []),
    [data, selected],
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="size-6" /> Importar do Google Sheets
        </h1>
        <p className="text-sm text-muted-foreground">
          Cole o link da sua planilha. Colunas reconhecidas:{" "}
          <code>NUMERO</code>, <code>CAMINHO DA FOTO</code>, <code>TITULO</code>,{" "}
          <code>LINK DO COMENTARIO</code>, <code>DATA</code>, <code>HORA</code>.
          Opcionais: <code>tipo</code>, <code>tags</code>, <code>delay_comentario</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <Label>Link ou ID da planilha</Label>
        <div className="flex gap-2">
          <Input
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
          <Button onClick={load} disabled={loading}>
            {loading ? "Lendo…" : "Carregar"}
          </Button>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            Aba: <strong>{data.sheetName}</strong>
            {data.tabs.length > 1 && ` (outras: ${data.tabs.filter((t) => t !== data.sheetName).join(", ")})`}
          </p>
        )}
      </div>

      {data && data.rows.length > 0 && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <Label className="text-sm">Páginas / grupo de destino</Label>
              <Select value={groupId} onValueChange={applyGroup}>
                <SelectTrigger><SelectValue placeholder="Escolha um grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as páginas ({pages.length})</SelectItem>
                  {groups.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.page_group_members?.length ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{pageSel.length} página(s) selecionada(s)</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 text-sm space-y-1">
              {stats && (
                <>
                  <div>Linhas selecionadas: <strong>{stats.selected}</strong> / {stats.total}</div>
                  <div>Com foto válida (URL): <strong className="text-success">{stats.withPhoto}</strong></div>
                  {stats.badPhoto > 0 && (
                    <div className="text-destructive flex items-center gap-1">
                      <AlertTriangle className="size-3" />
                      Foto inválida (caminho local): <strong>{stats.badPhoto}</strong> — virarão post de texto
                    </div>
                  )}
                  <div>Agendadas: <strong>{stats.scheduled}</strong> · Com auto-comentário: <strong>{stats.withComment}</strong></div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="p-4 flex items-center gap-3 border-b border-border">
              <Checkbox
                checked={selected.size === data.rows.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-medium">Selecionar todas</span>
              <Button
                size="sm"
                className="ml-auto gap-2"
                onClick={() => setPreviewOpen(true)}
                disabled={busy || selected.size === 0 || pageSel.length === 0}
              >
                <Wand2 className="size-4" />
                {busy ? "Importando…" : `Importar ${selected.size || ""}`}
              </Button>
            </div>
            <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
              {data.rows.map((r) => {
                const res = results.find((x) => x.row === r.rowIndex);
                return (
                  <div key={r.rowIndex} className="p-3 flex items-start gap-3 hover:bg-muted/20">
                    <Checkbox
                      checked={selected.has(r.rowIndex)}
                      onCheckedChange={() => toggleRow(r.rowIndex)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-mono">#{r.numero}</Badge>
                        {r.scheduledAt && (
                          <Badge variant="secondary" className="text-[10px]">
                            {new Date(r.scheduledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </Badge>
                        )}
                        {r.fotoOk ? (
                          <Badge variant="outline" className="text-[10px] text-success">foto OK</Badge>
                        ) : r.foto ? (
                          <Badge variant="destructive" className="text-[10px]">caminho local — sem foto</Badge>
                        ) : null}
                        {res && (
                          <Badge variant={res.ok ? "default" : "destructive"} title={res.error}>
                            {res.ok ? "✓ importado" : "✗ erro"}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium line-clamp-2">{r.titulo}</div>
                      {r.comentario && (
                        <a
                          href={r.comentario}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full"
                        >
                          <ExternalLink className="size-3" />
                          {r.comentario}
                        </a>
                      )}
                      {r.foto && !r.fotoOk && (
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {r.foto}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {data && data.rows.length === 0 && (
        <div className="p-12 text-center text-sm text-muted-foreground border border-border rounded-xl bg-card">
          Nenhuma linha encontrada. Verifique se a aba tem cabeçalho na linha 1.
        </div>
      )}

      <ImportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        rows={selectedRows}
        pageCount={pageSel.length}
        busy={busy}
        progress={progress}
        onConfirm={(idxs, sched) => importAll(idxs, sched)}
      />
    </div>
  );
}
