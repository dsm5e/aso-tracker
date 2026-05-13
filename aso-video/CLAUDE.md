# Claude integration guide — aso-video

This module is built as a Claude-drivable workflow editor. Claude can:
1. Create workflows by writing JSON files
2. Switch the active workflow in the user's browser
3. Edit nodes live — the canvas flashes yellow on the changed nodes
4. Trigger node runs (Flux / Kling / Captions / etc.)

Treat this file as the runbook before touching the codebase.

## Architecture in one paragraph

The editor is a Vite SPA on `:5190` backed by an Express API on `:5191`. The graph
state is server-authoritative (`server/lib/graphStore.ts`) and pushed to every
connected browser via SSE at `/api/graph/stream`. A file-system watcher monitors
the currently-loaded workflow's JSON (in `aso-video/workflows/` and
`~/.aso-studio/video/workflows/`) — when Claude edits the file, the watcher
hot-reloads it, fires an `external-reload` SSE hint, then broadcasts the fresh
graph. The browser diffs and animates the changes (yellow pulse on
added/changed nodes, ghost-fade on removed). Active workflow name persists
across server restarts in `~/.aso-studio/video/active-workflow`.

## Quick start — typical Claude flow

```bash
# 1. Make sure dev server is up
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5190
# If 000 — start it: `cd aso-video && npm run dev` (background)

# 2. Author a workflow JSON
# Write to: aso-studio/aso-video/workflows/<name>.json
# Schema: { version: 1, nodes: [...], edges: [...] }

# 3. Switch active workflow — browser updates live, no F5 needed
curl -s -X POST 'http://localhost:5191/api/graph/load-workflow?external=1' \
  -H 'Content-Type: application/json' \
  -d '{"name": "<workflow-name-without-json>"}'

# 4. Live-edit the JSON file — watcher hot-reloads, browser flashes yellow
# (edit nodes/edges in the same file you wrote in step 2)

# 5. Trigger a single node run
curl -s -X POST 'http://localhost:5191/api/graph/nodes/<node-id>/run'

# 6. Or run everything that isn't `done` yet (topological order)
curl -s -X POST 'http://localhost:5191/api/graph/run-all' \
  -H 'Content-Type: application/json' -d '{"force": false}'
```

## API surface — what Claude actually needs

All endpoints live on `http://localhost:5191`. The `?external=1` query (or
`X-Agent-Edit: 1` header) marks the call as Claude-driven; the browser then
animates the diff so the user can watch the change land.

### Workflows
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/graph/workflows` | List available workflows |
| `POST` | `/api/graph/load-workflow` | Load a workflow by name → updates user's browser |
| `POST` | `/api/graph/save-workflow` | Persist current graph to a named workflow file |
| `DELETE` | `/api/graph/workflows/:name` | Remove a workflow |
| `GET` | `/api/graph/workflows/active` | Get the active workflow name |

### Graph mutations
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/graph` | Read the current graph |
| `PUT` | `/api/graph` | Replace the whole graph |
| `POST` | `/api/graph/nodes` | Add a node `{type, position, data}` |
| `PATCH` | `/api/graph/nodes/:id` | Patch a node's `data` partial |
| `DELETE` | `/api/graph/nodes/:id` | Remove a node |
| `POST` | `/api/graph/edges` | Add an edge `{source, sourceHandle, target, targetHandle}` |
| `DELETE` | `/api/graph/edges/:id` | Remove an edge |

### Execution
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/graph/nodes/:id/run` | Trigger a single node — async, status persists on the node |
| `POST` | `/api/graph/run-all` | Run topologically; body `{force: bool}` to re-run done nodes |
| `POST` | `/api/graph/auto-layout` | Re-layout the canvas |

## Node types & their data shape

The exhaustive list lives in `server/routes/graph.ts:33` (`VALID_TYPES`). Common
ones:

| Type | Inputs (handles) | `data` keys | Run output |
|---|---|---|---|
| `reference-image` | — (upload) | `url`, `label` | passive (`url` is its output) |
| `reference-video` | — (upload) | `url`, `label` | passive |
| `flux-image` | optional `prompt` | `prompt`, `aspectRatio`, `model` (`gpt-image-2` or `flux-1.1-pro`), `quality` | `outputUrl`, `cost`, `status` |
| `tts-voice` | optional `prompt` | `text`, `voice` | `outputUrl` (mp3), `status` |
| `video-gen` | `image_url`, `image_url_2`, …, optional `prompt` | `model` (`kling`/`seedance`/`happy-horse`), `mode`, `resolution`, `prompt` OR `multiShot+shots[]`, `duration`, `audio` | `outputUrl`, `cost`, `elapsed`, `status` |
| `transcribe` | `video` | — | `outputUrl` (passthrough), `words[]`, `cost` |
| `captions` | `video` | `preset`, `fontSize`, `marginV` | `outputUrl`, `cost` |
| `image-overlay` | `video` (base), `image` (overlay) | `start`, `end`, `position`, `fadeMs`, `opacity` | `outputUrl` |
| `video-overlay` | `base`, `overlay` | `start`, `duration`, `keepBaseAudio`, `position`, `fadeMs` | `outputUrl` |
| `split-screen` | `top`, `bottom` | `ratio`, `audioSource` | `outputUrl` |
| `stitch` | `video_a`, `video_b` | — | `outputUrl` (concatenated) |
| `end-card` | `video` | `duration`, `cta`, `subtitle`, `brand` | `outputUrl` (with appended card) |
| `output` | `video` | `label` | passive — terminal marker |

### Run-order rules

- `runNode` refuses to execute when an upstream node has `status !== 'done'`.
  Reference uploads count as "done" once `url` is set.
- Costs are stamped on the node after a successful run — read them to budget.
- Status transitions: `idle → loading → done | error`.

### Multi-shot Kling

`video-gen` supports up to 4 shots per render at `data.multiShot=true`:

```json
{
  "model": "kling",
  "multiShot": true,
  "shotType": "customize",
  "shots": [
    { "prompt": "shot 1 text…", "duration": 3 },
    { "prompt": "shot 2 text…", "duration": 4 }
  ]
}
```

Sum of shot durations should match `data.duration`. Kling does hard cuts between
shots by default — describe transitions in the prompt itself if you want them.

## File-based editing — the live-edit loop

This is the safest pattern for non-trivial changes (multi-node edits, prompt
rewrites). Steps:

1. Verify the workflow is active: `cat ~/.aso-studio/video/active-workflow`
2. Edit `aso-video/workflows/<name>.json` directly (Edit / Write tool).
3. The watcher fires on every save (200ms debounce coalesces editor
   atomic-rename writes).
4. The server hot-reloads, broadcasts `external-reload` (with `{name, ts}`)
   followed by the fresh `graph` event.
5. Browser flashes yellow on changed/added nodes, ghost-fades removed ones.

> The watcher only follows the **currently-loaded** workflow. If you write a
> brand-new workflow file, call `POST /api/graph/load-workflow` first — only
> then will subsequent edits hot-reload.

## Cost / safety notes

- **Costs are real.** Kling v3 Pro audio-on @ 1080p = $0.168/sec. Flux gpt-image-2
  medium = $0.04/image. Re-runs charge again.
- The `run` endpoint does NOT prompt for confirmation. Treat it like a
  card-on-file payment trigger — only run when the user has explicitly approved
  the cost.
- Default to letting the user click Run in the UI. Use the API for
  orchestration only when the user says so.
- Reference uploads must be placed under `aso-video/output/uploads/` and
  referenced as `/output/uploads/<uuid>.png` in the node's `data.url`.

## Common patterns

### Pattern A — author + activate a fresh workflow

```bash
# 1. write file
Write aso-video/workflows/my-ad.json (with {version:1, nodes:[…], edges:[…]})

# 2. activate it
curl -X POST 'http://localhost:5191/api/graph/load-workflow?external=1' \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-ad"}'
```

### Pattern B — iterate on a prompt while the user watches

```bash
# Edit the same JSON file → watcher reloads → yellow flash on the changed node
Edit aso-video/workflows/my-ad.json (modify the prompt string)
```

### Pattern C — diff against the user's last saved version

```bash
# Save the current canvas back to disk before editing
curl -X POST http://localhost:5191/api/graph/save-workflow \
  -H 'Content-Type: application/json' -d '{"name": "my-ad"}'
# Then read the resulting file to see the latest state
```

## Where things live on disk

- Workflows: `aso-studio/aso-video/workflows/*.json` (curated, committed) +
  `~/.aso-studio/video/workflows/*.json` (user-private). User dir wins on
  collision.
- Uploads (refs): `aso-studio/aso-video/output/uploads/`
- Renders: `aso-studio/aso-video/output/{audio,captions,images,videos}/`
- Active workflow name: `~/.aso-studio/video/active-workflow` (one line)
- Persisted graph: `~/.aso-studio/video/graph.json` (snapshot for reboots)
- Influencer character library: `aso-studio/aso-video/influencer/*.{jpg,json}`

## Failure modes Claude should handle

| Symptom | Cause | Fix |
|---|---|---|
| `workflow not found: X` | Wrong name (extension included?) | Drop `.json`. Names are file basenames |
| `Upstream "Y" hasn't been run yet` | Tried to run a node before its upstreams completed | Run upstreams first via `run-all`, or wait |
| `image input required` | `video-gen` mode=image with no upstream image edge | Connect a `reference-image` or `flux-image` to `image_url` handle |
| Browser shows the wrong workflow | `active-workflow` file points elsewhere | `POST /api/graph/load-workflow` with the desired name |
| Yellow flash didn't trigger after Edit | File watcher debounce / not the active workflow | Verify `cat ~/.aso-studio/video/active-workflow` matches the file you edited |
| `iTunes 502` (unrelated, in the keywords app) | Rate limit | Out of scope here — see `aso-keywords/CLAUDE.md` if relevant |

## Kling v3 Pro — prompting playbook

The `video-gen` node with `model: 'kling'` is our workhorse. Kling is opinionated
about prompts; getting them wrong gives 422 errors or boring footage.

### Hard limits (verified 2026-05-13)

- **Duration enum:** `3..15` seconds (any integer). Kling rejects non-integer
  or out-of-range values with `Unprocessable Entity`.
- **Multi-prompt mode:** **512 chars max per shot prompt** — this is the most
  common failure mode. The error reads `"Prompt must not exceed 512
  characters."` in the 422 `detail[N].msg`. Single-shot prompts are allowed
  to be longer.
- **Multi-prompt shots:** up to 4 per render (Kling supports "storyboards of
  up to six shots" per their docs, but fal's wrapper caps at 4). Each shot is
  a hard cut by default.
- **Total duration:** sum of shot durations must stay ≤ 15s.
- **`shot_type`:** `customize` (follow durations literally) or `intelligent`
  (Kling decides cuts). We default to `customize`.

### Reference images: `image_url` + `image_url_2..N`

- `image_url` → `start_image_url` on the fal request — the visual anchor for
  the character/scene. **It is NOT counted as `@Element1`** in prompt refs.
- `image_url_2`, `image_url_3`, … → `elements[]` (KlingV3ComboElementInput).
  These start the `@Element1` numbering: `image_url_2 = @Element1`,
  `image_url_3 = @Element2`, etc. Reference them in prompts like *"the iPad
  screen displays the interface from @Element1"*.
- Failure mode: prompt says `@Element2` but only 1 element provided → fal
  returns `"Invalid reference index 2 for element. Only N elements provided."`
- Multi-prompt + elements ARE compatible.

### The 5-part prompt formula

Per fal's official guide and the Kling 2.1/3.0 prompt structure:

> **Subject** (with description) + **Action / movement** + **Scene** +
> **Camera language** + **Lighting / atmosphere**

In multi-shot mode, write each shot as a self-contained beat — don't assume
Kling carries context across shots. Repeat the subject's appearance every
shot if you want continuity.

### Camera vocabulary Kling understands well

- Shot framing: `medium selfie shot`, `tight close-up`, `wide selfie frame`,
  `profile shot`, `macro close-up`, `POV`, `over-the-shoulder`,
  `shot-reverse-shot`.
- Camera motion: `locked-off`, `handheld with natural hand-jitter`,
  `tracking shot`, `following`, `panning`, `dolly in/out`, `tilt up/down`,
  `pulls back`, `pushes in`. *Explicit motion verbs are the difference between
  contemplative drift and energetic clip.*
- Transitions between shots in multi-prompt: `HARD CUT to …`, `JUMP CUT`,
  `MATCH CUT` (rarely supported, prefer hard cuts).
- Hand-held authenticity: *"natural human hand-jitter, breathing motion,
  occasional slight tilt, never static or locked-off"* — produces real iPhone
  selfie feel.

### Dialogue: speak it like a director, not a copywriter

- ✅ *"She speaks with clear lip movement: 'POV: it's 11 PM …'"* — tells Kling
  to synchronise mouth shapes.
- ✅ Quote the dialogue inside the prompt — Kling generates voice that follows
  it (when `audio: true`).
- ✅ Add tone descriptors: *"intimate, lightly ironic"*, *"confident, satisfied"*.
- ❌ Don't list multiple speakers without temporal markers. Use `Immediately,`
  or `Pause` between exchanges if needed.
- ❌ Don't write entire dialogue blocks as one run-on sentence — break with
  punctuation, Kling syncs better.

### Common 422 failure modes

| Error message (from `detail[].msg`) | Cause | Fix |
|---|---|---|
| `Prompt must not exceed 512 characters.` | Per-shot prompt > 512 chars in multi-prompt | Compress to ~450-500 chars per shot; cut redundant atmospheric adjectives, deduplicate setting between shots |
| `duration must be between 3 and 15` | Top-level duration or shot duration out of range | Clamp 3-15. In multi-shot, sum of shots must also be ≤15 |
| `image_url is required` | mode=image without any connected `image_url` upstream | Connect a `reference-image` or `flux-image` to the `image_url` handle |
| `Value error, multi_prompt …` | Malformed shot object (missing prompt/duration) | Each shot needs `{prompt: string, duration: int}` |

### Working example — medscan-pov-night

Reference our shipped workflow `workflows/medscan-pov-night.json` for a
multi-shot Kling render with 2 reference images:
- Front selfie hook (handheld) → back-camera POV with `@Element2` MedScan UI
  on iPad screen → front selfie punchline (handheld).
- Each shot ≤ 510 chars.
- 13s total (3+3+7), audio-on, image-to-video with character + UI refs.

### Compression checklist (when you hit 512)

1. **Dedupe between shots** — describe scene fully in Shot 1, in Shot 2/3 just
   say "same sofa, same lighting" instead of re-listing every detail.
2. **Drop adjective stacking** — "soft warm ambient golden glow from a
   designer floor lamp" → "warm lamp glow".
3. **Cut redundant qualifiers** — "Vertical 9:16, iPhone front-camera
   aesthetic, natural skin texture with visible pores" → "9:16, skin pores".
4. **Trim lighting verbosity** — Kling infers a lot from one good keyword.
   "evening", "neon", "moonlit", "harsh fluorescent" carry their own load.
5. **Keep the dialogue verbatim** — it's load-bearing, don't trim VO.
6. **Combine camera + motion** — "Handheld iPhone selfie. Natural hand-shake,
   breathing motion, never locked-off." covers most of what you need.

### Negative prompts

Not exposed in our UI yet, but Kling supports them. Common ones to suppress
artifacts:
- `sliding feet, extra fingers, morphing hands, distorted face`
- `text, logos, watermark, captions, subtitles`
- `studio lighting, smooth gimbal, professional dolly` (when going for
  handheld selfie feel)

### Sources

- [fal.ai — Kling 3.0 Prompting Guide](https://blog.fal.ai/kling-3-0-prompting-guide/) — official
- [Kling 2.1 Master Prompt Guide — GeeLark](https://www.geelark.com/blog/kling-2-1-master-prompt-guide/) — 5-part formula
- [Kling 3.0 Prompts — VEED](https://www.veed.io/learn/kling-3-0-prompts) — practical motion examples
- [Atlas Cloud — 10 Advanced Kling 3.0 Prompts](https://www.atlascloud.ai/blog/guides/mastering-kling-3.0-10-advanced-ai-video-prompts-for-realistic-human-motion) — human motion realism
- [Kling Image-to-Video Guide — Vicsee](https://vicsee.com/blog/kling-3-prompts) — i2v specific

## What's NOT exposed to Claude (yet)

- Direct uploads to `output/uploads/` — must be done via filesystem copy or the
  `POST /api/upload` route (multipart). No autonomous "generate-and-upload" yet.
- Influencer character management (`server/routes/influencers.ts`) — has a
  separate API surface; document there if relevant.
- TikTok Marketing API client (`server/tiktok.ts`) — gated behind external
  TikTok app approval; not callable until creds are configured.
