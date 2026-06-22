import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ImportedPost = {
  rowIndex: number;
  mediaPath: string;
  mediaFileName: string;
  content: string;
  commentLink: string | null;
  scheduledAt: string | null; // ISO UTC
};

export type ImportResult = {
  success: boolean;
  posts: ImportedPost[];
  errors: string[];
  warnings: string[];
  hasCustomDates: boolean;
  totalRows: number;
};

const IMG_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const VID_EXTS = new Set(["mp4", "mov", "avi", "mkv", "webm"]);

function extractId(url: string): string | null {
  const patterns: RegExp[] = [
    /\/spreadsheets\/d\/([A-Za-z0-9-_]{20,})/,
    /spreadsheets.*?([A-Za-z0-9-_]{25,50})/,
    /^([A-Za-z0-9-_]{25,50})$/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractGid(url: string): { gid: string; defaulted: boolean } {
  const q = url.match(/[?&]gid=(\d+)/);
  if (q) return { gid: q[1], defaulted: false };
  const h = url.match(/#gid=(\d+)/);
  if (h) return { gid: h[1], defaulted: false };
  return { gid: "0", defaulted: true };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normHeader(s: string) {
  return s.replace(/^\uFEFF/, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function matchHeader(headers: string[], synonyms: string[]): number {
  const normalized = headers.map(normHeader);
  for (const syn of synonyms) {
    const s = normHeader(syn);
    const exact = normalized.indexOf(s);
    if (exact >= 0) return exact;
  }
  for (const syn of synonyms) {
    const s = normHeader(syn);
    const sub = normalized.findIndex((h) => h.length < 30 && (h.includes(s) || s.includes(h)));
    if (sub >= 0) return sub;
  }
  return -1;
}

const SYN = {
  media: ["caminho da foto", "caminho", "path", "foto", "media", "arquivo", "file", "imagem", "image", "video"],
  content: ["titulo", "title", "conteudo", "content", "legenda", "caption", "texto", "text"],
  comment: ["link do comentario", "link comentario", "primeiro comentario", "first comment", "comentario", "comment link", "comment"],
  date: ["data", "date", "agendamento", "schedule", "scheduled", "publicar", "publicacao", "data hora", "data/horario", "scheduled_at", "scheduledat", "data_agendamento", "datetime"],
  time: ["hora", "horario", "horário", "time", "hour", "horas"],
};

function looksLikeData(cell: string): boolean {
  const s = (cell ?? "").trim();
  if (!s) return false;
  if (/^\d+([.,]\d+)?$/.test(s)) return true;
  if (/^[a-zA-Z]:\\/.test(s)) return true;
  if (/^\/(Users|home)\//.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)) return true;
  return false;
}

function parseTimeCell(raw: string): { h: number; m: number } | null {
  const s = raw.trim();
  if (!s) return null;
  // Fração decimal do Sheets (pt-BR usa vírgula)
  const frac = s.replace(",", ".");
  if (/^0?\.\d+$/.test(frac)) {
    const f = parseFloat(frac);
    const total = Math.round(f * 24 * 60);
    return { h: Math.floor(total / 60) % 24, m: total % 60 };
  }
  const m = s.match(/^(\d{1,2})[:.,h](\d{2})(?::(\d{2}))?$/i);
  if (m) return { h: Number(m[1]), m: Number(m[2]) };
  const onlyH = s.match(/^(\d{1,2})h?$/i);
  if (onlyH) return { h: Number(onlyH[1]), m: 0 };
  return null;
}

// Recebe BR local → devolve ISO UTC
function brToUtcIso(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi, 0)).toISOString();
}

function parseDateCell(dateRaw: string, timeRaw: string): { iso: string | null; warning: string | null; error: string | null } {
  const ds = (dateRaw ?? "").trim();
  if (!ds) return { iso: null, warning: null, error: null };
  let y: number, mo: number, d: number, h = -1, mi = -1;
  const br = ds.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  const iso = ds.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (br) {
    d = Number(br[1]); mo = Number(br[2]);
    y = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    if (br[4]) { h = Number(br[4]); mi = Number(br[5]); }
  } else if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
    if (iso[4]) { h = Number(iso[4]); mi = Number(iso[5]); }
  } else {
    return { iso: null, warning: null, error: `Data inválida: "${ds}"` };
  }
  let warning: string | null = null;
  if (h < 0) {
    const t = parseTimeCell(timeRaw);
    if (t) { h = t.h; mi = t.m; }
    else { h = 10; mi = 0; warning = "Hora não especificada, usando 10:00"; }
  }
  const isoUtc = brToUtcIso(y, mo, d, h, mi);
  // Reject past in Brasilia time
  const nowBr = Date.now() - 3 * 3600 * 1000; // shift now back 3h to compare
  const slotBr = new Date(isoUtc).getTime() - 3 * 3600 * 1000;
  if (slotBr < nowBr) return { iso: null, warning, error: `Data no passado: ${ds}` };
  return { iso: isoUtc, warning, error: null };
}

function basename(p: string) {
  return (p ?? "").split(/[\\/]/).pop()?.trim() ?? "";
}

export const importSheetCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ url: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const id = extractId(data.url);
    if (!id) throw new Error("URL da planilha inválida. Use o link público do Google Sheets.");
    const { gid, defaulted } = extractGid(data.url);

    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const r = await fetch(csvUrl, { redirect: "follow" });
    if (r.status === 404) throw new Error("Planilha não encontrada (404).");
    if (r.status === 401 || r.status === 403) {
      throw new Error("Acesso negado. Compartilhe como 'Qualquer pessoa com o link pode visualizar'.");
    }
    if (!r.ok) throw new Error(`Falha ao baixar planilha: HTTP ${r.status}`);
    const text = await r.text();
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error("Google devolveu HTML em vez de CSV. Compartilhe a planilha como 'Qualquer pessoa com o link pode visualizar'.");
    }

    const rows = parseCsv(text);
    if (rows.length < 2) {
      return { success: true, posts: [], errors: ["Planilha vazia."], warnings: [], hasCustomDates: false, totalRows: 0 } satisfies ImportResult;
    }
    const header = rows[0];
    if (looksLikeData(header[0])) {
      return {
        success: false,
        posts: [],
        errors: ["A primeira linha parece dado, não cabeçalho. Verifique se a planilha tem cabeçalho ou se o gid está correto."],
        warnings: defaulted ? ["Nenhum gid informado, usando aba 0."] : [],
        hasCustomDates: false,
        totalRows: rows.length - 1,
      } satisfies ImportResult;
    }

    const idxMedia = matchHeader(header, SYN.media);
    const idxContent = matchHeader(header, SYN.content);
    const idxComment = matchHeader(header, SYN.comment);
    const idxDate = matchHeader(header, SYN.date);
    const idxTime = matchHeader(header, SYN.time);
    if (idxMedia < 0) {
      return {
        success: false, posts: [],
        errors: [`Coluna de mídia não encontrada. Use uma das: ${SYN.media.slice(0, 6).join(", ")}.`],
        warnings: [], hasCustomDates: false, totalRows: rows.length - 1,
      } satisfies ImportResult;
    }

    const posts: ImportedPost[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    if (defaulted) warnings.push("Nenhum gid informado, usando a primeira aba (gid=0).");
    let hasCustomDates = false;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1;
      const mediaPath = (row[idxMedia] ?? "").trim();
      if (!mediaPath) continue; // linhas em branco silenciosas
      const mediaFileName = basename(mediaPath);
      if (!mediaFileName) { errors.push(`Linha ${rowIndex}: caminho da mídia vazio.`); continue; }
      const ext = mediaFileName.split(".").pop()?.toLowerCase() ?? "";
      if (!ext) { errors.push(`Linha ${rowIndex}: arquivo "${mediaFileName}" sem extensão.`); continue; }
      if (!IMG_EXTS.has(ext) && !VID_EXTS.has(ext)) {
        errors.push(`Linha ${rowIndex}: extensão .${ext} não suportada. Use ${[...IMG_EXTS, ...VID_EXTS].join("/")}.`);
        continue;
      }

      const content = idxContent >= 0 ? (row[idxContent] ?? "").trim() : "";
      const commentLink = idxComment >= 0 ? (row[idxComment] ?? "").trim() : "";
      const dateRaw = idxDate >= 0 ? (row[idxDate] ?? "") : "";
      const timeRaw = idxTime >= 0 ? (row[idxTime] ?? "") : "";
      const parsed = parseDateCell(dateRaw, timeRaw);
      if (parsed.error) { errors.push(`Linha ${rowIndex}: ${parsed.error}`); continue; }
      if (parsed.warning) warnings.push(`Linha ${rowIndex}: ${parsed.warning}`);
      if (parsed.iso) hasCustomDates = true;

      posts.push({
        rowIndex,
        mediaPath,
        mediaFileName,
        content,
        commentLink: commentLink || null,
        scheduledAt: parsed.iso,
      });
    }

    return {
      success: true,
      posts,
      errors,
      warnings,
      hasCustomDates,
      totalRows: rows.length - 1,
    } satisfies ImportResult;
  });
