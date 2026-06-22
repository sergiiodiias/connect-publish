import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, XCircle, Image as ImageIcon, Calendar, MessageSquare, Search } from "lucide-react";
import { checkDriveFiles, type SheetRow } from "@/lib/sheets.functions";

export type ImportRow = SheetRow;

type DriveStatus = "unknown" | "checking" | "found" | "missing";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ImportRow[];
  pageCount: number;
  busy: boolean;
  progress: { done: number; total: number } | null;
  onConfirm: (rowIndexes: number[]) => void;
}

function getFilename(foto: string): string | null {
  if (!foto) return null;
  if (/^https?:\/\//i.test(foto)) return null;
  // Either a local path or already a /api/public/drive/<name>
  if (foto.startsWith("/api/public/drive/")) {
    return decodeURIComponent(foto.replace("/api/public/drive/", ""));
  }
  return foto.split(/[\\/]/).pop()?.trim() || null;
}

export function ImportPreviewDialog({ open, onOpenChange, rows, pageCount, busy, progress, onConfirm }: Props) {
  const checkFn = useServerFn(checkDriveFiles);
  const [driveStatus, setDriveStatus] = useState<Record<string, DriveStatus>>({});
  const [checking, setChecking] = useState(false);

  const now = Date.now();

  const annotated = useMemo(() => {
    const seenNum = new Map<string, number>();
    rows.forEach((r) => seenNum.set(r.numero, (seenNum.get(r.numero) ?? 0) + 1));

    return rows.map((r) => {
      const blocking: string[] = [];
      const warnings: string[] = [];
      const fname = getFilename(r.foto);

      if (!r.titulo?.trim()) blocking.push("título vazio");
      if (r.scheduledAt && new Date(r.scheduledAt).getTime() < now) blocking.push("data agendada no passado");
      if (r.titulo && r.titulo.length > 60000) warnings.push("título excede 60.000 caracteres");
      if (r.foto && !r.fotoOk && !fname) warnings.push("caminho de foto inválido — virará texto");
      if (seenNum.get(r.numero)! > 1) warnings.push(`#${r.numero} duplicado`);

      const status = fname ? driveStatus[fname] ?? "unknown" : "unknown";
      if (fname && status === "missing") warnings.push(`foto ${fname} não encontrada no Drive`);

      const finalType = (r.fotoOk && (status === "found" || status === "unknown" || status === "checking")) ? r.tipo : (r.tipo === "photo" ? "text" : r.tipo);

      return { row: r, blocking, warnings, fname, status, finalType };
    });
  }, [rows, driveStatus, now]);

  const importable = annotated.filter((a) => a.blocking.length === 0);
  const blocked = annotated.filter((a) => a.blocking.length > 0);

  const summary = {
    total: rows.length,
    importable: importable.length,
    blocked: blocked.length,
    withPhoto: annotated.filter((a) => a.row.fotoOk).length,
    scheduled: annotated.filter((a) => a.row.scheduledAt).length,
    withComment: annotated.filter((a) => a.row.comentario).length,
    driveMissing: Object.values(driveStatus).filter((s) => s === "missing").length,
  };

  const runDriveCheck = async () => {
    const names = Array.from(new Set(annotated.map((a) => a.fname).filter((n): n is string => !!n)));
    if (names.length === 0) return;
    setChecking(true);
    const next: Record<string, DriveStatus> = { ...driveStatus };
    names.forEach((n) => { next[n] = "checking"; });
    setDriveStatus(next);
    try {
      const { result } = await checkFn({ data: { filenames: names } });
      const updated: Record<string, DriveStatus> = { ...next };
      Object.entries(result).forEach(([k, v]) => { updated[k] = v ? "found" : "missing"; });
      setDriveStatus(updated);
    } finally {
      setChecking(false);
    }
  };

  const confirm = () => onConfirm(importable.map((a) => a.row.rowIndex));

  const canConfirm = !busy && importable.length > 0 && pageCount > 0;
  const progressPct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Prévia da importação</DialogTitle>
          <DialogDescription>
            Revise as linhas antes de criar os posts. Linhas com erro serão ignoradas automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm border border-border rounded-lg p-3 bg-muted/20">
          <div>Total: <strong>{summary.total}</strong></div>
          <div className="text-success">Importáveis: <strong>{summary.importable}</strong></div>
          {summary.blocked > 0 && <div className="text-destructive">Com erro: <strong>{summary.blocked}</strong></div>}
          <div>Com foto: <strong>{summary.withPhoto}</strong></div>
          <div>Agendadas: <strong>{summary.scheduled}</strong></div>
          <div>Auto-comentário: <strong>{summary.withComment}</strong></div>
          {summary.driveMissing > 0 && (
            <div className="text-destructive col-span-2">Fotos faltando no Drive: <strong>{summary.driveMissing}</strong></div>
          )}
        </div>

        {pageCount === 0 && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4" /> Selecione ao menos uma página de destino antes de importar.
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runDriveCheck} disabled={checking || busy} className="gap-2">
            <Search className="size-3.5" />
            {checking ? "Verificando…" : "Verificar fotos no Drive"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Faz uma busca por nome no Drive para confirmar que cada foto existe.
          </span>
        </div>

        <div className="flex-1 overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {annotated.map(({ row: r, blocking, warnings, fname, status, finalType }) => {
            const isBlocked = blocking.length > 0;
            const previewSrc = r.fotoOk ? (r.foto.startsWith("/") ? r.foto : r.foto) : null;
            return (
              <div key={r.rowIndex} className={`p-3 flex gap-3 ${isBlocked ? "bg-destructive/5" : ""}`}>
                <div className="size-16 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border">
                  {previewSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewSrc}
                      alt=""
                      className="size-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono text-[10px]">#{r.numero}</Badge>
                    <Badge variant="secondary" className="text-[10px] uppercase">{finalType}</Badge>
                    {r.scheduledAt ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Calendar className="size-3" />
                        {new Date(r.scheduledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">rascunho</Badge>
                    )}
                    {fname && status === "found" && (
                      <Badge variant="outline" className="text-[10px] text-success gap-1">
                        <CheckCircle2 className="size-3" /> Drive OK
                      </Badge>
                    )}
                    {fname && status === "missing" && (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <XCircle className="size-3" /> sem foto no Drive
                      </Badge>
                    )}
                    {fname && status === "checking" && (
                      <Badge variant="outline" className="text-[10px]">verificando…</Badge>
                    )}
                    {r.comentario && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <MessageSquare className="size-3" /> +{r.delayComentario}s
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium line-clamp-2">{r.titulo || <em className="text-muted-foreground">sem título</em>}</div>
                  {fname && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{fname}</div>
                  )}
                  {blocking.length > 0 && (
                    <div className="text-[11px] text-destructive flex items-center gap-1">
                      <XCircle className="size-3" /> {blocking.join(" · ")}
                    </div>
                  )}
                  {warnings.length > 0 && (
                    <div className="text-[11px] text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> {warnings.join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {progress && (
          <div className="space-y-1">
            <Progress value={progressPct} />
            <div className="text-xs text-muted-foreground text-center">
              Importando {progress.done} de {progress.total}…
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            {busy ? "Importando…" : `Confirmar e importar ${importable.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
