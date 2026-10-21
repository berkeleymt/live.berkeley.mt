#!/usr/bin/env python3
"""Tiny room-lookup API that runs next to nginx in the live.berkeley.mt image.

GET /api/rooms?id=302A  ->  {"id": "302A", "kind": "student", "columns": ["Testing Room"], "rooms": ["Wheeler 222"]}

Looks the ID up live on ContestDojo (students if it ends in a letter, otherwise
teams) and returns room names only — never names or emails. Answers are cached
for CACHE_SECONDS. The token is read from TOKEN_FILE (written into the data
volume by the deploy workflow); until it exists every request gets 503 and the
page falls back to the static rooms.json.
"""
import json, os, re, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = "https://api.contestdojo.com"
PORT = int(os.environ.get("ROOMS_PORT", "3002"))
TOKEN_FILE = os.environ.get("ROOMS_TOKEN_FILE", "/app/data/contestdojo.token")
CONFIG = os.environ.get("ROOMS_CONFIG", "/app/rooms.toml")
CACHE_SECONDS = 5

_cache, _lock = {}, threading.Lock()


def load_config():
    cfg = {"columns": []}
    cur = None
    for line in open(CONFIG):
        line = line.split("#", 1)[0].strip()
        if line == "[[columns]]":
            cur = {}
            cfg["columns"].append(cur)
        elif m := re.match(r'(\w+)\s*=\s*"(.*)"$', line):
            (cur if cur is not None else cfg)[m.group(1)] = m.group(2)
    return cfg


CFG = load_config()


def token():
    try:
        return open(TOKEN_FILE).read().strip() or None
    except OSError:
        return None


def clean_room(s):
    s = " ".join(str(s).split())
    while s.endswith(")") and "(" in s:
        s = s[: s.rfind("(")].rstrip()
    return s


def fetch(kind, number, tok):
    url = f"{API}/events/{CFG['event_id']}/{kind}/?number={urllib.parse.quote(number)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "User-Agent": "live.berkeley.mt rooms_api"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


def lookup(raw):
    number = "".join(raw.split()).upper()
    if not re.fullmatch(r"[A-Z0-9-]{1,12}", number):
        return 400, {"error": "bad_id"}
    with _lock:
        hit = _cache.get(number)
        if hit and hit[0] > time.time():
            return hit[1], hit[2]
    tok = token()
    if not tok:
        return 503, {"error": "not_configured"}
    kind = "students" if number[-1].isalpha() else "teams"
    candidates = [number]
    if re.fullmatch(r"\d{1,2}[A-Z]?", number):
        candidates.append(re.sub(r"^\d+", lambda m: m.group().zfill(3), number))
    try:
        rows = []
        for n in candidates:
            rows = fetch(kind, n, tok)
            if rows:
                number = n
                break
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
        return 502, {"error": "upstream", "detail": str(e)[:200]}
    if not rows:
        status, body = 404, {"error": "not_found", "id": number}
    else:
        ra = rows[0].get("roomAssignments") or {}
        keys = [c["key"] for c in CFG["columns"]] + [k for k in ra if k not in {c["key"] for c in CFG["columns"]}]
        labels = {c["key"]: c.get("label", c["key"]) for c in CFG["columns"]}
        status, body = 200, {
            "id": number,
            "kind": kind[:-1],
            "columns": [labels.get(k, k) for k in keys],
            "rooms": [clean_room(ra[k]) if ra.get(k) else "" for k in keys],
        }
    with _lock:
        _cache[number] = (time.time() + CACHE_SECONDS, status, body)
    return status, body


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path.rstrip("/") == "/api/rooms":
            qs = urllib.parse.parse_qs(url.query)
            status, body = lookup(qs.get("id", [""])[0])
        elif url.path.rstrip("/") == "/api/health":
            status, body = 200, {"ok": True, "configured": token() is not None}
        else:
            status, body = 404, {"error": "not_found"}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"rooms_api on 127.0.0.1:{PORT}, event {CFG.get('event_id')}, token {'present' if token() else 'missing'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
