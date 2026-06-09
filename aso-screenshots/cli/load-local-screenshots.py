#!/usr/bin/env python3
"""Load locally-captured PNG screenshots into editor slots.

The browser-only way to add a screenshot is drag-and-drop, which creates an
ephemeral `blob:` URL (dies with the tab, and the export/hero server can't fetch
it). This gives an AGENT/CLI a file-based path instead:

  1. copies each PNG into `public/uploads/slotN.png` (served by Vite at
     http://localhost:5180/studio/uploads/slotN.png — also fetchable server-side),
  2. sets that slot's `sourceUrl` in ~/.aso-studio/state.json,
  3. pushes the state so the live browser updates over SSE (no reload).

Usage:
  python3 cli/load-local-screenshots.py <folder>
where <folder> contains numbered subfolders (2,3,4,…) — subfolder N → slot N.
A subfolder with multiple PNGs needs an explicit pick in MAP below.
"""
import json, shutil, os, sys, urllib.request

SS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.expanduser("~/.aso-studio/state.json")
BASE_URL = "http://localhost:5180/studio/uploads"
PUSH = "http://localhost:5181/api/studio-state/push"

def png_in(folder, explicit=None):
    if explicit:
        return os.path.join(folder, explicit)
    pngs = [f for f in os.listdir(folder) if f.lower().endswith(".png") and not f.startswith(".")]
    if len(pngs) != 1:
        raise SystemExit(f"{folder}: expected 1 png (or pass explicit), got {pngs}")
    return os.path.join(folder, pngs[0])

def main(src):
    up = os.path.join(SS_DIR, "public", "uploads")
    os.makedirs(up, exist_ok=True)
    state = json.load(open(STATE))
    shots = state["screenshots"]

    # subfolder name (= slot number) → explicit filename or None (auto single png)
    EXPLICIT = {}  # e.g. {"3": "dad-home.png"}

    for sub in sorted(os.listdir(src)):
        d = os.path.join(src, sub)
        if not os.path.isdir(d) or not sub.isdigit():
            continue
        slot = int(sub)
        idx = slot - 1                       # state.screenshots is 0-based by slot order
        if idx < 0 or idx >= len(shots):
            print(f"slot {slot}: no matching state slot — skipped"); continue
        srcfile = png_in(d, EXPLICIT.get(sub))
        dest = f"slot{slot}.png"
        shutil.copyfile(srcfile, os.path.join(up, dest))
        shots[idx]["sourceUrl"] = f"{BASE_URL}/{dest}"
        shots[idx]["enhancedUrl"] = None     # drop stale AI render
        print(f"slot{slot} ← {sub}/{os.path.basename(srcfile)}")

    json.dump(state, open(STATE, "w"))
    body = json.dumps(state).encode()
    req = urllib.request.Request(PUSH, data=body, headers={"Content-Type": "application/json"}, method="POST")
    print("push:", urllib.request.urlopen(req).read().decode()[:80])

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: load-local-screenshots.py <folder>")
    main(sys.argv[1])
