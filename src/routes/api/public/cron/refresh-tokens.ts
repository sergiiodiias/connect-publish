import { createFileRoute } from "@tanstack/react-router";

async function run() {
  const { runRefreshTokens } = await import("@/lib/refresh-tokens.server");
  try {
    const result = await runRefreshTokens();
    return Response.json(result);
  } catch (e: any) {
    console.error("[cron/refresh-tokens]", e);
    return Response.json({ ok: false, error: e?.message ?? "erro" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/refresh-tokens")({
  server: {
    handlers: {
      POST: () => run(),
      GET: () => run(),
    },
  },
});
