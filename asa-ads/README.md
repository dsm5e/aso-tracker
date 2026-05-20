# ASA Ads

Self-hosted Apple Search Ads optimization dashboard with ROI projection, bid intelligence, multi-app support, and ASC trial cross-match. Sibling to [`aso-keywords`](../aso-keywords) in the ASO Studio monorepo.

> **Status:** v0.2 (May 2026). Bloomberg-terminal aesthetic, fully real-time, designed to be driven by humans **or** an LLM agent.

https://github.com/dsm5e/aso-tracker/raw/main/asa-ads/docs/demo.mp4

## What it does

- **Performance dashboard.** Pulls campaigns + daily metrics from Apple Search Ads, joins with App Store Connect Sales Reports (`SUBSCRIPTION_EVENT`). Sparklines with hover tooltips, hero chart with metric switcher + WoW overlay, geo heatmap.
- **ROI projection.** Tells you *"spend $1000 on this campaign — expect N installs, M trials, $X revenue, Y% ROI"*. Honest about data quality — if signal is thin it says `WAIT · need 3 more days` instead of pretending.
- **Bid intelligence.** Per-keyword recommendations with confidence (high/medium/low). Click any keyword row to drill into 14-day history charts + ROI at different spend levels.
- **Search terms cleanup.** Auto-suggests negatives (terms that burn taps with zero installs) and discovery candidates (terms that converted but aren't in your keyword list).
- **Actions queue.** Every mutation (bid change, negative add, pause keyword, budget edit, pause/resume campaign) is enqueued first, you confirm with a spend-impact modal, the server applies it via ASA API and logs the result. Reversible via Actions screen.
- **Multi-app support.** App switcher in the sidebar — separate settings per app, scoped queries everywhere.
- **Settings auto-suggestion.** `trial_to_paid_rate` computed from your real ASC `Crossgrade from Introductory Offer` + `Billing Retry` events. Target CPI derived from your LTV × CR. ⚙ for business choices, ✅ for auto-computed.
- **Telegram alerts.** 🔥 Burn (spend without installs), 💸 High CPI, ⚠️ Stalled (ENABLED but not RUNNING), 📈 Spend spike — configurable thresholds.
- **API credentials UI.** Add ASA + ASC keys through Settings → no need to edit `.env` for new users.
- **Background sync.** Hit Sync now and navigate away — sync continues server-side. Return to ASA Ads and the progress bar resumes from where it was.
- **Live updates over SSE.** Multi-tab safe. Row-level phosphor flash when data lands.

## Stack

- Vite + React 19 + react-router (SPA, `base: '/asa/'`)
- Express 5 + better-sqlite3 + Server-Sent Events
- `jose` ES256 JWT for both ASA and ASC OAuth
- TypeScript everywhere
- Zero external chart library (custom SVG sparklines + hero chart)
- IBM Plex Mono via Google Fonts (no Inter, no Roboto — banned per design)

## Setup

### 1. Clone & install

```bash
git clone https://github.com/dsm5e/aso-tracker
cd aso-tracker
npm install                # installs all 4 studio tools as workspaces
```

### 2. Generate API credentials

**Apple Search Ads** ([ads.apple.com](https://ads.apple.com) → admin → Settings → API):
- Create an API Certificate, download the ES256 private key (`.p8`).
- Note `Client ID`, `Team ID`, `Key ID`, `Org ID`.

**App Store Connect** ([appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API):
- Create a key with at least `Sales and Reports` permission.
- Download the `.p8`, note `Key ID`, `Issuer ID`, `Vendor Number`.

### 3. Configure

Either via `.env`:

```bash
cp .env.example .env
# edit .env with your IDs and absolute paths to the .p8 files
```

Or via UI: open the app, go to `Settings → API Credentials`, paste IDs + PEM contents. Saved to SQLite (still gitignored).

### 4. Run

```bash
npm run sync 14    # pull last 14 days from ASA + ASC into ./data/asa-ads.db
npm run dev        # vite on :5193, api on :5194
```

Open <http://localhost:5193>.

When run as part of the [`aso-studio`](../) monorepo, it's also reachable at `http://localhost:5173/asa/` (proxied through the Keywords origin).

## How LLM agents use this

ASA Ads is built to be **agent-friendly**. Most state is in SQLite + JSON over HTTP, so any LLM with shell access can drive it:

### State sources

| Where | What | Format |
|---|---|---|
| `data/asa-ads.db` | Campaigns, keywords, daily metrics, search terms, settings, alerts, action log | SQLite |
| `GET /api/campaigns?days=14&app_id=X` | Campaigns with rolled-up metrics | JSON |
| `GET /api/keywords?days=14` | Keywords + spend/installs/CPT | JSON |
| `GET /api/search-terms?days=14` | Search terms aggregated | JSON |
| `GET /api/roi/campaign/:id?spend=X` | ROI projection at given spend | JSON |
| `GET /api/roi/keyword/:id?spend=X` | Per-keyword ROI projection | JSON |
| `GET /api/recommendations/bids?days=7` | Bid recommendations with confidence | JSON |
| `GET /api/recommendations/search-terms` | Negatives + discovery suggestions | JSON |
| `GET /api/sync/status` | Current sync phase + progress | JSON |
| `GET /api/alerts` | Sent alert history | JSON |
| `GET /sse` | Server-Sent Events stream (live updates) | text/event-stream |

### Mutation pattern — always via Actions queue

Direct DB writes are not the right path — use the actions queue so the change reaches ASA and is logged:

```bash
# 1. Enqueue an action
curl -s -X POST http://localhost:5194/api/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"update_bid","campaign_id":2143847206,"ad_group_id":2148358337,"keyword_id":2265071585,"amount":"0.60"}'
# → {"id": 42}

# 2. Apply it (calls ASA API)
curl -s -X POST http://localhost:5194/api/actions/42/apply
# → {"ok": true}
```

Supported action types: `update_bid`, `add_negative`, `pause_keyword`, `update_default_bid`, `pause_campaign`, `resume_campaign`, `update_daily_budget`.

### Typical agent workflows

**Audit the account**:
```bash
# Get all campaigns + their ROI verdicts
for cid in $(sqlite3 data/asa-ads.db "SELECT id FROM asa_campaigns WHERE status='ENABLED'"); do
  curl -s "http://localhost:5194/api/roi/campaign/$cid?spend=1000"
done | jq -s 'group_by(.verdict.kind)'
```

**Find waste — keywords with high spend, zero installs**:
```sql
SELECT k.text, c.country, SUM(d.spend) AS spend, SUM(d.installs) AS installs
FROM asa_keywords k
JOIN asa_campaigns c ON c.id = k.campaign_id
LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= date('now', '-14 days')
GROUP BY k.id
HAVING spend > 1.0 AND installs = 0
ORDER BY spend DESC;
```

**Apply all high-confidence bid recommendations** (the dashboard has a "Bulk apply" button for this; programmatic equivalent):
```bash
curl -s http://localhost:5194/api/recommendations/bids?days=7 \
  | jq -r '.[] | select(.confidence=="high") | "\(.keyword_id) \(.recommended_bid)"' \
  | while read kid amount; do
      # Use sqlite to look up campaign_id / ad_group_id
      meta=$(sqlite3 data/asa-ads.db "SELECT campaign_id||' '||ad_group_id FROM asa_keywords WHERE id=$kid")
      cid=$(echo $meta | cut -d' ' -f1)
      agid=$(echo $meta | cut -d' ' -f2)
      enq=$(curl -s -X POST http://localhost:5194/api/actions \
        -H 'Content-Type: application/json' \
        -d "{\"type\":\"update_bid\",\"campaign_id\":$cid,\"ad_group_id\":$agid,\"keyword_id\":$kid,\"amount\":\"$amount\"}")
      aid=$(echo $enq | jq -r .id)
      curl -s -X POST http://localhost:5194/api/actions/$aid/apply
    done
```

**Monitor live**:
```bash
# Subscribe to SSE — see every sync phase, applied action, and alert in real time
curl -N http://localhost:5194/sse
```

### Settings the agent can tune

Edit via `PATCH /api/settings`:

| Key | What | Auto-computed? |
|---|---|---|
| `ltv_per_paid` | Lifetime value per paying user ($) | ⚙ manual |
| `trial_to_paid_rate` | 0–1 | ✅ from ASC events |
| `target_cpi_tier1` | $ | ✅ from LTV × CR |
| `target_cpi_tier2` | $ | ✅ from tier-1 × 0.6 |
| `alert_cpi_threshold` | $ | ✅ from target × 2 |
| `alert_spend_no_install` | $ | ✅ from target × 5 |
| `min_*_for_signal` | Confidence gates | ⚙ manual |

```bash
# Apply auto-suggestions
curl -s http://localhost:5194/api/settings/suggest > /tmp/sug.json
jq '{
  trial_to_paid_rate: .trial_to_paid_rate.value,
  target_cpi_tier1:   .target_cpi_tier1.value,
  target_cpi_tier2:   .target_cpi_tier2.value,
  alert_cpi_threshold: .alert_cpi_threshold.value,
  alert_spend_no_install: .alert_spend_no_install.value
}' /tmp/sug.json | curl -s -X PATCH -H 'Content-Type: application/json' -d @- http://localhost:5194/api/settings
```

## Architecture

```
asa-ads/
├── server/
│   ├── asa-client.ts   — ASA OAuth + REST wrapper (PUT for mutations, not POST)
│   ├── asc-client.ts   — ASC JWT + Sales Reports (gzip TSV)
│   ├── db.ts           — SQLite schema migration
│   ├── sync.ts         — ASA reports → SQLite, ASC events → SQLite, fire-and-forget background
│   ├── bid-engine.ts   — heuristic per-keyword bid recommender
│   ├── roi-engine.ts   — projected installs/trials/paid/revenue/ROI at any spend
│   ├── alerts.ts       — burn/high-CPI/stalled/spike rules → Telegram
│   ├── settings.ts     — per-app config store with auto-suggestion engine
│   ├── credentials.ts  — UI-managed ASA + ASC keys (DB-first, .env fallback)
│   ├── actions.ts      — enqueue / apply / cancel via ASA API
│   ├── queries.ts      — aggregations for the UI
│   ├── sse.ts          — broadcast hub
│   └── index.ts        — express server (port 5194)
├── src/                — React SPA (Vite, port 5193, base /asa/)
│   ├── screens/
│   │   ├── Dashboard.tsx     — campaigns × metrics + ROI verdict + collapsible rows
│   │   ├── CampaignDetail.tsx— drill-down with per-campaign chart + keywords
│   │   ├── Keywords.tsx      — keywords + bid recommendations + bulk apply
│   │   ├── SearchTerms.tsx   — negatives + discovery
│   │   ├── Negatives.tsx     — applied negatives list
│   │   ├── Actions.tsx       — queue with confirm/cancel
│   │   ├── Alerts.tsx        — Telegram alert history + rules
│   │   └── Settings.tsx      — config + API credentials + auto-suggestions
│   ├── components/
│   │   ├── BidChangeConfirm.tsx  — single-bid confirm modal with spend impact
│   │   ├── BulkApplyConfirm.tsx  — bulk confirm with impact summary
│   │   ├── CampaignControls.tsx  — pause/resume + edit budget
│   │   ├── CredentialsCard.tsx   — UI for ASA/ASC keys
│   │   ├── GeoHeatmap.tsx        — country heatmap
│   │   ├── HeroChart.tsx         — large chart with metric switcher + WoW overlay
│   │   ├── InfoTooltip.tsx       — ? hover tooltips
│   │   ├── KeywordExpand.tsx     — per-keyword history + ROI
│   │   ├── RoiDrawer.tsx         — full ROI projection drawer
│   │   ├── Sparkline.tsx         — SVG sparkline with hover
│   │   └── StudioSwitcher.tsx    — top-left ASO Studio app switcher
│   ├── lib/
│   │   ├── AppContext.tsx        — app selector context
│   │   ├── apiBase.ts            — proxy-aware URL helper
│   │   ├── csv.ts                — export utility
│   │   └── sse.ts                — EventSource hook
│   └── api.ts                    — typed fetch client
├── cli/sync.ts         — `npm run sync`
├── docs/demo.mp4       — demo video
└── data/               — SQLite (gitignored)
```

## SSE event types

| Event              | Payload                          | Triggered by              |
|--------------------|----------------------------------|---------------------------|
| `hello`            | `{ ts }`                         | connection                |
| `sync:start`       | `{ days }`                       | POST `/api/sync` start    |
| `sync:phase`       | `{ phase, label, progress }`     | each sync phase           |
| `sync:done`        | `{ campaigns, adGroups, keywords }` | sync finish          |
| `sync:error`       | `{ error }`                      | sync failure              |
| `action:enqueued`  | `{ id }`                         | POST `/api/actions`       |
| `action:applied`   | `{ id }`                         | apply success             |
| `action:failed`    | `{ id, error }`                  | apply error               |
| `action:cancelled` | `{ id }`                         | cancel                    |
| `alert:new`        | `{ type, message, delivered }`   | alert check fired         |

## ROI engine — what it actually computes

For any campaign or keyword, at any proposed spend:

```
install_to_trial_rate ← estimated from ASC events / ASA installs (with organic-contamination cap)
trial_to_paid_rate    ← from settings (default 0.30; auto-suggested from real ASC events)
ltv                   ← from settings (default $30; needs Adapty / SUBSCRIBER report for accuracy)

projected_installs = proposed_spend / cpi
projected_trials   = projected_installs × install_to_trial_rate
projected_paid     = projected_trials × trial_to_paid_rate
projected_revenue  = projected_paid × ltv
projected_roi      = (projected_revenue − proposed_spend) / proposed_spend
```

The verdict (`SCALE` / `HOLD` / `CUT` / `WAIT`) is based on `projected_roi` band:
- `≥ 100%` → SCALE (profitable, scale up)
- `≥ 20%` → HOLD (marginal)
- `≥ −30%` → MONITOR (break-even zone)
- `< −30%` → CUT
- Anytime confidence is `insufficient` → WAIT with a specific "next step" hint

## Bid recommendation heuristic

```
if imp == 0 for 7 days        → +50% (capped at +$0.30), confidence: low
elif imp > 0, install == 0, spend > $2 → −20%, confidence: medium
elif install > 0, cpi <= 0.7 × target  → +20% (scale up), confidence: high
elif install > 0, cpi > 1.5 × target   → −15%, confidence: high
elif imp > 50, install == 0   → −10%, confidence: low
else keep
```

## Limitations / wishlist

- No Apple `popularityScore` integration — Apple doesn't expose it via API. Pair with [`aso-keywords`](../aso-keywords) for T/D scores from iTunes Search API.
- Mutations target only `MANUAL_CPT` campaigns. `MAX_CONVERSIONS` (CPA bidding) is not handled.
- No multi-org support; assumes one `ASA_ORG_ID` per install.
- SKAN postbacks not yet visualized — once you have `conversionsCV` in ASA reports, swap CPI for CPA in the dashboard.
- LTV is a manual estimate. Real LTV needs Adapty/RevenueCat or syncing the ASC SUBSCRIBER report (not yet done).
- Auto-pilot mode (auto-pause losers, auto-scale winners) intentionally not built — too risky without SKAN.

## Why this exists

We were spending hours every week sliding spreadsheets between Apple Search Ads reports and App Store Connect to figure out which keywords actually drove paying trials. SearchAds.com and SplitMetrics solve this but charge $999+/month. Our spend isn't that high — but the question is the same.

So we wrote our own. Open source so the next small ASA spender doesn't have to.

## License

MIT — see [LICENSE](LICENSE).
