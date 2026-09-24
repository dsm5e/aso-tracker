#!/usr/bin/env python3
"""Measure an Apple product-bezel PNG for src/lib/deviceBezels.ts.

    python3 cli/measure-bezel.py public/frames/apple/iphone-17-pro-max-deep-blue-portrait.png

Prints the numbers a DeviceBezel entry needs:
  image            PNG size
  body             opaque silhouette bbox (side buttons included)
  screen           transparent aperture bbox — should equal the native
                   screenshot size (1320x2868, 2064x2752, ...)
  island           opaque blob inside the aperture (Dynamic Island), if any
  screenClipRadius valid range: the screenshot drawn under the bezel is clipped
                   with this radius; it must stay outside the aperture's corner
                   curve (no backdrop showing through) and inside the body's
                   outer curve (no square corner poking out of the device).
Needs numpy, scipy, Pillow.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def main(path: str) -> None:
    alpha = np.array(Image.open(path).convert('RGBA'))[..., 3]
    h, w = alpha.shape
    print(f'image  {{ w: {w}, h: {h} }}')

    ys, xs = np.nonzero(alpha > 8)
    bx, by = xs.min(), ys.min()
    print(f'body   {{ x: {bx}, y: {by}, w: {xs.max() - bx + 1}, h: {ys.max() - by + 1} }}')

    # Aperture = largest transparent region not touching the image border.
    lab, n = ndimage.label(alpha < 128)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    holes = [(i, (lab == i).sum()) for i in range(1, n + 1) if i not in border]
    if not holes:
        sys.exit('no screen aperture found')
    hole = lab == max(holes, key=lambda t: t[1])[0]
    ys, xs = np.nonzero(hole)
    sx, sy = xs.min(), ys.min()
    sw, sh = xs.max() - sx + 1, ys.max() - sy + 1
    print(f'screen {{ x: {sx}, y: {sy}, w: {sw}, h: {sh} }}  ratio {sw / sh:.5f}')

    inside = alpha[sy:sy + sh, sx:sx + sw] > 128
    lab2, n2 = ndimage.label(inside)
    for i in range(1, n2 + 1):
        yy, xx = np.nonzero(lab2 == i)
        if yy.min() > 0 and xx.min() > 0 and yy.max() < sh - 1 and xx.max() < sw - 1:
            print(f'island x {xx.min() + sx}..{xx.max() + sx}  y {yy.min() + sy}..{yy.max() + sy}  -> hasIsland: true')

    # Top-left corner profile, relative to the screen rect.
    rows = []
    for dy in range(0, min(400, sh)):
        row = alpha[sy + dy]
        opaque = np.nonzero(row > 128)[0]
        body_x = opaque.min() - sx
        clear = np.nonzero(row[opaque.min():] < 128)[0]
        aperture_x = clear.min() + opaque.min() - sx if len(clear) else None
        rows.append((dy, body_x, aperture_x))

    def circle(r: float, dy: int) -> float:
        return 0.0 if dy >= r else r - np.sqrt(max(r * r - (r - dy) ** 2, 0.0))

    valid = [
        r for r in range(0, 400)
        if all(a is None or a - circle(r, dy) >= 0 for dy, _, a in rows)
        and all(circle(r, dy) - b > 0 for dy, b, _ in rows)
    ]
    if valid:
        lo, hi = valid[0], valid[-1]
        print(f'screenClipRadius valid {lo}..{hi}  -> use ~{(lo + hi) // 2}')
    else:
        print('screenClipRadius: no circular radius fits — needs a custom clip path')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
