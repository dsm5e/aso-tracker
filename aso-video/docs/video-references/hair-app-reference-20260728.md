# Hair App reference — 2026-07-28

Source: `ScreenRecording_07-28-2026 16-32-35_1.mov`

- 18.20 s, 480×1040, 30 fps, H.264 + AAC stereo.
- The source is a screen recording of a paid Instagram/Reels placement. The reusable creative is the video inside the social chrome; the Instagram UI is not part of the generated ad.

## Spoken copy

> Ugly? You just haven't found the right hairstyle for your face shape yet. With Hair App, simply scan your face to discover your face shape, then instantly try on hairstyles recommended just for you. In seconds, you'll find the hairstyle that suits you best.

Tiny Whisper boundaries (good enough for scene planning):

| Time | Copy / action |
|---:|---|
| 0.00–3.84 | Negative hook. Large face, several generated hairstyle changes, word-by-word captions. |
| 3.84–7.72 | Product explanation. Cut to `Find Your Faceshape`; cyan scanning beam and 3D face mesh. |
| 7.72–10.04 | Hairstyle recommendation result; generated model motion under cyan UI labels. |
| 10.04–12.24 | Benefit close; more fast hairstyle variants. |
| 12.24–16.20 | Rapid selector / thumbnail ribbon. Faces and hairstyles change roughly every 0.2–0.5 s. Add the ratcheting/spinning-drum SFX here. |
| 16.20–18.20 | Hair App end card with App Store and Google Play badges. |

## Rebuild rules

- Generate the model as a replaceable `Image Gen` source. Every AI-video scene derives identity from that source.
- Keep the model centered with a stable shoulder-up crop. Hairstyle variants may change, identity and framing should not.
- Use hard cuts for the hook and hairstyle changes. The face scan is the only deliberately “designed” transition.
- Build cyan UI, scan beam, face mesh, labels, refresh button, and bottom selector as editable layout layers. Do not ask the video model to render legible UI.
- Keep voiceover separate from generated video audio. SFX live on their own track and should remain replaceable.
- Recommended master: 1080×1920, 30 fps, 18.2 s.

