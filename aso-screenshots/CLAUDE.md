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
