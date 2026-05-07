# aso-video

Dream ad pipeline. Renders a 15-second 9:16 MP4 with placeholder gradient
scenes, TikTok-style TTS voiceover, and word-level karaoke captions driven by
fal.ai Whisper. Future phases swap gradients for fal.ai Kling clips and add a
proper editor UI.

## Run

From the monorepo root (`aso-studio/`):

```bash
npm install
```

Then from this folder:

```bash
npm run dev               # vite :5190 + express :5191
npm run remotion:studio   # optional — Remotion Studio for live composition editing
```

## Phase V1 — script → audio → captions → render

End-to-end pipeline orchestrated by `cli/generate-v1.ts`:

```bash
npm run generate-v1
# -> output/audio/dream-ad-v1.mp3       (TikTok TTS)
# -> output/captions/dream-ad-v1.json   (fal.ai Whisper word-level)
# -> output/dream-ad-v1.mp4             (Remotion render w/ audio + karaoke captions)
```

Re-run with `SKIP_TTS=1 SKIP_WHISPER=1 npm run generate-v1` to iterate on the
visual layer without burning new TTS/Whisper calls.

### TikTok TTS (unofficial)
- Endpoint used: `https://gesserit.co/api/tiktok-tts` — currently up.
- Fallback in code: `https://tiktok-tts.weilbyte.dev/api/generation` — DNS dead
  as of 2026-05.
- Voices: default is `en_female_emotional`. Limit ~290 chars per request — the
  client splits long text into sentences and concats with ffmpeg.
- These endpoints are unofficial proxies of TikTok's WebAPI — they break
  occasionally. Next step is ElevenLabs as a paid stable fallback.

### fal.ai Whisper
- Working model: **`fal-ai/whisper`** (with `chunk_level: "word"`,
  `version: "3"`).
- `fal-ai/wizper` is tried first but currently rejects requests; client falls
  through to `fal-ai/whisper`.
- API key resolved via `~/.aso-studio/keys.json` → `FAL_API_KEY` (or env var).

## Phase V0 — placeholder render

```bash
npm run render
# -> output/dream-ad-mvp.mp4
```

## Phases

| Phase | Scope |
| --- | --- |
| **V0** | Remotion scaffold, placeholder composition, render-to-mp4 works |
| **V1** (this) | TikTok TTS + fal.ai Whisper word-level captions wired into Remotion render |
| **V1.5** | fal.ai Kling video generation per scene; ElevenLabs as TTS fallback |
| **V2** | Editor UI (timeline, scene editor, prompt-driven scene generation) |
| **V3** | TikTok upload via Marketing API + scheduling |

## Structure

```
aso-video/
├── remotion/                  # compositions
│   ├── DreamAd.tsx            # 15s 9:16 ad — gradients + Audio + KaraokeCaptions
│   ├── KaraokeCaptions.tsx    # word-level karaoke driven by Whisper words[]
│   └── Root.tsx, Scene.tsx, Caption.tsx
├── src/                       # vite UI (Player + render trigger)
├── server/
│   ├── index.ts               # express on :5191
│   ├── lib/keys.ts            # ~/.aso-studio/keys.json + env resolver
│   └── routes/
│       ├── tiktok-tts.ts      # POST /api/voiceover/tiktok-tts
│       └── whisper.ts         # POST /api/whisper/transcribe
├── cli/
│   ├── render.ts              # placeholder render
│   └── generate-v1.ts         # TTS → Whisper → render orchestrator
├── public/audio/              # static audio used by Remotion staticFile()
└── output/                    # generated audio, captions JSON, mp4
```
