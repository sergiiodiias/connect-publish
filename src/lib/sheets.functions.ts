import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders() {
  const lovKey = process.env.LOVABLE_API_KEY;
  const gKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovKey || !gKey) throw new Error("Conexão com Google Sheets não configurada");
  return {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": gKey,
  };
}

function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}

function normalizeKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const KEY_ALIASES: Record<string, string> = {
  numero: "numero",
  num: "numero",
  id: "numero",
  caminho_da_foto: "foto",
  foto: "foto",
  imagem: "foto",
  midia: "foto",
  url_foto: "foto",
  titulo: "titulo",
  title: "titulo",
  texto: "titulo",
  mensagem: "titulo",
  link_do_comentario: "comentario",
  comentario: "comentario",
  link: "comentario",
  url: "comentario",
  data: "data",
  date: "data",
  hora: "hora",
  time: "hora",
  data_hora: "data_hora",
  tipo: "tipo",
  type: "tipo",
  tags: "tags",
  delay_comentario: "delay_comentario",
  paginas: "paginas",
};

function parseDateHora(data?: string, hora?: string, dataHora?: string): string | null {
  const combined = (dataHora ?? `${data ?? ""} ${hora ?? ""}`).trim();
  if (!combined) return null;

  // Try DD/MM/YYYY or DD/MM/YYYY HH:MM, then YYYY-MM-DD, then ISO
  let dt: Date | null = null;

  const brMatch = combined.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (brMatch) {
    const [, d, m, yRaw, hh, mm] = brMatch;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    // Treat as America/Sao_Paulo (-03:00)
    const iso = `${y.toString().padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${(hh ?? "12").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00-03:00`;
    dt = new Date(iso);
  } else {
    const isoMatch = combined.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT](\d{1,2}):(\d{2}))?/);
    if (isoMatch) {
      const [, y, m, d, hh, mm] = isoMatch;
      const iso = `${y}-${m}-${d}T${(hh ?? "12").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00-03:00`;
      dt = new Date(iso);
    } else {
      const parsed = new Date(combined);
      if (!isNaN(parsed.getTime())) dt = parsed;
    }
  }

  if (!dt || isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export type SheetRow = {
  rowIndex: number;
  numero: string;
  foto: string;
  fotoOk: boolean; // true if foto is a public http(s) URL
  titulo: string;
  comentario: string;
  scheduledAt: string | null;
  tipo: "text" | "photo" | "video" | "link";
  tags: string[];
  delayComentario: number;
  paginas: string[]; // optional per-row override (names or ids)
  raw: Record<string, string>;
};

export const readSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      sheetUrl: z.string().min(10),
      sheetName: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const id = extractSheetId(data.sheetUrl);

    // Discover sheets if no name provided
    let sheetName = data.sheetName;
    let tabs: string[] = [];
    {
      const r = await fetch(`${GATEWAY}/spreadsheets/${id}?includeGridData=false`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`Erro ao abrir planilha: ${r.status} ${await r.text()}`);
      const j: any = await r.json();
      tabs = (j.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);
      if (!sheetName) sheetName = tabs.find((t) => /post/i.test(t)) ?? tabs[0];
    }

    const range = `${sheetName}!A1:Z10000`;
    const vr = await fetch(`${GATEWAY}/spreadsheets/${id}/values/${range}`, { headers: authHeaders() });
    if (!vr.ok) throw new Error(`Erro ao ler valores: ${vr.status} ${await vr.text()}`);
    const vj: any = await vr.json();
    const values: string[][] = vj.values ?? [];
    if (values.length < 2) return { rows: [] as SheetRow[], sheetName, tabs };

    const headerRaw = values[0];
    const headers = headerRaw.map((h) => {
      const n = normalizeKey(h ?? "");
      return KEY_ALIASES[n] ?? n;
    });

    const rows: SheetRow[] = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.every((c) => !c || !String(c).trim())) continue;
      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => { raw[h] = (row[idx] ?? "").toString().trim(); });

      let foto = raw.foto ?? "";
      let fotoOk = /^https?:\/\//i.test(foto);
      if (foto && !fotoOk) {
        const fname = foto.split(/[\\/]/).pop()?.trim() ?? "";
        if (fname) {
          foto = `/api/public/drive/${encodeURIComponent(fname)}`;
          fotoOk = true;
        }
      }
      const titulo = raw.titulo ?? "";
      if (!titulo) continue; // need title at minimum

      const tipoRaw = (raw.tipo ?? "").toLowerCase();
      const tipo: SheetRow["tipo"] = tipoRaw === "video" || tipoRaw === "link" || tipoRaw === "text"
        ? tipoRaw
        : foto ? "photo" : "text";

      rows.push({
        rowIndex: i + 1,
        numero: raw.numero ?? String(i),
        foto,
        fotoOk,
        titulo,
        comentario: raw.comentario ?? "",
        scheduledAt: parseDateHora(raw.data, raw.hora, raw.data_hora),
        tipo,
        tags: (raw.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        delayComentario: Number(raw.delay_comentario) || 60,
        paginas: (raw.paginas ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        raw,
      });
    }

    return { rows, sheetName, tabs };
  });
