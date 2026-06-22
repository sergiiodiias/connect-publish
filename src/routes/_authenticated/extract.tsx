import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { connectPage } from "@/lib/pages.functions";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Wand2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/extract")({
  head: () => ({ meta: [{ title: "Extrair tokens — PagePilot" }] }),
  component: ExtractPage,
});

type Extracted = { id: string; name: string; token: string; category?: string; bare?: boolean };

function extractTokens(input: string): Extracted[] {
  if (!input.trim()) return [];

  const results: Extracted[] = [];

  // Helper: walk a parsed JS value and collect every object that has access_token + id at its OWN level
  const collect = (n: any) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(collect);
    if (typeof n === "object") {
      if (typeof n.access_token === "string" && typeof n.id === "string") {
        results.push({
          id: n.id,
          name: typeof n.name === "string" ? n.name : "(sem nome)",
          token: n.access_token,
          category: typeof n.category === "string" ? n.category : undefined,
        });
      }
      for (const k of Object.keys(n)) collect(n[k]);
    }
  };

  // 1) Try strict parse of whole input
  try { collect(JSON.parse(input)); } catch {}

  // 2) Extract every balanced { ... } block from the raw text and parse individually.
  //    This handles Graph API Explorer dumps that wrap JSON with "==== Query / Response" headers.
  if (results.length === 0) {
    const text = input;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "{") continue;
      // Find matching closing brace, respecting strings
      let depth = 0;
      let inStr = false;
      let esc = false;
      let end = -1;
      for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
        } else {
          if (ch === '"') inStr = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { end = j; break; }
          }
        }
      }
      if (end === -1) break;
      const slice = text.slice(i, end + 1);
      // Only try parsing blocks that mention access_token to save work
      if (slice.includes("access_token")) {
        try {
          const obj = JSON.parse(slice);
          const before = results.length;
          collect(obj);
          if (results.length > before) {
            // Skip past this block to avoid reparsing nested ones we already collected
            i = end;
            continue;
          }
        } catch {}
      }
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
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string; name: string }[]>([]);
  const [groupChoice, setGroupChoice] = useState<string>("none"); // "none" | "new" | <uuid>
  const [newGroupName, setNewGroupName] = useState("");
  const connectFn = useServerFn(connectPage);

  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("page_groups")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

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
    if (groupChoice === "new" && !newGroupName.trim()) {
      toast.error("Informe o nome do novo grupo");
      return;
    }
    setBusy(true);
    setResults([]);

    // Resolve group id (create new if needed)
    let groupId: string | null = null;
    try {
      if (groupChoice === "new") {
        const { data: u } = await supabase.auth.getUser();
        const userId = u.user!.id;
        const { data: g, error } = await supabase
          .from("page_groups")
          .insert({ user_id: userId, name: newGroupName.trim() })
          .select("id")
          .single();
        if (error) throw error;
        groupId = g.id;
      } else if (groupChoice !== "none") {
        groupId = groupChoice;
      }
    } catch (e: any) {
      setBusy(false);
      toast.error(`Falha ao criar grupo: ${e.message}`);
      return;
    }

    const out: typeof results = [];
    const connectedPageUuids: string[] = [];
    for (const p of list) {
      try {
        const response = await connectFn({ data: { accessToken: p.token, pageId: p.id } });
        if (!response.ok) {
          out.push({ id: p.id, name: p.name, ok: false, error: response.error });
        } else {
          out.push({ id: p.id, name: p.name, ok: true });
          if (response.page?.id) connectedPageUuids.push(response.page.id);
        }
      } catch (e: any) {
        out.push({ id: p.id, name: p.name, ok: false, error: e?.message ?? "erro" });
      }
      setResults([...out]);
    }

    // Attach to group
    if (groupId && connectedPageUuids.length > 0) {
      try {
        const { data: u } = await supabase.auth.getUser();
        const userId = u.user!.id;
        const rows = connectedPageUuids.map((pid) => ({ group_id: groupId!, page_id: pid, user_id: userId }));
        await supabase.from("page_group_members").upsert(rows, { onConflict: "group_id,page_id" });
        qc.invalidateQueries({ queryKey: ["groups"] });
      } catch (e: any) {
        toast.error(`Páginas conectadas, mas falhou ao adicionar ao grupo: ${e.message}`);
      }
    }

    setBusy(false);
    const okCount = out.filter((r) => r.ok).length;
    if (okCount === list.length) toast.success(`${okCount}/${list.length} páginas conectadas${groupId ? " e adicionadas ao grupo" : ""}`);
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
          <div className="p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Adicionar ao grupo</Label>
                <Select value={groupChoice} onValueChange={setGroupChoice}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum grupo</SelectItem>
                    <SelectItem value="new">+ Criar novo grupo</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {groupChoice === "new" && (
                <div>
                  <Label className="text-xs">Nome do novo grupo</Label>
                  <Input
                    className="mt-1"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="ex.: Receitas"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={selected.size === extracted.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-medium">Selecionar todas ({extracted.length})</span>
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
                  <Badge variant={r.ok ? "default" : "destructive"} title={r.error}>
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
