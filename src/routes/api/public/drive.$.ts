import { createFileRoute } from "@tanstack/react-router";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

async function findFileId(filename: string) {
  const lovKey = process.env.LOVABLE_API_KEY;
  const gKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovKey || !gKey) throw new Error("Drive não configurado");
  const headers = {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": gKey,
  };
  const q = encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`);
  const url = `${GATEWAY}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=5&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Drive search ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const files: Array<{ id: string; name: string; mimeType: string }> = j.files ?? [];
  return files[0] ?? null;
}

export const Route = createFileRoute("/api/public/drive/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const raw = (params._splat ?? "").split("/").pop() ?? "";
          const filename = decodeURIComponent(raw);
          if (!filename) return new Response("filename required", { status: 400 });

          const file = await findFileId(filename);
          if (!file) return new Response("not found", { status: 404 });

          const lovKey = process.env.LOVABLE_API_KEY!;
          const gKey = process.env.GOOGLE_DRIVE_API_KEY!;
          const dl = await fetch(`${GATEWAY}/files/${file.id}?alt=media&supportsAllDrives=true`, {
            headers: {
              Authorization: `Bearer ${lovKey}`,
              "X-Connection-Api-Key": gKey,
            },
          });
          if (!dl.ok) return new Response(`download ${dl.status}`, { status: 502 });

          const ct = dl.headers.get("content-type") ?? file.mimeType ?? "application/octet-stream";
          return new Response(dl.body, {
            status: 200,
            headers: {
              "content-type": ct,
              "cache-control": "public, max-age=86400",
              "access-control-allow-origin": "*",
            },
          });
        } catch (e: any) {
          return new Response(e?.message ?? "error", { status: 500 });
        }
      },
    },
  },
});
