#!/usr/bin/env python3
"""Pull room assignments from ContestDojo and write static/rooms.json.

Usage: CONTESTDOJO_API_TOKEN=... python3 scripts/sync_rooms.py
Reads data/rooms.toml for the event id. Publishes only sha256(ID) -> rooms.
"""
import hashlib, json, os, re, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.contestdojo.com"


def load_toml(path):
    """Read data/rooms.toml: tomllib on Python 3.11+, else a parser for its simple shape."""
    try:
        import tomllib
        with open(path, "rb") as f:
            return tomllib.load(f)
    except ModuleNotFoundError:
        cfg, cur = {"columns": []}, None
        for line in open(path):
            line = line.split("#", 1)[0].strip()
            if line == "[[columns]]":
                cur = {}
                cfg["columns"].append(cur)
            elif m := re.match(r'(\w+)\s*=\s*"(.*)"$', line):
                (cur if cur is not None else cfg)[m.group(1)] = m.group(2)
        return cfg


def get(path, token):
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {token}", "User-Agent": "live.berkeley.mt sync_rooms"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def norm_id(s):
    return "".join(str(s).split()).upper()


def digest(s):
    return hashlib.sha256(norm_id(s).encode()).hexdigest()[:16]


def clean_room(s):
    """'Dwinelle 155 (B)' -> 'Dwinelle 155'; collapse whitespace."""
    s = " ".join(str(s).split())
    while s.endswith(")") and "(" in s:
        s = s[: s.rfind("(")].rstrip()
    return s


def main():
    token = os.environ.get("CONTESTDOJO_API_TOKEN") or os.environ.get("CONTESTDOJO_API_KEY")
    if not token:
        sys.exit("CONTESTDOJO_API_TOKEN is not set")
    cfg = load_toml(os.path.join(ROOT, "data", "rooms.toml"))
    event = get(f"/events/{cfg['event_id']}", token)
    students = get(f"/events/{cfg['event_id']}/students/", token)
    teams = get(f"/events/{cfg['event_id']}/teams/", token)

    columns = [c["key"] for c in cfg.get("columns", [])]
    labels = {c["key"]: c.get("label", c["key"]) for c in cfg.get("columns", [])}
    for row in students + teams:
        for key in (row.get("roomAssignments") or {}):
            if key not in columns:
                columns.append(key)

    def rooms_of(row):
        ra = row.get("roomAssignments") or {}
        return [clean_room(ra[k]) if ra.get(k) else "" for k in columns]

    team_rooms = {t["id"]: rooms_of(t) for t in teams}
    out_students, out_teams = {}, {}
    for s in students:
        if not s.get("number"):
            continue
        rooms = rooms_of(s)
        fallback = team_rooms.get(s.get("team"), [])
        rooms = [r or (fallback[i] if i < len(fallback) else "") for i, r in enumerate(rooms)]
        if any(rooms):
            out_students[digest(s["number"])] = rooms
    for t in teams:
        if t.get("number") and any(team_rooms[t["id"]]):
            out_teams[digest(t["number"])] = team_rooms[t["id"]]

    data = {
        "event": event.get("name", ""),
        "synced": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "columns": [labels.get(k, k) for k in columns],
        "students": dict(sorted(out_students.items())),
        "teams": dict(sorted(out_teams.items())),
    }
    path = os.path.join(ROOT, "static", "rooms.json")
    old = None
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
    if old and {k: v for k, v in old.items() if k != "synced"} == {k: v for k, v in data.items() if k != "synced"}:
        print(f"rooms.json unchanged ({len(out_students)} students, {len(out_teams)} teams)")
        return
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote rooms.json: {event.get('name')}, columns={columns}, {len(out_students)} students, {len(out_teams)} teams, {len(students) - len(out_students)} students without a number or room")


if __name__ == "__main__":
    main()
