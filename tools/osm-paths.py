#!/usr/bin/env python3
"""Refresh static/osm-paths.json: OpenStreetMap walkways around the campus drawing.

Outdoor routing uses these instead of (or in addition to) an `Outdoor Paths` layer in
static/images/campus.svg. The area is the SVG canvas (data/map.toml georef) plus a margin.
Run from the repo root: python3 tools/osm-paths.py
Data (c) OpenStreetMap contributors, ODbL; the map shows the attribution.
"""
import json, math, os, re, sys, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALK = {"footway", "path", "pedestrian", "steps", "cycleway", "corridor", "service", "living_street",
        "residential", "unclassified", "tertiary", "secondary"}
MARGIN = 60  # metres around the drawing
R = 6378137.0

def georef():
    g = {}
    for m in re.finditer(r"^(origin_lon|origin_lat|meters_per_px)\s*=\s*([-\d.]+)", open(os.path.join(ROOT, "data/map.toml")).read(), re.M):
        g[m.group(1)] = float(m.group(2))
    vb = re.search(r'viewBox="([^"]+)"', open(os.path.join(ROOT, "static/images/campus.svg")).read()).group(1).split()
    return g, float(vb[2]), float(vb[3])

def bbox():
    g, w, h = georef()
    ox = R * math.radians(g["origin_lon"]); oy = R * math.log(math.tan(math.pi / 4 + math.radians(g["origin_lat"]) / 2))
    mpp = g["meters_per_px"]
    def lonlat(mx, my):
        return math.degrees(mx / R), math.degrees(2 * math.atan(math.exp(my / R)) - math.pi / 2)
    lo = lonlat(ox - MARGIN, oy - mpp * h - MARGIN); hi = lonlat(ox + mpp * w + MARGIN, oy + MARGIN)
    return lo[0], lo[1], hi[0], hi[1]

def clip(pts, b):
    """Keep the run of points inside the box (plus one outside at each end so the way still reaches the edge)."""
    inside = [b[0] <= x <= b[2] and b[1] <= y <= b[3] for x, y in pts]
    if not any(inside):
        return []
    i, j = inside.index(True), len(inside) - 1 - inside[::-1].index(True)
    return pts[max(0, i - 1):j + 2]

def main():
    b = bbox()
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=%.6f,%.6f,%.6f,%.6f" % b
    req = urllib.request.Request(url, headers={"User-Agent": "live.berkeley.mt wayfinding (tools/osm-paths.py)"})
    root = ET.fromstring(urllib.request.urlopen(req, timeout=120).read())
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.findall("node")}
    feats = []
    for w in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        hw = tags.get("highway")
        if hw not in WALK or tags.get("foot") == "no" or tags.get("access") in ("private", "no") or tags.get("indoor") == "yes" or tags.get("informal") == "yes":
            continue
        if tags.get("level") and tags.get("level") not in ("0", "0;1"):
            continue
        pts = [nodes[nd.get("ref")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        pts = clip(pts, b)
        if len(pts) < 2:
            continue
        props = {}
        if tags.get("name"): props["n"] = tags["name"]
        if hw == "steps": props["s"] = 1
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString", "coordinates": [[round(x, 6), round(y, 6)] for x, y in pts]}})
    out = {"type": "FeatureCollection", "bbox": [round(v, 6) for v in b], "features": feats}
    path = os.path.join(ROOT, "static/osm-paths.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("%d ways, %d KB -> %s" % (len(feats), os.path.getsize(path) // 1024, os.path.relpath(path, ROOT)))

if __name__ == "__main__":
    sys.exit(main())
