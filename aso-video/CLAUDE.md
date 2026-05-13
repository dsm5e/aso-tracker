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

## What's NOT exposed to Claude (yet)

- Direct uploads to `output/uploads/` — must be done via filesystem copy or the
  `POST /api/upload` route (multipart). No autonomous "generate-and-upload" yet.
- Influencer character management (`server/routes/influencers.ts`) — has a
  separate API surface; document there if relevant.
- TikTok Marketing API client (`server/tiktok.ts`) — gated behind external
  TikTok app approval; not callable until creds are configured.
