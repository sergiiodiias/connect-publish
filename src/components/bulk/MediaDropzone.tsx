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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onChange(map), [map, onChange]);

  const addFiles = (files: File[]) => {
    const next = new Map(map);
    let added = 0;
    for (const f of files) {
      const key = f.name.toLowerCase();
      if (!expectedFilenames.has(key)) continue;
      if (next.has(key)) continue;
      next.set(key, { file: f, name: f.name, url: IMG.test(f.name) ? URL.createObjectURL(f) : undefined });
      added++;
    }
    setMap(next);
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

  const clear = () => { map.forEach((v) => v.url && URL.revokeObjectURL(v.url)); setMap(new Map()); };

  const matched = map.size;
  const missing = expectedFilenames.size - matched;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
        }`}
      >
        <UploadCloud className="size-8 mx-auto mb-2 text-muted-foreground" />
        <div className="text-sm font-medium">Arraste arquivos ou pastas, ou clique para selecionar</div>
        <div className="text-xs text-muted-foreground mt-1">
          Apenas arquivos cujo nome bate com a coluna "CAMINHO" da planilha são aceitos.
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          // @ts-expect-error directory attrs
          webkitdirectory=""
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
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
      {matched > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto p-2 rounded-md border border-border">
          {Array.from(map.values()).map((m) => (
            <div key={m.name} className="aspect-square rounded-md bg-muted overflow-hidden flex items-center justify-center text-muted-foreground">
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
