# ASO Tracker

> Self-hosted open-source App Store keyword-rank tracker for indie iOS developers.

Stop paying $500/mo to Sensor Tower or AppTweak. Track your App Store keyword positions across every locale, on your own machine, for free.

## Features

- 🔍 **Per-keyword, per-locale position tracking** across 50+ countries
- 📊 **Dashboard** with week-over-week deltas, sparklines, biggest winners/losers
- 🗂️ **Per-app drill-down**: sortable Rankings table, pagination (50/100/200/all), locale picker, 30-day trend
- 👥 **Competitor intelligence**: click any competitor in the top-5 to see every keyword they rank for (cross-referenced against your snapshots), add them to tracking in one click
- 🔎 **App Store search**: find & track any iOS app by name, bundle id, or iTunes ID
- ✏️ **Keywords editor**: add/remove per-locale, bulk-paste, save to disk
- ⚡ **Snapshot engine** with Run / Stop / Resume controls, 3 speed presets (Fast / Medium / Slow·SAFE), live progress feed, resumable after rate-limit
- 📈 Historical snapshots stored locally in SQLite
- 🚀 Self-hosted — no SaaS, no account, no data leak
- 🤖 Uses the public iTunes Search API — no scraping, no TOS issues

## Quickstart

```bash
git clone https://github.com/your-name/aso-tracker.git
cd aso-tracker
npm install
npm run dev
# open http://localhost:5173
```

First-time setup:
1. On the empty dashboard, click **+ Add your first app** (or use top-bar search)
2. Enter the iTunes App ID from your App Store URL
   (e.g. for `https://apps.apple.com/app/id1234567890` → paste `1234567890`)
3. Click **Test connection** — confirms the app metadata
4. Customize emoji / name / bundle if needed, hit **Add app & start tracking**
5. Go to **Keywords** tab, pick a locale, add your keywords
6. Click **Run snapshot** — watch live progress, get rankings

## Your data stays yours

- `config/apps.json` — your tracked apps (gitignored)
- `config/keywords/*.json` — your keyword lists per app (gitignored; only `*.example.json` committed)
- `data/rankings.db` — local SQLite with snapshot history (gitignored)

Nothing leaves your machine. You bring your own keywords.

## Tech stack

- **Frontend**: React 19 + Vite + TypeScript
- **Backend**: Express + better-sqlite3
- **Data source**: public iTunes Search API (no keys needed)
- **Rate limit**: conservative 2 workers × 500ms sleep → ~240 req/min (Apple's limit is ~500). Auto-abort + Resume on persistent 502.

## CLI (headless snapshots)

```bash
npm run snapshot -- --app=dream                 # all locales for one app
npm run snapshot -- --app=dream --locales=us,tr,de
npm run snapshot                                 # every app, every locale
```

Streams line-by-line progress. Suitable for cron, CI, or Claude Code automation.

### Import existing jsonl snapshots

```bash
npm run migrate-jsonl -- /path/to/aso-rankings.jsonl
```

Loads external rank logs into the local SQLite (deduplicated by latest-per-keyword).

## Keyword methodology

Track **search phrases** (2-4 words) — what real users type into App Store search. Not single words from the Keywords field in ASC.

Localize by **intent**, not literal translation. Example: Turkish users search `rüya tabiri` ("dream interpretation") — not `rüya günlüğü` ("dream journal").

## License

MIT — see [LICENSE](LICENSE).

---

Built in public as part of the [Nomly](https://nomly.space) portfolio.
