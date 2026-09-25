// ASO Studio second egress — a tiny Cloudflare Worker that forwards GET
// requests to a fixed whitelist of Apple hosts. The Keywords host gate
// (aso-keywords/server/host-gate.ts) calls it as
//   GET https://<worker>/?url=<encoded https://search.itunes.apple.com/...>
//   x-egress-secret: <EGRESS_SECRET>
// and treats 401/403/429/5xx as "this egress is unhealthy".
//
// Secrets: `npx wrangler secret put EGRESS_SECRET` — never commit it.

const ALLOWED_HOSTS = new Set(['search.itunes.apple.com', 'itunes.apple.com', 'apps.apple.com']);

// Only these request headers are forwarded to Apple.
const FORWARD_HEADERS = ['accept', 'accept-language', 'user-agent', 'x-apple-store-front'];

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Constant-time string compare (secret check). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') return json(405, { error: 'GET only' });
    if (!env.EGRESS_SECRET) return json(500, { error: 'EGRESS_SECRET is not configured' });
    if (!safeEqual(request.headers.get('x-egress-secret') ?? '', env.EGRESS_SECRET)) {
      return json(401, { error: 'unauthorized' });
    }

    const raw = new URL(request.url).searchParams.get('url');
    let target;
    try {
      target = new URL(raw ?? '');
    } catch {
      return json(400, { error: 'url parameter required' });
    }
    // 400/422 (not 403) so a bad client request is not mistaken for an Apple limit.
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname) || target.port || target.username || target.password) {
      return json(422, { error: `host not allowed: ${target.hostname}` });
    }

    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: 'GET',
        headers,
        redirect: 'follow',
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (e) {
      return json(502, { error: `upstream fetch failed: ${e && e.message}` });
    }

    // Pass Apple's status and body through untouched; drop cookies.
    const out = new Headers();
    for (const name of ['content-type', 'retry-after', 'cache-control']) {
      const v = upstream.headers.get(name);
      if (v) out.set(name, v);
    }
    out.set('x-egress-colo', String(request.cf?.colo ?? ''));
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
