// Public-facing absolute URL for assets that external services (e.g. Facebook
// Graph API) must fetch. Only the stable hosts are reachable without auth:
//   - project--{id}.lovable.app       → published deployment (public)
//   - project--{id}-dev.lovable.app   → latest preview build (public)
// Editor hosts are auth-gated and return 302 → auth-bridge for outside callers:
//   - {id}.lovableproject.com
//   - id-preview--{id}.lovable.app
const LOVABLE_PROJECT_ID = "4a56b795-e3ab-42a9-8eee-4ca48e008280";
const STABLE_HOST = `project--${LOVABLE_PROJECT_ID}-dev.lovable.app`;

export function publicAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined") {
    const host = window.location.host;
    // Already on the stable public host (or a custom domain) → use it.
    if (host.startsWith("project--") || (!host.endsWith(".lovableproject.com") && !host.startsWith("id-preview--"))) {
      return `${window.location.origin}${cleanPath}`;
    }
  }

  // Editor preview → swap to the always-public stable host.
  return `https://${STABLE_HOST}${cleanPath}`;
}
