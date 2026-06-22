import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { connectPage } from "@/lib/pages.functions";
import { Copy, Wand2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/extract")({
  head: () => ({ meta: [{ title: "Extrair tokens — PagePilot" }] }),
  component: ExtractPage,
});

type Extracted = { id: string; name: string; token: string; category?: string };

function extractTokens(input: string): Extracted[] {
  if (!input.trim()) return [];

  // 1) Try strict JSON parse (handles /me/accounts payloads directly)
  const fromJson: Extracted[] = [];
  const tryJson = (raw: string) => {
    try {
      const obj = JSON.parse(raw);
      const walk = (n: any) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (typeof n === "object") {
          if (typeof n.access_token === "string" && typeof n.id === "string") {
            fromJson.push({
              id: n.id,
              name: typeof n.name === "string" ? n.name : "(sem nome)",
              token: n.access_token,
              category: typeof n.category === "string" ? n.category : undefined,
            });
          }
          for (const k of Object.keys(n)) walk(n[k]);
        }
      };
      walk(obj);
    } catch {}
  };
  tryJson(input);
  // Some users paste a snippet starting with a "," — wrap it
  if (fromJson.length === 0) tryJson(`{"data":[${input.replace(/^[\s,]+|[\s,]+$/g, "")}]}`);
  if (fromJson.length > 0) {
    return dedupe(fromJson);
  }

  // 2) Regex fallback for malformed / partial paste
  const results: Extracted[] = [];
  const tokenRe = /"access_token"\s*:\s*"([A-Za-z0-9_\-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(input))) {
    const token = m[1];
    const start = Math.max(0, m.index - 2000);
    const end = Math.min(input.length, m.index + 2000);
    const window = input.slice(start, end);
    const idM = /"id"\s*:\s*"(\d{6,})"/g;
    const nameM = /"name"\s*:\s*"([^"]+)"/;
    const catM = /"category"\s*:\s*"([^"]+)"/;
    // Find id closest to token offset within the window
    let bestId = "";
    let bestDist = Infinity;
    const offsetInWindow = m.index - start;
    let im: RegExpExecArray | null;
    while ((im = idM.exec(window))) {
      const d = Math.abs(im.index - offsetInWindow);
      if (d < bestDist) { bestDist = d; bestId = im[1]; }
    }
    const n = nameM.exec(window);
    const c = catM.exec(window);
    if (bestId) {
      results.push({ id: bestId, name: n?.[1] ?? "(sem nome)", token, category: c?.[1] });
    }
  }
  return dedupe(results);
}

function dedupe(list: Extracted[]): Extracted[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = `${p.id}:${p.token.slice(0, 24)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function ExtractPage() {
  const [raw, setRaw] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string; name: string }[]>([]);
  const connectFn = useServerFn(connectPage);

  const extracted = useMemo(() => extractTokens(raw), [raw]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === extracted.length) setSelected(new Set());
    else setSelected(new Set(extracted.map((p) => p.id)));
  };

  const copyAll = async () => {
    const text = extracted.map((p) => `${p.name} (${p.id}): ${p.token}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Tokens copiados");
  };

  const connectSelected = async () => {
    const list = extracted.filter((p) => selected.has(p.id));
    if (list.length === 0) {
      toast.error("Selecione ao menos uma página");
      return;
    }
    setBusy(true);
    setResults([]);
    const out: typeof results = [];
    for (const p of list) {
      try {
        const response = await connectFn({ data: { accessToken: p.token, pageId: p.id } });
        if (!response.ok) {
          out.push({ id: p.id, name: p.name, ok: false, error: response.error });
        } else {
          out.push({ id: p.id, name: p.name, ok: true });
        }
      } catch (e: any) {
        out.push({ id: p.id, name: p.name, ok: false, error: e?.message ?? "erro" });
      }
      setResults([...out]);
    }
    setBusy(false);
    const okCount = out.filter((r) => r.ok).length;
    if (okCount === list.length) toast.success(`${okCount}/${list.length} páginas conectadas`);
    else toast.error(`${list.length - okCount} token(s) expirado(s) ou inválido(s)`);
  };

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Extrair tokens</h1>
        <p className="text-sm text-muted-foreground">
          Cole a resposta bruta do Graph API (ex.: <code>/me/accounts</code>) ou qualquer texto que contenha
          <code> access_token</code>, <code>id</code> e <code>name</code>. O sistema extrai automaticamente.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <label className="text-sm font-medium">Texto / JSON</label>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='Cole aqui... ex.: { "data": [ { "access_token": "EAA...", "name": "Minha Página", "id": "1234567890" } ] }'
          className="min-h-[220px] font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRaw("")}>Limpar</Button>
          <Button variant="outline" size="sm" onClick={copyAll} disabled={extracted.length === 0}>
            <Copy className="size-4 mr-2" /> Copiar tokens
          </Button>
          <div className="ml-auto text-xs text-muted-foreground self-center">
            {extracted.length} página(s) detectada(s)
          </div>
        </div>
      </div>

      {extracted.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          <div className="p-4 flex items-center gap-3">
            <Checkbox
              checked={selected.size === extracted.length}
              onCheckedChange={toggleAll}
            />
            <span className="text-sm font-medium">Selecionar todas</span>
            <Button
              size="sm"
              className="ml-auto gap-2"
              onClick={connectSelected}
              disabled={busy || selected.size === 0}
            >
              <Wand2 className="size-4" />
              {busy ? "Conectando…" : `Conectar ${selected.size || ""}`}
            </Button>
          </div>
          {extracted.map((p) => {
            const r = results.find((x) => x.id === p.id);
            return (
              <div key={p.id + p.token.slice(0, 8)} className="p-4 flex items-center gap-3">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    ID {p.id} {p.category ? `· ${p.category}` : ""}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/80 truncate mt-1">
                    {p.token.slice(0, 32)}…
                  </div>
                </div>
                {r && (
                  <Badge variant={r.ok ? "default" : "destructive"}>
                    {r.ok ? "Conectada" : r.error?.slice(0, 40) ?? "Falhou"}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
