import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listPages } from "@/lib/pages.functions";
import { importSheetCsv, type ImportedPost } from "@/lib/sheets-csv.functions";
import { createBulkJob } from "@/lib/bulk-upload.functions";
import { buildRotation, validateRotation, type RotationGroup, type RotationSlot } from "@/lib/rotation";
import { MediaDropzone, type LocalMedia } from "@/components/bulk/MediaDropzone";
import { RotationMatrixPreview } from "@/components/bulk/RotationMatrixPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, AlertTriangle, Rocket, GripVertical, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sheets")({
  head: () => ({ meta: [{ title: "Upload em Massa — PagePilot" }] }),
  component: BulkUploadPage,
});

const IMG = /\.(jpe?g|png|gif|webp)$/i;
const VID = /\.(mp4|mov|avi|mkv|webm)$/i;

function nowBrLocalInput(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + 60 * 60000);
  return d.toISOString().slice(0, 16);
}

function brInputToDate(v: string): Date {
  // v = "YYYY-MM-DDTHH:mm" interpretado como BR
  const [date, time] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0));
}

function BulkUploadPage() {
  const importFn = useServerFn(importSheetCsv);
  const listFn = useServerFn(listPages);
  const createJobFn = useServerFn(createBulkJob);

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState<Awaited<ReturnType<typeof importSheetCsv>> | null>(null);

  const [localMedia, setLocalMedia] = useState<Map<string, LocalMedia>>(new Map());

  const [useSheetDates, setUseSheetDates] = useState(true);
  const [startAt, setStartAt] = useState(nowBrLocalInput());
  const [intervalMin, setIntervalMin] = useState(60);
  const [rotationMode, setRotationMode] = useState<"group" | "page">("group");
  const [distribution, setDistribution] = useState<"mass" | "distribution">("distribution");

  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

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

  const pageNameMap = useMemo(() => {
    const m = new Map<string, string>();
    pages.forEach((p: any) => m.set(p.id, p.name ?? p.fb_page_id ?? p.id.slice(0, 6)));
    return m;
  }, [pages]);

  const expectedFilenames = useMemo(() => {
    const s = new Set<string>();
    imported?.posts.forEach((p) => s.add(p.mediaFileName.toLowerCase()));
    return s;
  }, [imported]);

  const orderedGroups: RotationGroup[] = useMemo(() => {
    return groupOrder
      .map((gid) => groups.find((g: any) => g.id === gid))
      .filter(Boolean)
      .map((g: any) => ({
        id: g.id,
        name: g.name,
        pageIds: (g.page_group_members ?? []).map((m: any) => m.page_id),
      }));
  }, [groupOrder, groups]);

  const matchedPosts: ImportedPost[] = useMemo(() => {
    if (!imported) return [];
    return imported.posts.filter((p) => localMedia.has(p.mediaFileName.toLowerCase()));
  }, [imported, localMedia]);

  const slots: RotationSlot[] = useMemo(() => {
    if (matchedPosts.length === 0 || orderedGroups.length === 0) return [];
    return buildRotation({
      posts: matchedPosts,
      groups: orderedGroups,
      startDate: brInputToDate(startAt),
      intervalMinutes: intervalMin,
      useSpreadsheetDates: useSheetDates && imported?.hasCustomDates === true,
      rotationMode,
      distribution,
    });
  }, [matchedPosts, orderedGroups, startAt, intervalMin, useSheetDates, imported?.hasCustomDates, rotationMode, distribution]);

  const validation = useMemo(() => validateRotation({
    posts: matchedPosts, groups: orderedGroups, rotationMode,
  }), [matchedPosts, orderedGroups, rotationMode]);

  const handleImport = async () => {
    if (!/docs\.google\.com\/spreadsheets/.test(url)) {
      toast.error("Cole o link público do Google Sheets.");
      return;
    }
    setLoading(true);
    try {
      const r = await importFn({ data: { url } });
      setImported(r);
      toast.success(`${r.posts.length} linha(s) importada(s)${r.errors.length ? ` · ${r.errors.length} erro(s)` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao importar");
    } finally { setLoading(false); }
  };

  const addGroup = (gid: string) => {
    if (!gid || groupOrder.includes(gid)) return;
    setGroupOrder([...groupOrder, gid]);
  };
  const removeGroup = (gid: string) => setGroupOrder(groupOrder.filter((g) => g !== gid));
  const moveGroup = (idx: number, dir: -1 | 1) => {
    const next = [...groupOrder];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setGroupOrder(next);
  };

  const handlePublish = async () => {
    if (validation.errors.length) { toast.error(validation.errors[0]); return; }
    if (!slots.length) { toast.error("Nada para publicar."); return; }

    setBusy(true);
    try {
      // 1) Upload de todas as mídias matched para Storage e gera signed URL
      const { data: session } = await supabase.auth.getUser();
      const uid = session.user?.id;
      if (!uid) throw new Error("Sessão expirada");

      const unique = Array.from(new Set(matchedPosts.map((p) => p.mediaFileName.toLowerCase())));
      setUploadProgress({ done: 0, total: unique.length });
      const fileUrlMap = new Map<string, string>();
      let done = 0;
      const concurrency = 5;
      const queue = [...unique];
      const worker = async () => {
        while (queue.length) {
          const key = queue.shift()!;
          const lm = localMedia.get(key)!;
          const path = `${uid}/${Date.now()}-${lm.name}`;
          let attempt = 0; let ok = false;
          while (attempt < 3 && !ok) {
            try {
              const { error: upErr } = await supabase.storage.from("post-media").upload(path, lm.file, {
                contentType: lm.file.type || undefined, upsert: false,
              });
              if (upErr) throw upErr;
              const { data: signed, error: sErr } = await supabase.storage.from("post-media")
                .createSignedUrl(path, 60 * 60 * 24 * 365);
              if (sErr || !signed) throw sErr ?? new Error("signed url falhou");
              fileUrlMap.set(key, signed.signedUrl);
              ok = true;
            } catch (e) {
              attempt++;
              if (attempt >= 3) throw e;
              await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
            }
          }
          done++; setUploadProgress({ done, total: unique.length });
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));

      // 2) Monta slots resolvidos
      const resolved = slots.map((s) => {
        const post = matchedPosts[s.mediaIndex];
        const key = post.mediaFileName.toLowerCase();
        const mediaUrl = fileUrlMap.get(key);
        if (!mediaUrl) throw new Error(`Mídia faltando: ${post.mediaFileName}`);
        const isVideo = VID.test(post.mediaFileName);
        return {
          pageId: s.pageId,
          mediaUrl,
          mediaFileName: post.mediaFileName,
          type: (isVideo ? "video" : "photo") as "video" | "photo",
          message: post.content,
          commentLink: post.commentLink,
          scheduledAt: s.scheduledAt,
        };
      });

      // 3) Cria job (que cria posts agendados; cron publica)
      const r = await createJobFn({ data: { slots: resolved } });
      toast.success(`Job criado: ${r.success} agendamento(s) · ${r.failed} falha(s)`);
      // reset parcial
      setImported(null); setLocalMedia(new Map());
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao publicar");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const availableGroups = groups.filter((g: any) => !groupOrder.includes(g.id));

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="size-6" /> Upload em Massa
        </h1>
        <p className="text-sm text-muted-foreground">
          Importe uma planilha pública do Google Sheets, casa as mídias arrastando do PC e distribui entre grupos com rotação.
        </p>
      </div>

      {/* 1. Importação */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <Label>Link público do Google Sheets</Label>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0" />
          <Button onClick={handleImport} disabled={loading}>
            {loading ? "Lendo…" : "Importar"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A planilha precisa estar compartilhada como "Qualquer pessoa com o link pode visualizar". Colunas reconhecidas:
          mídia (obrigatória), conteúdo, comentário, data, hora.
        </p>
        {imported && (
          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <div>Total: <strong>{imported.totalRows}</strong> · Importados: <strong className="text-success">{imported.posts.length}</strong></div>
            {imported.errors.length > 0 && (
              <details className="text-destructive text-xs">
                <summary>{imported.errors.length} erro(s)</summary>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {imported.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
            {imported.warnings.length > 0 && (
              <details className="text-amber-600 text-xs">
                <summary>{imported.warnings.length} aviso(s)</summary>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {imported.warnings.slice(0, 50).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {imported && imported.posts.length > 0 && (
        <>
          {/* 2. Datas */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <Label>Datas de agendamento</Label>
                <p className="text-xs text-muted-foreground">
                  {imported.hasCustomDates
                    ? "A planilha tem datas. Você pode usá-las ou recalcular pelo intervalo."
                    : "Sem datas na planilha — usaremos início + intervalo."}
                </p>
              </div>
              {imported.hasCustomDates && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Usar datas da planilha</span>
                  <Switch checked={useSheetDates} onCheckedChange={setUseSheetDates} />
                </div>
              )}
            </div>
            {(!imported.hasCustomDates || !useSheetDates) && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Início (Brasília)</Label>
                  <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Intervalo entre posts</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={72}
                      value={Math.floor(intervalMin / 60)}
                      onChange={(e) => {
                        const h = Math.max(0, Math.min(72, Number(e.target.value) || 0));
                        const m = intervalMin % 60;
                        setIntervalMin(Math.max(10, h * 60 + m));
                      }}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">h</span>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      step={5}
                      value={intervalMin % 60}
                      onChange={(e) => {
                        const m = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                        const h = Math.floor(intervalMin / 60);
                        setIntervalMin(Math.max(10, h * 60 + m));
                      }}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                    <span className="text-xs text-muted-foreground ml-2">= {intervalMin} min</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {[10, 15, 30, 60, 120, 240, 360, 720, 1440].map((v) => (
                      <Button key={v} type="button" size="sm" variant={intervalMin === v ? "default" : "outline"}
                        className="h-7 px-2 text-xs" onClick={() => setIntervalMin(v)}>
                        {v < 60 ? `${v}min` : `${v / 60}h`}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Mínimo 10 minutos. Máximo 72 horas.</p>
                </div>
              </div>
            )}
          </div>

          {/* 3. Mídias */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <Label>Mídias (arraste do seu PC)</Label>
            <MediaDropzone expectedFilenames={expectedFilenames} onChange={setLocalMedia} />
          </div>

          {/* 4. Grupos e rotação */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <Label>Grupos de páginas (ordem)</Label>
              <Select value="" onValueChange={addGroup}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Adicionar grupo…" /></SelectTrigger>
                <SelectContent>
                  {availableGroups.length === 0 && <SelectItem disabled value="_none">Sem grupos disponíveis</SelectItem>}
                  {availableGroups.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>{g.name} ({g.page_group_members?.length ?? 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {groupOrder.length === 0 ? (
              <p className="text-sm text-muted-foreground">Adicione pelo menos um grupo para distribuir os posts.</p>
            ) : (
              <ul className="space-y-1">
                {groupOrder.map((gid, idx) => {
                  const g: any = groups.find((x: any) => x.id === gid);
                  return (
                    <li key={gid} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
                      <Button size="sm" variant="ghost" onClick={() => moveGroup(idx, -1)}><GripVertical className="size-3" />↑</Button>
                      <Button size="sm" variant="ghost" onClick={() => moveGroup(idx, 1)}><GripVertical className="size-3" />↓</Button>
                      <Badge variant="outline">{idx + 1}</Badge>
                      <span className="font-medium text-sm">{g?.name ?? gid}</span>
                      <span className="text-xs text-muted-foreground">({g?.page_group_members?.length ?? 0} páginas)</span>
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => removeGroup(gid)}><X className="size-3" /></Button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Distribuição</Label>
                <Select value={distribution} onValueChange={(v: any) => setDistribution(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="distribution">Round-robin (rotação)</SelectItem>
                    <SelectItem value="mass">Massa (todos publicam tudo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {distribution === "distribution" && (
                <div>
                  <Label className="text-xs">Modo de rotação</Label>
                  <Select value={rotationMode} onValueChange={(v: any) => setRotationMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Por grupo (uma mídia por grupo)</SelectItem>
                      <SelectItem value="page">Por página (cada página, uma mídia)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div className="text-xs space-y-1">
                {validation.errors.map((e, i) => (
                  <div key={`e${i}`} className="text-destructive flex items-center gap-1"><AlertTriangle className="size-3" /> {e}</div>
                ))}
                {validation.warnings.map((w, i) => (
                  <div key={`w${i}`} className="text-amber-600 flex items-center gap-1"><AlertTriangle className="size-3" /> {w}</div>
                ))}
              </div>
            )}
          </div>

          {/* 5. Preview e publicação */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <Label>Pré-visualização da matriz</Label>
                <p className="text-xs text-muted-foreground">
                  {matchedPosts.length} mídia(s) casadas × {orderedGroups.reduce((s, g) => s + g.pageIds.length, 0)} página(s) = {slots.length} publicação(ões)
                </p>
              </div>
              <Button onClick={handlePublish} disabled={busy || validation.errors.length > 0 || slots.length === 0} className="gap-2">
                <Rocket className="size-4" />
                {busy
                  ? uploadProgress
                    ? `Enviando ${uploadProgress.done}/${uploadProgress.total}…`
                    : "Publicando…"
                  : `Agendar ${slots.length} post(s)`}
              </Button>
            </div>
            <RotationMatrixPreview slots={slots} posts={matchedPosts} pageNames={pageNameMap} />
          </div>
        </>
      )}
    </div>
  );
}
