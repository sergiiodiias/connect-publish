// Public-facing absolute URL for assets that external services (e.g. Facebook
// Graph API) must fetch. The Lovable dev preview host (id.lovableproject.com)
// is auth-gated and returns 302 → auth-bridge for unauthenticated callers,
// which breaks /photos and /videos uploads.
//
// Stable hosts (always public, no auth):
//   - project--{id}.lovable.app       → published deployment
//   - project--{id}-dev.lovable.app   → latest preview build
const LOVABLE_PROJECT_ID = "4a56b795-e3ab-42a9-8eee-4ca48e008280";

export function publicAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined") {
    const host = window.location.host;
    // Already on a public stable host → use it as-is.
    if (host.endsWith(".lovable.app")) {
      return `${window.location.origin}${cleanPath}`;
    }
    // Custom domain (anything that is not the preview host) → trust it.
    if (!host.endsWith(".lovableproject.com")) {
      return `${window.location.origin}${cleanPath}`;
    }
  }

  // Fall back to the stable preview host so Facebook (and other external
  // fetchers) can actually reach the asset.
  return `https://project--${LOVABLE_PROJECT_ID}-dev.lovable.app${cleanPath}`;
}
