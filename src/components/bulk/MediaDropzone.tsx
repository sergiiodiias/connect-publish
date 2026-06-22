import { useEffect, useRef, useState } from "react";
import { UploadCloud, Image as ImageIcon, Film, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LocalMedia = { file: File; name: string; url?: string };

type Props = {
  expectedFilenames: Set<string>; // lowercased
  onChange: (map: Map<string, LocalMedia>) => void;
};

const IMG = /\.(jpe?g|png|gif|webp)$/i;

async function readEntries(entry: any): Promise<File[]> {
  const out: File[] = [];
  if (entry.isFile) {
    const f: File = await new Promise((res) => entry.file(res));
    out.push(f);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const all: any[] = await new Promise((res) => {
      const acc: any[] = [];
      const read = () => reader.readEntries((batch: any[]) => {
        if (!batch.length) return res(acc);
        acc.push(...batch); read();
      });
      read();
    });
    for (const e of all) out.push(...(await readEntries(e)));
  }
  return out;
}

export function MediaDropzone({ expectedFilenames, onChange }: Props) {
  const [map, setMap] = useState<Map<string, LocalMedia>>(new Map());
  const [dragging, setDragging] = useState(false);
  const [strict, setStrict] = useState(true);
  const [lastSkipped, setLastSkipped] = useState<string[]>([]);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => onChange(map), [map, onChange]);

  const addFiles = (files: File[]) => {
    const next = new Map(map);
    let added = 0;
    const skipped: string[] = [];
    for (const f of files) {
      const key = f.name.toLowerCase();
      if (strict && expectedFilenames.size > 0 && !expectedFilenames.has(key)) {
        skipped.push(f.name);
        continue;
      }
      if (next.has(key)) continue;
      next.set(key, { file: f, name: f.name, url: IMG.test(f.name) ? URL.createObjectURL(f) : undefined });
      added++;
    }
    setMap(next);
    setLastSkipped(skipped.slice(0, 8));
    return added;
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const collected: File[] = [];
    for (const it of items) {
      const entry = (it as any).webkitGetAsEntry?.();
      if (entry) collected.push(...(await readEntries(entry)));
      else if (it.kind === "file") {
        const f = it.getAsFile(); if (f) collected.push(f);
      }
    }
    if (!collected.length) {
      const files = Array.from(e.dataTransfer.files ?? []); collected.push(...files);
    }
    addFiles(collected);
  };

  const clear = () => { map.forEach((v) => v.url && URL.revokeObjectURL(v.url)); setMap(new Map()); setLastSkipped([]); };

  const matched = map.size;
  const missing = Math.max(0, expectedFilenames.size - matched);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-card"
        }`}
      >
        <UploadCloud className="size-8 mx-auto mb-2 text-muted-foreground" />
        <div className="text-sm font-medium">Arraste arquivos ou pastas aqui</div>
        <div className="text-xs text-muted-foreground mt-1">
          Funciona com Google Drive (Stream), OneDrive ou pastas locais.
        </div>
        <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
          <Button type="button" size="sm" variant="default" onClick={() => filesRef.current?.click()}>
            Selecionar arquivos
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
            Selecionar pasta
          </Button>
        </div>
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="image/*,video/*"
          hidden
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          // @ts-expect-error directory attrs
          webkitdirectory=""
          directory=""
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>

      <div className="flex items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          <span>Filtrar por nomes da planilha (desmarque para aceitar qualquer arquivo)</span>
        </label>
      </div>

      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-4 text-success" /> {matched} casadas</span>
        <span className="inline-flex items-center gap-1"><XCircle className="size-4 text-destructive" /> {missing} faltando</span>
        {matched > 0 && (
          <Button size="sm" variant="outline" className="ml-auto gap-2" onClick={clear}>
            <Trash2 className="size-3" /> Limpar
          </Button>
        )}
      </div>

      {strict && lastSkipped.length > 0 && (
        <div className="text-xs text-muted-foreground rounded-md border border-border p-2">
          <div className="font-medium mb-1">Ignorados por não baterem com a planilha:</div>
          <div className="font-mono truncate">{lastSkipped.join(", ")}</div>
          <div className="mt-1">Desmarque o filtro acima se os nomes na planilha não coincidem exatamente com os arquivos.</div>
        </div>
      )}

      {matched > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto p-2 rounded-md border border-border">
          {Array.from(map.values()).map((m) => (
            <div key={m.name} className="aspect-square rounded-md bg-muted overflow-hidden flex items-center justify-center text-muted-foreground" title={m.name}>
              {m.url ? (
                <img src={m.url} alt={m.name} loading="lazy" className="size-full object-cover" />
              ) : IMG.test(m.name) ? <ImageIcon className="size-6" /> : <Film className="size-6" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
