"""Build the MedScan ASA redesign op list (2026-09-18) from the live snapshot. Pure planning, no API calls."""
import json, re, sys
D = "data/medscan-redesign-2026-09-18"
snap = {c["id"]: c for c in json.load(open(f"{D}/before.json"))}

G1 = ["US", "CA", "AU"]; GB = ["GB"]
G2 = "AT BE CH DK FI IE IS LU NL NO NZ SE DE FR IT CZ JP KR SG HK TW IL PL RO".split()
G3 = "BR MX ES PT AR CL CO PE EC BO PY CR DO GT HN PA SV".split()
UNIVERSE = sorted(set().union(*[set(c["countries"]) for c in snap.values()]))
G4 = [c for c in UNIVERSE if c not in set(G1 + GB + G2 + G3)]

# campaign id -> (role, group, countries, daily budget)
KEEP = {
    2144610478: ("BRAND", None, None, "2"),
    2144610368: ("CORE", "G1", G1, "3"),
    2144610165: ("CORE", "GB", GB, "3"),
    2144610521: ("COMP", "G1", G1 + GB, "2"),
    2144609675: ("CORE", "G2", G2, "3"),
    2144612167: ("COMP", "G2", G2, "1.5"),
    2144611030: ("DISC", "G2", G2, "1.5"),
    2144611119: ("CORE", "G3", G3, "5"),
    2144611024: ("COMP", "G3", G3, "1.5"),
    2144612483: ("DISC", "G3", G3, "1"),
    2144468905: ("CORE", "G4", G4, "10"),
    2144610526: ("COMP", "G4", G4, "1.5"),
    2144611219: ("DISC", "G4", G4, "1.5"),
}
BID = {  # cluster -> group -> max CPT
    "CORE": {"G1": .45, "GB": .60, "G2": .35, "G3": .30, "G4": .25},
    "SPEC": {"G1": .27, "GB": .36, "G2": .21, "G3": .18, "G4": .15},
    "DENTAL": {"G1": .40, "GB": .40, "G2": .30, "G3": .25, "G4": .15},
    "OTHERCOMP": {"G1": .25, "GB": .25, "G2": .15, "G3": .12, "G4": .10},
    "DISC": {"G2": .15, "G3": .12, "G4": .10},
}
DENTAL = set("romexis mromexis ondemand3d sidexis carestream planmeca dexis irys viewer diagnocat falcon mx slicora voxelis".split("\n")[0].split()) | {
    "dental ct view", "irys viewer", "falcon mx", "codiagnostix", "dtx studio", "smop", "implant studio", "nobelclinician",
    "simplant", "realguide", "i-dixel", "newtom", "myray", "cliniview", "ez3d-i", "3shape", "blue sky plan", "blueskyplan"}
NEW_COMP = ["codiagnostix", "dtx studio", "smop", "implant studio", "nobelclinician", "simplant", "realguide", "i-dixel",
            "newtom", "myray", "cliniview", "ez3d-i", "3shape", "blue sky plan", "blueskyplan", "osirix md", "horos viewer", "osirix viewer"]
DENTAL_OK = re.compile(r"dental|panoram|cephalo|orthodont|opg|tooth|root canal|endodont|jaw|歯科|牙科|cbct")
JUNK = re.compile(r"x-?\s?ray|xray|x光|엑스레이|レントゲン|röntgen|rontgen|røntgen|rentgen|\brtg\b|raio x|rayos x|radiograf|radiolog|radiograph|"
                  r"medical imag|medical image|imagerie|immagini mediche|imej perubatan|hình ảnh y khoa|ภาพทางการแพทย์|医用画像|醫學影像|의료영상|"
                  r"\bidv\b|imaios|exocad|bee dicom|kostenlos|\bfree\b|gratuit|ct scan|^tac$|^irm|^dcm|my scan results|read my|x quang|เอกซเรย์|"
                  r"resonancia|risonanza|ressonância|核磁共振|電腦斷層|^mrt|teleradiolog|second opinion|ultrasound|scanner médical|medical scan|medical cd|"
                  r"^radiant$|^radiant dicom viewer$")
NEG_BROAD = ["x ray", "xray", "x-ray", "raio x", "rayos x", "röntgen", "rontgen", "rentgen", "radiografia", "radiographie", "radiology",
             "radiologia", "radiologie", "camera", "prank", "body scanner", "simulator", "cam scanner", "camscanner", "doc scanner",
             "anatomy", "skeleton", "team viewer", "vnc viewer", "medical park", "osde", "hospiten", "doctoralia", "mychart", "metro",
             "intercom", "exocad", "idv", "imaios", "kostenlos"]

def junk(t):
    t = t.lower().strip()
    return bool(JUNK.search(t)) and not DENTAL_OK.search(t)

def cluster(role, t, match):
    t = t.lower().strip()
    if t == "medscan": return "BRAND"
    if role == "COMP": return "DENTAL" if t in DENTAL else "OTHERCOMP"
    if role == "DISC": return "DISC"
    return "CORE" if "dicom" in t or "다이콤" in t else "SPEC"

def neg_blocks(neg, kw):  # BROAD negative blocks a query containing all its words
    return all(w in kw.lower().split() or w in kw.lower() for w in neg.split())

ops, report = [], {"pause_kw": [], "bid": [], "add_kw": [], "neg_add": {}, "neg_drop_conflict": {}, "neg_remove": []}
# 1. pause every enabled campaign that is not kept
for cid, c in snap.items():
    if cid not in KEEP:
        ops.append({"op": "campaign", "id": cid, "body": {"campaign": {"status": "PAUSED"}}, "note": f"pause {c['name']}"})
# 2. kept campaigns: countries + budget
for cid, (role, grp, countries, budget) in KEEP.items():
    body = {"dailyBudgetAmount": {"amount": budget, "currency": "USD"}}
    if countries is not None: body["countriesOrRegions"] = countries
    ops.append({"op": "campaign", "id": cid, "body": {"campaign": body}, "note": f"{snap[cid]['name']} -> {grp} {len(countries or [])}c ${budget}"})

COMP_NAMES = {k["text"].lower().strip() for g in snap[2144610521]["adGroups"] for k in g["keywords"]} | DENTAL | set(NEW_COMP)
# harvest local/core keywords from campaigns being paused, to carry into G2/G3 CORE
def harvest(cids):
    out = {}
    for cid in cids:
        for g in snap[cid]["adGroups"]:
            if g["status"] != "ENABLED": continue
            for k in g["keywords"]:
                if k["status"] == "ACTIVE" and k["matchType"] == "EXACT" and not junk(k["text"]) and k["text"].lower().strip() not in COMP_NAMES:
                    out[k["text"].lower().strip()] = 1
    return out
CARRY = {
    2144609675: harvest([2144609720, 2144624497, 2144623080, 2144611064, 2144612352, 2144610626, 2144611731, 2144612440, 2144611224, 2144612121]),
    2144611119: harvest([2144612435, 2144611822, 2144611124, 2144610131]) | {"leitor dicom": 1, "visualizador de dicom": 1, "visor dicom": 1, "lector dicom": 1, "dicom": 1, "dicom viewer": 1},
}

active_kw = {}
for cid, (role, grp, _, _) in KEEP.items():
    live = []
    for g in snap[cid]["adGroups"]:
        if g["status"] != "ENABLED": continue
        upd, keep_ids = [], []
        existing = {k["text"].lower().strip() for k in g["keywords"] if k["status"] == "ACTIVE"}
        for k in g["keywords"]:
            if k["status"] != "ACTIVE": continue
            t = k["text"].lower().strip(); cur = float(k["bidAmount"]["amount"])
            if junk(t) or (grp == "G4" and role == "DISC" and t == "dicom"):
                upd.append({"id": k["id"], "status": "PAUSED"}); report["pause_kw"].append((snap[cid]["name"], t, k["matchType"], cur)); continue
            cl = cluster(role, t, k["matchType"])
            nb = 0.30 if cl == "BRAND" else BID[cl][grp]
            live.append(t)
            if abs(nb - cur) > 1e-9:
                upd.append({"id": k["id"], "bidAmount": {"amount": f"{nb:.2f}", "currency": "USD"}}); report["bid"].append((snap[cid]["name"], t, k["matchType"], cur, nb))
        if upd: ops.append({"op": "kw_update", "campaign": cid, "adGroup": g["id"], "body": upd})
        # new keywords
        new = []
        if role == "COMP": new = [t for t in NEW_COMP if t not in existing]
        if cid in CARRY: new = [t for t in CARRY[cid] if t not in existing]
        if new:
            body = []
            for t in new:
                cl = cluster(role, t, "EXACT"); nb = BID[cl][grp]
                body.append({"text": t, "matchType": "EXACT", "status": "ACTIVE", "bidAmount": {"amount": f"{nb:.2f}", "currency": "USD"}})
                report["add_kw"].append((snap[cid]["name"], t, nb)); live.append(t)
            ops.append({"op": "kw_create", "campaign": cid, "adGroup": g["id"], "body": body})
        dflt = 0.30 if role == "BRAND" else min(BID["SPEC" if role == "CORE" else ("OTHERCOMP" if role == "COMP" else "DISC")][grp], 0.30)
        ops.append({"op": "adgroup", "campaign": cid, "adGroup": g["id"], "body": {"defaultBidAmount": {"amount": f"{dflt:.2f}", "currency": "USD"}}})
    active_kw[cid] = live

# negatives
for cid, (role, grp, _, _) in KEEP.items():
    if role == "BRAND": continue
    have = {(n["text"].lower(), n["matchType"]) for n in snap[cid]["negatives"]}
    add, drop = [], []
    for n in NEG_BROAD:
        if any(neg_blocks(n, k) for k in active_kw[cid]): drop.append(n); continue
        if (n, "BROAD") not in have: add.append({"text": n, "matchType": "BROAD"})
    if add: ops.append({"op": "neg_create", "campaign": cid, "body": add})
    report["neg_add"][snap[cid]["name"]] = len(add); report["neg_drop_conflict"][snap[cid]["name"]] = drop
# WW: its EXACT negatives dicom/pacs/cbct routed exact queries to M26 geo campaigns that are now paused
rm = [n["id"] for n in snap[2144468905]["negatives"] if n["text"].lower() in ("dicom", "pacs", "cbct") and n["matchType"] == "EXACT"]
ops.append({"op": "neg_delete", "campaign": 2144468905, "body": rm}); report["neg_remove"] = rm

json.dump(ops, open(f"{D}/ops.json", "w"), ensure_ascii=False, indent=1)
json.dump(report, open(f"{D}/report.json", "w"), ensure_ascii=False, indent=1)
from collections import Counter
print("groups:", {k: len(v) for k, v in {"G1": G1, "GB": GB, "G2": G2, "G3": G3, "G4": G4}.items()}, "G4:", " ".join(G4))
print("ops:", Counter(o["op"] for o in ops))
print("campaigns paused:", sum(1 for o in ops if o["op"] == "campaign" and o["body"]["campaign"].get("status") == "PAUSED"))
print("keywords paused:", len(report["pause_kw"]), "bid changes:", len(report["bid"]), "new keywords:", len(report["add_kw"]))
print("negatives added:", report["neg_add"]); print("negatives skipped (conflict):", {k: v for k, v in report["neg_drop_conflict"].items() if v})
print("budget total:", sum(float(v[3]) for v in KEEP.values()))
