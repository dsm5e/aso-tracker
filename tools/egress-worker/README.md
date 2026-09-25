# Egress worker (second IP for Apple requests)

**Status: prepared, not deployed.** Keywords works exactly as before until
the env vars below are set.

A Cloudflare Worker that forwards `GET` requests only to
`search.itunes.apple.com`, `itunes.apple.com` and `apps.apple.com`, and only
when the request carries the shared secret in `x-egress-secret`. The Keywords
host gate (`aso-keywords/server/host-gate.ts`) treats each egress as an extra
lane with its **own per-host budget**: its own token bucket and AIMD, starting
at 24/min and capped at 40/min. Requests rotate round-robin across direct and
the egresses. If an egress answers 401/403/429/5xx or fails at the network
level **3 times in a row**, it is disabled for **30 min**. A 403/429 also
halves that lane's rate and pauses it for 5 min, the same as the direct lane.

## Deploy

```bash
cd tools/egress-worker
npx wrangler login                    # once, in the browser
npx wrangler deploy                   # → https://aso-egress.<subdomain>.workers.dev
openssl rand -hex 32                  # generate a secret
npx wrangler secret put EGRESS_SECRET # paste it
```

Keep the secret out of the repo, including `wrangler.toml`. Store it in the
vault (`claude/references/API Keys & Services.md`).

## Test before relying on it

Cloudflare Workers leave through shared IPs. Apple may throttle or block them,
and we have no measurements yet. Check it by hand first:

```bash
W=https://aso-egress.<subdomain>.workers.dev
S=<secret>
# 1. The secret is enforced (expect 401) and the whitelist too (expect 422)
curl -s -o /dev/null -w '%{http_code}\n' "$W/?url=https%3A%2F%2Fitunes.apple.com%2Fsearch%3Fterm%3Dx"
curl -s -o /dev/null -w '%{http_code}\n' -H "x-egress-secret: $S" "$W/?url=https%3A%2F%2Fexample.com%2F"
# 2. MZStore search through the worker (US storefront), expect 200 + JSON
curl -s -H "x-egress-secret: $S" -H 'X-Apple-Store-Front: 143441,29' \
  "$W/?url=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("https://search.itunes.apple.com/WebObjects/MZStore.woa/wa/search?clientApplication=Software&media=software&term=dicom%20viewer"))')" | head -c 300
```

Then run a small comparison, for example 20–50 keywords through the worker at
≤ 20/min. Positions should match the direct ones, and there should be no
403/429. Check the `x-egress-colo` response header: Apple's answer may depend
on the Cloudflare location. **Enable it in Keywords only after this.**

## Enable in Keywords

Set these in the environment of the studio process (for example in the shell
before `npm run dev`):

```bash
export KEYWORDS_EGRESS_URLS=https://aso-egress.<subdomain>.workers.dev   # comma list for several
export KEYWORDS_EGRESS_SECRET=<secret>
```

Without a secret, the URLs are ignored and the log shows a warning. An egress
URL must be https; `localhost` is allowed for tests. You can see the lanes in
`GET /api/gate/status` (the `lanes[]` of every host) and in
`/__studio/status`. `/api/schedule` scales the nightly duration estimate by
the number of healthy lanes.

Only gated tasks that take the `via` argument and call `via.fetch` go through
an egress. These are MZStore search, iTunes search/lookup, the App Store page
and search hints. Every other request stays direct.

## Free-plan limits

The free Workers plan allows 100k requests/day, far above our ≈1–2k Apple
requests per night. Each Worker request can make at most 50 subrequests, and we
make 1.
