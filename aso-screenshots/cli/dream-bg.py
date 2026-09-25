#!/usr/bin/env python3
# Usage: python3 cli/dream-bg.py  → public/uploads/dream/decor/bg-{iphone,ipad}.png
# Procedural night-sky backgrounds for Luna Dream screenshots (no AI).
import math, random, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.expanduser('~/Developer/MYPROJECT/aso-studio/aso-screenshots/public/uploads/dream/decor')

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
def hexc(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

STOPS = [(0.0, hexc('#090B1E')), (0.35, hexc('#12142B')), (0.75, hexc('#1A1840')), (1.0, hexc('#241E52'))]

def gradient(W, H):
    col = Image.new('RGB', (1, H))
    for y in range(H):
        t = y / (H - 1)
        for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
            if t0 <= t <= t1:
                col.putpixel((0, y), lerp(c0, c1, (t - t0) / (t1 - t0))); break
    return col.resize((W, H)).convert('RGBA')

def glow(W, H, cx, cy, r, color, alpha):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.55))

def make(name, W, H, seed):
    rnd = random.Random(seed)
    img = gradient(W, H)
    # Lavender haze behind the device and a faint aurora band near the bottom.
    img = Image.alpha_composite(img, glow(W, H, W * 0.5, H * 0.62, W * 0.55, hexc('#6B5BD6'), 70))
    img = Image.alpha_composite(img, glow(W, H, W * 0.15, H * 0.95, W * 0.45, hexc('#3B2F8F'), 90))
    img = Image.alpha_composite(img, glow(W, H, W * 0.9, H * 0.85, W * 0.35, hexc('#4B3AA8'), 60))
    # Stars: many tiny, a few bright with soft halo; denser at the top.
    stars = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(stars)
    n = int(W * H / 5200)
    for _ in range(n):
        x = rnd.uniform(0, W); y = H * (rnd.random() ** 1.6)
        r = rnd.choice([1.2, 1.5, 1.8, 2.2, 2.8]) * W / 1320
        a = int(rnd.uniform(60, 200) * (1 - 0.6 * y / H))
        c = rnd.choice([(255, 255, 255), (220, 210, 255), (255, 236, 200)])
        d.ellipse([x - r, y - r, x + r, y + r], fill=c + (a,))
    halo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for _ in range(int(n / 45)):
        x = rnd.uniform(0, W); y = H * (rnd.random() ** 1.3) * 0.9
        r = rnd.uniform(3, 5) * W / 1320
        hd.ellipse([x - r * 4, y - r * 4, x + r * 4, y + r * 4], fill=(200, 190, 255, 70))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 235))
        # four-point sparkle
        L = r * 6
        d.line([x - L, y, x + L, y], fill=(255, 255, 255, 120), width=max(1, int(r / 2.5)))
        d.line([x, y - L, x, y + L], fill=(255, 255, 255, 120), width=max(1, int(r / 2.5)))
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(6 * W / 1320)))
    img = Image.alpha_composite(img, stars)
    # Crescent moon, top-right corner, soft gold glow.
    mr = W * (0.048 if W < 1500 else 0.034); mx = W * (0.9 if W < 1500 else 0.935); my = W * (0.075 if W < 1500 else 0.05)
    img = Image.alpha_composite(img, glow(W, H, mx, my, mr * 2.4, hexc('#FFF1CF'), 30))
    moon = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    md = ImageDraw.Draw(moon)
    md.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=hexc('#F2DDB0') + (245,))
    cut = Image.new('L', (W, H), 0)
    ImageDraw.Draw(cut).ellipse([mx - mr * 0.62, my - mr * 1.2, mx + mr * 1.35, my + mr * 0.75], fill=255)
    moon.putalpha(Image.eval(Image.composite(Image.new('L', (W, H), 0), moon.getchannel('A'), cut), lambda v: v))
    img = Image.alpha_composite(img, moon.filter(ImageFilter.GaussianBlur(1.2)))
    img.convert('RGB').save(os.path.join(OUT, name), optimize=True)

make('bg-iphone.png', 1320, 2868, 7)
make('bg-ipad.png', 2064, 2752, 11)
print('done')
