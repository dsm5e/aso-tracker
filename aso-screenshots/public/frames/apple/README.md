# Apple product bezels

Official device frames used by the `apple` frame style
(`src/lib/deviceBezels.ts`, `src/components/studio/DeviceFrame.tsx`).

## Source

Apple Design Resources → Product Bezels
<https://developer.apple.com/design/resources/#product-bezels>, downloaded 2026-09-24:

| File here | Original (inside the DMG, `PNG/`) | DMG |
|---|---|---|
| `iphone-17-pro-max-silver-portrait.png` | `iPhone 17 Pro Max/iPhone 17 Pro Max - Silver - Portrait.png` | `Bezel-iPhone-17.dmg` |
| `iphone-17-pro-max-deep-blue-portrait.png` | `iPhone 17 Pro Max/iPhone 17 Pro Max - Deep Blue - Portrait.png` | `Bezel-iPhone-17.dmg` |
| `iphone-17-pro-max-cosmic-orange-portrait.png` | `iPhone 17 Pro Max/iPhone 17 Pro Max - Cosmic Orange - Portrait.png` | `Bezel-iPhone-17.dmg` |
| `ipad-pro-13-m5-silver-portrait.png` | `iPad Pro (M5) 13" - Silver - Portrait.png` | `Bezel-iPad-Pro-(M5).dmg` |
| `ipad-pro-13-m5-space-black-portrait.png` | `iPad Pro (M5) 13" - Space Black - Portrait.png` | `Bezel-iPad-Pro-(M5).dmg` |

The PNGs are byte-identical to Apple's files and only renamed. Scaling, the
screenshot underneath, the corner clip and the drop shadow are applied at
render time; the bezel image itself is never edited.

## Licence

`Apple Design Resources License.rtf` (Apple's licence shipped in both DMGs,
LYL142 06/21/2023) governs these files. In short:

- **Allowed:** creating mock-ups of the UI of software that runs on Apple
  platforms, "including the right to show the Apple Design Resources in
  screen shots, images or other depictions of such Mock-Ups" (§2A). App Store
  screenshots of our iOS/iPadOS apps inside these frames are that use.
- **Not allowed:** modifying the files or creating derivative works (§2D),
  redistributing them on their own or making them available for others to
  use (§2B, §3), and using them for apps on non-Apple platforms (§2B). So:
  keep this folder in the private repo, don't publish it as a download or a
  package, and never use these frames for Google Play or other Android
  screenshots.
- Apple's own marketing guidelines ask for the official, unaltered product
  imagery. Show the device as Apple ships it: don't recolour it, don't
  distort it, and don't put it next to a non-Apple device.

## Adding another device

1. Download the DMG from the page above (the links are public; the DMG asks
   you to accept the licence when mounted:
   `(echo; yes) | hdiutil attach -nobrowse -readonly -mountpoint ./mnt Bezel-….dmg`).
2. Copy the portrait PNG here under a kebab-case name.
3. Run `python3 cli/measure-bezel.py public/frames/apple/<file>.png`, then add
   an entry to `DEVICE_BEZELS` using the printed `image`, `body`, `screen`,
   `hasIsland` and a `screenClipRadius` from the middle of the valid range.
