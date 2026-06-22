import { useMemo, useState } from "react";
import type { RotationSlot } from "@/lib/rotation";
import type { ImportedPost } from "@/lib/sheets-csv.functions";
import { Button } from "@/components/ui/button";

type Props = {
  slots: RotationSlot[];
  posts: ImportedPost[];
  pageNames: Map<string, string>;
  pageSize?: number;
};

export function RotationMatrixPreview({ slots, posts, pageNames, pageSize = 25 }: Props) {
  const [page, setPage] = useState(0);

  const { rows, pageIds } = useMemo(() => {
    const byHour = new Map<number, RotationSlot[]>();
    const pages = new Set<string>();
    for (const s of slots) {
      const arr = byHour.get(s.hourIndex) ?? [];
      arr.push(s);
      byHour.set(s.hourIndex, arr);
      pages.add(s.pageId);
    }
    const orderedPages = Array.from(pages);
    const rows = Array.from(byHour.entries()).sort((a, b) => a[0] - b[0]);
    return { rows, pageIds: orderedPages };
  }, [slots]);

  if (!rows.length) return <div className="text-sm text-muted-foreground">Configure grupos e mídias para ver a matriz.</div>;

  const totalPages = Math.ceil(rows.length / pageSize);
  const view = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-md border border-border max-h-[420px]">
        <table className="text-xs w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left">Horário</th>
              {pageIds.map((pid) => (
                <th key={pid} className="px-2 py-1 text-left whitespace-nowrap">{pageNames.get(pid) ?? pid.slice(0, 6)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map(([hour, hourSlots]) => {
              const slotByPage = new Map(hourSlots.map((s) => [s.pageId, s]));
              const sample = hourSlots[0];
              return (
                <tr key={hour} className="border-t border-border">
                  <td className="px-2 py-1 whitespace-nowrap font-mono">
                    {new Date(sample.scheduledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                  </td>
                  {pageIds.map((pid) => {
                    const s = slotByPage.get(pid);
                    if (!s) return <td key={pid} className="px-2 py-1 text-muted-foreground">—</td>;
                    const p = posts[s.mediaIndex];
                    return (
                      <td key={pid} className="px-2 py-1 font-mono text-[10px] truncate max-w-[140px]" title={p?.mediaFileName}>
                        {p?.mediaFileName ?? `#${s.mediaIndex}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Anterior
          </Button>
          <span>{page + 1} / {totalPages}</span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            Próxima
          </Button>
          <span className="text-muted-foreground ml-2">{slots.length} publicações totais</span>
        </div>
      )}
    </div>
  );
}
