# ASO Screenshots Studio — Claude Context

Web tool for generating App Store screenshots with AI hero enhancement.

## Stack
- Vite + React 19 + TypeScript (frontend, port 5180)
- Express + better-sqlite3 (backend API, port 5181)
- Accessed via Keywords proxy: `localhost:5173/studio/*` and `localhost:5173/studio-api/*`
- Direct API: `localhost:5181`

## State — source of truth

All editor state lives in `~/.aso-studio/state.json`.

**Read state:**
```bash
curl -s http://localhost:5181/api/studio-state | python3 -m json.tool
# or directly:
cat ~/.aso-studio/state.json | python3 -m json.tool
```

**Push state to browser (broadcasts via SSE — no reload needed):**
```bash
curl -s -X POST http://localhost:5181/api/studio-state/push \
  -H 'Content-Type: application/json' \
  -d @~/.aso-studio/state.json
```

**Typical agent workflow:**
```python
import json, urllib.request

with open('/Users/qwar49/.aso-studio/state.json') as f:
    state = json.load(f)

# make changes to state...
state['appName'] = 'MyApp'
state['appColor'] = '#2C6944'

body = json.dumps(state).encode()
req = urllib.request.Request(
    'http://localhost:5181/api/studio-state/push',
    data=body, headers={'Content-Type': 'application/json'}, method='POST'
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode())  # {"ok":true,"broadcast":N}
```

## State schema (key fields)

```json
{
  "appName": "string",
  "appColor": "#hex",
  "appIconUrl": "url | null",
  "devices": "iphone | ipad | both",
  "selectedPresetId": "string",
  "screenshots": [
    {
      "id": "string",
      "filename": "1.png",
      "device": "iphone | ipad",   // ALWAYS set explicitly — undefined breaks on JSON round-trip
      "kind": "action | regular",  // action = hero slot, regular = feature slot
      "headline": { "verb": "", "descriptor": "", "subhead": "" },
      "sourceLayout": "device | full-bleed", // full-bleed = pre-designed preview used as final artwork; only headline is layered on top
      "sourceScale": 1.0,          // full-bleed only: transform of the finished preview
      "sourceOffsetX": 0,
      "sourceOffsetY": 0,
      "textColorOverride": "#hex | undefined",     // per-slot color overrides (fall back to preset)
      "titleColorOverride": "#hex | undefined",
      "subtitleColorOverride": "#hex | undefined",
      "font": "Inter",
      "titlePx": 220,              // line-height in canvas-px for headline text
      "textYFraction": 0.07,       // where headline starts (0=top, 1=bottom)
      "deviceX": 0,                // horizontal offset from center (canvas px)
      "deviceY": 0,                // vertical offset from center
      "deviceScale": 1.0,
      "tiltDeg": 0,
      "tiltY": 0,                  // 3D perspective tilt
      "breakout": true,
      "action": {                  // only for kind='action' (hero)
        "primary": "iPhone & iPad",
        "secondary": "All DICOM Formats",
        "showStars": false,
        "hideDevice": false,
        "themeHint": "describe background for AI hero generation",
        "ingredients": {           // toggles for hero extras
          "socialProof": false,
          "ctaArrow": false,
          "editorsChoice": false,
          "pressQuotes": false,
          "testimonial": false,
          "floatingFeatures": false,
          "handHolding": false,
          "multiDevice": false,
          "beforeAfter": false,
          "appIcon": false
        },
        "ingredientParams": {      // text values for each ingredient
          "pressQuotes": { "logos": "MedTech Review, Radiology Today, Clinical Imaging Weekly" },
          "editorsChoice": { "label": "Best DICOM Viewer" },
          "ctaArrow": { "text": "" },       // empty = AI chooses from context
          "testimonial": { "quote": "", "author": "" },
          "socialProof": { "line1": "", "line2": "", "position": "top" }
        },
        "aiImageUrl": "url | null",
        "generateState": "idle | generating | done | error"
      }
    }
  ]
}
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/studio-state` | Get full editor state |
| POST | `/api/studio-state/push` | Push state → broadcasts to all open browser tabs |
| POST | `/api/studio-state` | Sync state (no broadcast — for browser debounce) |
| GET | `/api/studio-state/stream` | SSE stream of state changes |
| POST | `/api/screenshots/generate-hero` | Trigger AI hero generation (fal.ai gpt-image-2) |
| POST | `/api/templates/save` | Save current preset to `src/lib/presets/imported/<id>.json` |
| POST | `/api/translate/batch` | GPT-4o-mini batch translate headlines |
| POST | `/api/export/save-png` | Save rendered PNG to disk |
| GET | `/api/health` | `{ ok: true, service: 'aso-studio', phase: 4 }` |

## Key files

```
src/
  lib/
    heroIngredients.ts   — ingredient toggle prompts (CTA, badge, press, quote, etc.)
    useEnhance.ts        — scaffold capture + fal.ai request, headlinePct calculation
    studio.ts (state/)   — Zustand store, addScreenshot, pickPreset
  components/studio/
    MockupCanvas.tsx     — canvas renderer, device frame, headline overlay
    Inspector.tsx        — right panel (sliders, toggles, ingredient fields)
server/
  routes/hero.ts         — buildHeroPrompt, buildPolishPrompt, fal.ai call
  index.ts               — Express setup, SSE bridge, state mirror
```

## Ingredient params — all empty = AI decides from context

All ingredient text fields default to `""`. When empty, the AI infers appropriate
content from the app UI visible in the scaffold (e.g. empty `ctaArrow.text` →
AI writes a 2-4 word CTA matching what's on screen).

## Common agent tasks

**Set app metadata:**
```python
state['appName'] = 'MedScan'
state['appColor'] = '#2C6944'
```

**Set headlines for all slots by filename:**
```python
HEADLINES = {
    '1.png': {'verb': 'DICOM VIEWER', 'descriptor': 'Always Organized', 'subhead': 'Patients · Scans · Files'},
    '2.png': {'verb': 'EVERY ANGLE',  'descriptor': 'Instantly',         'subhead': 'SAG · COR · AXI · MIP'},
}
for ss in state['screenshots']:
    if ss['filename'] in HEADLINES:
        ss['headline'] = HEADLINES[ss['filename']]
```

**Enable ingredient toggles + set params for hero:**
```python
for ss in state['screenshots']:
    if ss.get('filename') == '1.png' and ss.get('kind') == 'action':
        ss['action']['ingredients']['pressQuotes'] = True
        ss['action']['ingredients']['editorsChoice'] = True
        ss['action']['ingredientParams']['pressQuotes'] = {'logos': 'MedTech Review, Radiology Today, Clinical Imaging Weekly'}
        ss['action']['ingredientParams']['editorsChoice'] = {'label': 'Best DICOM Viewer'}
```

**Fix missing device field (always set explicitly):**
```python
for ss in state['screenshots']:
    if 'device' not in ss:
        ss['device'] = 'ipad' if ss['id'] in KNOWN_IPAD_IDS else 'iphone'
```

## Runs on

```bash
cd ~/Developer/MYPROJECT/aso-studio/aso-screenshots && npm run dev
# vite → :5180, api → :5181
# proxied via aso-keywords at localhost:5173/studio/* and /studio-api/*
```

## Data-driven kids/creative layouts (added for Live Aquarium)

Preset-level opt-ins (all off by default, `u` = 1% of canvas width in CSS values):
- `text.titleShadow` / `subtitleShadow` / `subtitleColor` / `subtitleWeight` /
  `subtitleUppercase` / `titleLineHeight` / `titleLetterSpacing` / `subtitleGapU` /
  `sidePaddingU` / `pill {bg, fg, shadow, weight, sizeFrac}`
- `text.fitLines: true` — every `\n` line is nowrap and shrinks to the column width.
- `layout.deviceAnchor: 'below-headline'` (+ `deviceGapU`, `headlineMaxFraction`) —
  device hangs under the MEASURED headline. Slot opt-out: `deviceAnchor: 'free'`.
- `background.parametric: 'lagoon'` + `background.lagoon {rays, bubbles, frontBubbleShare, sand}`.
- `device.bodyColor / rimColor / shadow / ipad {scale, offsetY}`.

Per-slot `decor[]` (kind `image` | `bubble` | `doodle`, `xFrac/yFrac/widthFrac/rotate/flipX`,
`layer: back|front|top`). Bubble text is localised via `locale.decorTranslations[slotId][i]`.

Project fields: `ipadModel` ('ipad-pro-12.9' 2048×2732 default | 'ipad-pro-13' 2064×2752),
`sourceLocale` (language of the source copy, default 'en'), `layoutVariants[]`
(`{id, title, slotIds}` — PPO treatments / slot orderings).

CLIs:
- `node cli/setup-liveaquarium.mjs` — rebuilds the Live Aquarium project (slots, decor, variants A–D).
- `node cli/translate-locales.mjs --locales <list|all|asc> [--asc-locales …]` — transcreates
  headlines/pills/bubbles via `/api/translate/batch` (OpenAI, falls back to the local Codex CLI).
- `node cli/render-export.mjs --variants A,B|all --locales ru --tree '{variant}/{device}' --pattern '{n}.{ext}'`
  — `{n}` is per-device position inside a variant; `--tree` placeholders: {app} {variant} {device} {images} {locale}.

## Device frames (`deviceFrameStyle`)

`clay` (CSS body, historical default) | `titanium` (generated iPhone PNG, Elara) |
`frameless` (rounded card) | `apple` — official Apple product bezels: iPhone 17 Pro Max
(`silver`, `deep-blue`, `cosmic-orange`) and iPad Pro 13" M5 (`silver`, `space-black`).
- Preset default: `device.frameStyle: 'apple'` + `device.bezelColor: { iphone, ipad }`.
  Slot overrides: `deviceFrameStyle`, `deviceBezelColor` (Inspector → «Стиль устройства»).
  Live Aquarium (`liveaquarium-lagoon`) uses `apple`, silver/silver.
- The bezel keeps the clay frame's OUTER width, so tuned layouts keep their footprint;
  the screen gets a bit smaller. `device.shadow` (box-shadow syntax) is converted to a
  `drop-shadow` over the whole device, plus a tight contact shadow.
- The PNG draws the rounded screen corners and the Dynamic Island (no CSS island is added).
  The screenshot underneath gets a 0.2% bleed and a corner clip between the aperture and
  the body curve. Assets, source and licence: `public/frames/apple/README.md`.
  Adding a device: `python3 cli/measure-bezel.py <png>` → entry in `src/lib/deviceBezels.ts`.

## Localized app screenshots per language (`localizedSources`)

Slots keep pointing at the ROOT capture `public/uploads/<dir>/<device>-0N-<name>.png`
(language = `rootLang`). Per-language copies live next to it:
`public/uploads/<dir>/<lang>/<device>-0N-<name>.png`. When a store locale renders
(Locales preview, `/studio/render`, `cli/render-export.mjs`, in-app export), the
locale maps to an app language and the first hit in `<lang> → fallback (en) → root`
is used; a language equal to `rootLang` uses the root directly. Explicit
`locale.sourceOverrides[slotId]` still wins. Logic: `src/lib/localizedSources.ts`
(called from `applyLocaleToSlot`).

Project field (the browser can't list folders, so `files` is a manifest):
```json
"localizedSources": {
  "dir": "liveaquarium", "rootLang": "ru",
  "files": { "en": ["iphone-01-aquarium.png", "…"], "de": ["…"] },
  "localeMap": { "…": "…" },   // optional overrides of the ASC-locale → lang map
  "fallback": ["en"],          // optional, default ['en']
  "defaultLang": "en"          // optional, lang for locales absent from the map
}
```
Default map: en-US/GB/AU/CA→en, de-DE→de, fr-FR/CA→fr, es-ES/MX→es, it, pt-BR/pt-PT→pt-BR,
nl-NL→nl, sv, da, no→nb, fi, ja, ko, zh-Hans, zh-Hant, pl, tr, ru; everything else → en.

Import (copies + rewrites the manifest, pushes live; writes state.json if the API is down):
```bash
node cli/import-sources.mjs --app liveaquarium --from ~/Developer/screenshots/LiveAquarium/source-l10n
#   expects <from>/<lang>/<iphone|ipad>/0N-<name>.png  →  uploads/liveaquarium/<lang>/<device>-0N-<name>.png
node cli/import-sources.mjs --app liveaquarium --scan    # rescan after manual adds/deletes
#   --langs en,de   --root-lang ru   --dry
```
Missing files for a language just fall back (the import prints what's missing).
`setup-liveaquarium.mjs` keeps `localizedSources` (it spreads the existing state).
