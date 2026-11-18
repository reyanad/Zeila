/**
 * Content Security Policy for HTML pages. Scripts need the per-request nonce
 * (Next.js adds it to its own scripts); 'strict-dynamic' lets those load the
 * chunks they need. Payment happens on Chapa's own checkout page, so the only
 * Chapa origin here is the form target for the redirect to it. Styles allow
 * inline attributes, which React uses for layout.
 * Kept free of Node APIs: it runs in middleware.
 */
function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(nonce: string, env: { production: boolean; assetBaseUrl?: string; realtimeUrl?: string }): string {
  const assets = origin(env.assetBaseUrl);
  const realtime = origin(env.realtimeUrl);
  const realtimeSocket = realtime ? realtime.replace(/^http/, "ws") : null;
  const directives: Array<[string, Array<string | null | false>]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", !env.production && "'unsafe-eval'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", assets]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", realtime, realtimeSocket, !env.production && "ws:"]],
    ["frame-src", ["'none'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'", "https://checkout.chapa.co"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`);
  if (env.production) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
