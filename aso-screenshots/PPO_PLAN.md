# PPO Mode — Architecture & Plan

> Created: 2026-05-07 · Spec for product-page-optimization feature in aso-screenshots studio.

## Goal

Add a dedicated "Product Page Optimization" workflow next to existing /editor flow. Users run multi-strategy A/B experiments where each strategy produces a full screen-pack from the same source screenshots, but with different AI prompts/branding per screen. Output is N independent treatment ZIPs ready for App Store Connect upload.

## User flow

1. From `/setup` user clicks new **PRODUCT PAGE OPT** button → `/ppo`.
2. `/ppo` page shows:
   - **Shared screen pool** at top — user uploads N screenshots via "+" / drag-drop. These are the SOURCE screens (raw simulator screens or pre-rendered scaffolds).
   - **Strategy list** below — initially empty. User clicks "Add Strategy" → adds a Strategy with title.
   - For each Strategy, the screen pool above is replicated into Strategy's row, with a per-screen-per-strategy prompt textarea.
3. User chats with assistant ("сделаем 4 PPO, давай обсудим стратегии"). Assistant fills strategies (titles + per-screen prompts) via state push.
4. User reviews UI. Each Strategy card has:
   - Title (editable)
   - Per-screen tile: thumbnail + prompt + Generate button + result preview
5. Click **Generate** per strategy OR global **Generate Everything**.
6. Generation runs in parallel via existing `generate-hero` endpoint (fal.ai gpt-image-2) — same retry/state pattern as `/polish`.
7. Per-strategy export → ZIP with N PNG screens at App Store dimensions.

## State model (Zustand `studio` slice extension)

```ts
interface PPOSourceScreen {
  id: string;           // uuid
  filename: string;     // 1.png
  uploadedAt: number;
  /** Local data URL or blob URL for preview. */
  previewUrl: string;
  /** Path on disk (~/Developer/screenshots/Dream/iphone/1.png) for hero gen input. */
  serverPath?: string;
}

interface PPOGeneration {
  generateState: 'idle' | 'generating' | 'done' | 'error';
  aiImageUrl?: string;
  lastPrompt?: string;
  errorMessage?: string;
  aiHistory?: string[];   // last 8 successful renders for re-pick
}

interface PPOStrategy {
  id: string;
  title: string;
  audience?: string;          // optional notes from discussion
  prompts: Record<string, string>;       // sourceScreenId → prompt
  generations: Record<string, PPOGeneration>;  // sourceScreenId → result
}

// In existing studio state:
interface StudioState {
  // ... existing fields ...
  ppo?: {
    sourceScreens: PPOSourceScreen[];
    strategies: PPOStrategy[];
    activeStrategyId?: string;
  };
}
```

## Server endpoints

Reuse existing `POST /api/screenshots/generate-hero` (server/routes/hero.ts) — already handles fal.ai gpt-image-2 calls, persistence, error handling. PPO calls feed it the source screen as input + per-strategy prompt.

Slight extension needed: hero.ts currently writes back to `state.json` based on slot id from main `screenshots[]`. For PPO we need a separate persistence path or pass a "ppo" flag + (strategyId, sourceScreenId) so persistSlotResult writes to ppo subtree.

Path: extend `persistSlotResult` to accept `{ kind: 'screenshot' | 'ppo'; ppoStrategyId?; ppoScreenId? }` and route accordingly.

## Generation flow

For batch (Generate All in strategy OR global):
- Build queue of (strategyId, screenId, prompt, inputImagePath) triples.
- Concurrency limit (e.g. 3 simultaneous calls — gpt-image-2 takes 20-30s each).
- Per-tile state: idle → generating → done/error.
- Retry button per tile + bulk retry-failed.

Reuse `polishBatch.ts` pattern but parameterize over PPO state subtree.

## File layout (new)

```
src/screens/PPO.tsx                       — main PPO route screen
src/components/ppo/
  ├── ScreenPoolUploader.tsx              — top "+ source screens" zone
  ├── StrategyCard.tsx                    — one strategy row
  ├── PPOTile.tsx                         — single (strategy × screen) cell
  └── PPOExport.tsx                       — per-strategy export bar
src/lib/ppoBatch.ts                       — generation queue/retries
src/state/ppo.ts                          — selectors + actions extending studio state
```

## Implementation phases

| Phase | Scope | Est |
|---|---|---|
| **1. Foundation** | Route `/ppo`, Setup button, basic page skeleton, state stub | 1.5h |
| **2. Source pool** | Upload + drag-drop + thumbnail grid + persistence | 1h |
| **3. Strategy CRUD** | Add/remove/rename strategies, prompt textarea per screen | 1.5h |
| **4. Generation** | `ppoBatch.ts` + per-tile state + retry UX | 2h |
| **5. Export** | Per-strategy ZIP with N rendered PNGs | 1h |
| **6. Polish** | Loading states, errors, keyboard shortcuts, export folder picker | 0.5h |

Total: ~7-8 hours. Phasing across 2-3 sessions reasonable.

## Out-of-scope for v1 (TODO list)

- Per-strategy DEVICE override (currently inherited from main state.devices)
- Side-by-side preview / compare mode
- Auto-suggest prompts via GPT chat in-app
- Localization per strategy
- Save/load strategy templates across projects

## TODO once implemented

1. Update `~/.aso-studio/state.json` shape — add `ppo` subtree
2. Update `aso-dashboard` skill to recognize `/ppo` mode (push state into ppo subtree)
3. Add Obsidian doc: how to use PPO mode for new experiments
