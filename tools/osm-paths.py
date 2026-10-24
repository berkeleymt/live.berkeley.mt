#!/usr/bin/env python3
"""Refresh static/osm-paths.json: OpenStreetMap walkways around the campus drawing.

Outdoor routing uses these instead of (or in addition to) an `Outdoor Paths` layer in
static/images/campus.svg. The area is what the map shows when zoomed all the way out
(MIN_ZOOM in static/wayfinding.js on a VIEW-sized screen) around the centre of the drawing,
so a visitor anywhere on the visible map gets walking directions. It's fetched in tiles
because the OSM API caps one call at 50k nodes.
Run from the repo root: python3 tools/osm-paths.py
Data (c) OpenStreetMap contributors, ODbL; the map shows the attribution.
"""
import json, math, os, re, sys, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALK = {"footway", "path", "pedestrian", "steps", "cycleway", "corridor", "service", "living_street",
        "residential", "unclassified", "tertiary", "secondary"}
MIN_ZOOM, VIEW = 14, (900, 600)  # map minZoom and the biggest map box in px (desktop)
TILE = 1000  # metres, one API call each
R = 6378137.0

def georef():
    g = {}
    for m in re.finditer(r"^(origin_lon|origin_lat|meters_per_px)\s*=\s*([-\d.]+)", open(os.path.join(ROOT, "data/map.toml")).read(), re.M):
        g[m.group(1)] = float(m.group(2))
    vb = re.search(r'viewBox="([^"]+)"', open(os.path.join(ROOT, "static/images/campus.svg")).read()).group(1).split()
    return g, float(vb[2]), float(vb[3])

def lonlat(mx, my):
    return math.degrees(mx / R), math.degrees(2 * math.atan(math.exp(my / R)) - math.pi / 2)

def extent():
    """Mercator metres of the view at MIN_ZOOM centred on the drawing: (cx, cy, half_w, half_h)."""
    g, w, h = georef()
    ox = R * math.radians(g["origin_lon"]); oy = R * math.log(math.tan(math.pi / 4 + math.radians(g["origin_lat"]) / 2))
    mpp = g["meters_per_px"]
    cx, cy = ox + mpp * w / 2, oy - mpp * h / 2
    lat = lonlat(cx, cy)[1]
    tile_m = 2 * math.pi * R * math.cos(math.radians(lat)) / 2 ** MIN_ZOOM / 256  # ground metres per screen px
    return cx, cy, tile_m * VIEW[0] / 2, tile_m * VIEW[1] / 2

def bbox():
    cx, cy, hw, hh = extent()
    lo = lonlat(cx - hw, cy - hh); hi = lonlat(cx + hw, cy + hh)
    return lo[0], lo[1], hi[0], hi[1]

def tiles():
    cx, cy, hw, hh = extent()
    nx, ny = math.ceil(2 * hw / TILE), math.ceil(2 * hh / TILE)
    for i in range(nx):
        for j in range(ny):
            x0, y0 = cx - hw + i * 2 * hw / nx, cy - hh + j * 2 * hh / ny
            lo = lonlat(x0, y0); hi = lonlat(x0 + 2 * hw / nx, y0 + 2 * hh / ny)
            yield lo[0], lo[1], hi[0], hi[1]

def clip(pts, b):
    """Keep the run of points inside the box (plus one outside at each end so the way still reaches the edge)."""
    inside = [b[0] <= x <= b[2] and b[1] <= y <= b[3] for x, y in pts]
    if not any(inside):
        return []
    i, j = inside.index(True), len(inside) - 1 - inside[::-1].index(True)
    return pts[max(0, i - 1):j + 2]

def main():
    b = bbox()
    nodes, ways = {}, {}
    for t in tiles():
        url = "https://api.openstreetmap.org/api/0.6/map?bbox=%.6f,%.6f,%.6f,%.6f" % t
        req = urllib.request.Request(url, headers={"User-Agent": "live.berkeley.mt wayfinding (tools/osm-paths.py)"})
        root = ET.fromstring(urllib.request.urlopen(req, timeout=120).read())
        nodes.update((n.get("id"), (float(n.get("lon")), float(n.get("lat")))) for n in root.findall("node"))
        ways.update((w.get("id"), w) for w in root.findall("way"))
        print("tile %.4f,%.4f: %d ways so far" % (t[0], t[1], len(ways)), file=sys.stderr)
    feats = []
    for w in ways.values():
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
