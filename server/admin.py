#!/usr/bin/env python3
"""Password-protected editor for config.toml and the files under content/, data/ and static/.

Runs next to nginx in the live.berkeley.mt image (see start.sh). Files are read
from and saved to GitHub (Contents API, branch BRANCH) so the repository stays
the only source of truth; every save is a commit, which triggers the normal
build-and-deploy. For instant feedback the pod also applies the saved file to
its own copy of the site (SITE_DIR) and rebuilds the live pages with zola.
Preview builds the edited file in a scratch copy and serves the result.

Secrets are files the deploy job writes into the data volume:
  ADMIN_PASSWORD_FILE  shared staff password
  GITHUB_APP_ID_FILE   ID of the GitHub App installed on REPO (Contents read/write)
  GITHUB_APP_KEY_FILE  that App's private key (.pem); signed with the openssl CLI
"""
import base64, calendar, hashlib, hmac, json, os, re, secrets, shutil, subprocess, tempfile, threading, time, urllib.error, urllib.parse, urllib.request
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ADMIN_PORT", "3003"))
REPO = os.environ.get("ADMIN_REPO", "berkeleymt/live.berkeley.mt")
BRANCH = os.environ.get("ADMIN_BRANCH", "main")
SITE_DIR = os.environ.get("ADMIN_SITE_DIR", "/site")
LIVE_DIR = os.environ.get("ADMIN_LIVE_DIR", "/usr/share/nginx/html")
PASSWORD_FILE = os.environ.get("ADMIN_PASSWORD_FILE", "/app/data/admin.password")
APP_ID_FILE = os.environ.get("GITHUB_APP_ID_FILE", "/app/data/github-app.id")
APP_KEY_FILE = os.environ.get("GITHUB_APP_KEY_FILE", "/app/data/github-app.pem")
BASE_URL = os.environ.get("ADMIN_BASE_URL", "https://live.berkeley.mt")
HERE = os.path.dirname(os.path.abspath(__file__))

EDITABLE = re.compile(r"^(?:config\.toml|(?:content|data|static)/(?:[A-Za-z0-9_][A-Za-z0-9._-]*/)*[A-Za-z0-9_][A-Za-z0-9._ -]*)$")
TEXT_EXT = {".md", ".toml", ".txt", ".css", ".js", ".json", ".html", ".xml", ".csv", ".yaml", ".yml"}
SESSION_HOURS = 24


def session_secret():
    """Random key kept next to the secrets so logins survive redeploys."""
    path = os.path.join(os.path.dirname(PASSWORD_FILE), "admin.session-key")
    try:
        key = open(path, "rb").read()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_bytes(32)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)
    except OSError:
        pass
    return key


SESSION_SECRET = session_secret()
_previews, _build_lock = {}, threading.Lock()


def read_secret(path):
    try:
        return open(path).read().strip() or None
    except OSError:
        return None


def editable(path):
    return bool(EDITABLE.match(path)) and ".." not in path


def configured():
    return bool(read_secret(PASSWORD_FILE) and read_secret(APP_ID_FILE) and read_secret(APP_KEY_FILE))


# ---------------------------------------------------------------- GitHub
_app_token, _app_lock = {"token": None, "expires": 0}, threading.Lock()


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt():
    """Short-lived JWT proving we are the App, RS256-signed with its private key."""
    now = int(time.time())
    head = b64url(b'{"alg":"RS256","typ":"JWT"}')
    claims = b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": read_secret(APP_ID_FILE)}).encode())
    sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", APP_KEY_FILE], input=f"{head}.{claims}".encode(),
                         capture_output=True, check=True).stdout
    return f"{head}.{claims}.{b64url(sig)}"


def app_token():
    """Installation token for REPO (valid 1 h), cached and renewed 5 minutes before it expires."""
    with _app_lock:
        if _app_token["token"] and _app_token["expires"] - time.time() > 300:
            return _app_token["token"], None
        try:
            jwt = app_jwt()
        except (OSError, subprocess.CalledProcessError):
            return None, (502, {"error": "The site's GitHub App key is missing or invalid. Tell the web team."})
        status, inst = gh("GET", f"/repos/{REPO}/installation", token=jwt)
        if status != 200:
            return None, (status, inst)
        status, data = gh("POST", f"/app/installations/{inst['id']}/access_tokens", token=jwt)
        if status != 201:
            return None, (status, data)
        expires = calendar.timegm(time.strptime(data["expires_at"], "%Y-%m-%dT%H:%M:%SZ"))
        _app_token.update(token=data["token"], expires=expires)
        return data["token"], None


def gh(method, path, body=None, token=None):
    if token is None:
        token, err = app_token()
        if err:
            return err
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "live.berkeley.mt admin",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e).get("message", "")
        except Exception:
            detail = ""
        if e.code in (401, 403):  # never echo GitHub's 401/403 as ours: the browser would treat it as "log in again"
            return 502, {"error": f"GitHub refused the site's access ({detail or e.reason}). Tell the web team."}
        return e.code, {"error": detail or e.reason}
    except (urllib.error.URLError, TimeoutError) as e:
        return 502, {"error": f"Could not reach GitHub ({getattr(e, 'reason', e)}). Try again in a moment."}


def gh_tree():
    status, data = gh("GET", f"/repos/{REPO}/git/trees/{BRANCH}?recursive=1")
    if status != 200:
        return status, data
    files = sorted(
        ({"path": t["path"], "size": t.get("size", 0)}
         for t in data.get("tree", [])
         if t["type"] == "blob" and editable(t["path"])),
        key=lambda f: f["path"],
    )
    return 200, {"files": files, "truncated": data.get("truncated", False)}


def gh_get(path):
    status, data = gh("GET", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={BRANCH}")
    if status != 200:
        return status, data
    raw = base64.b64decode(data.get("content", ""))
    ext = os.path.splitext(path)[1].lower()
    if ext in TEXT_EXT:
        return 200, {"path": path, "sha": data["sha"], "text": raw.decode("utf-8", "replace")}
    return 200, {"path": path, "sha": data["sha"], "base64": base64.b64encode(raw).decode()}


def note_of(body):
    return " ".join(str(body.get("note") or "").split())[:100]


def commit_message(body):
    """Staff commits are one line: `content: <what they said they changed>`."""
    return f"content: {note_of(body)}"


def who(author):
    """Author = the name typed in the publish dialog. If it is a GitHub username, the commit links to
    that profile (noreply email). The committer is left to GitHub: the App's bot, which signs the commit."""
    author = author.strip()
    if re.fullmatch(r"@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", author):
        status, user = gh("GET", f"/users/{author.lstrip('@')}")
        if status == 200 and user.get("type") == "User":
            return {"author": {"name": user["login"], "email": f"{user['id']}+{user['login']}@users.noreply.github.com"}}
    return {"author": {"name": author, "email": "live@berkeley.mt"}}


def gh_put(path, raw, sha, message, author):
    if not sha:  # creating, or uploading over a file the client did not open
        status, cur = gh("GET", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={BRANCH}")
        if status == 200:
            sha = cur.get("sha")
    body = {"message": message, "content": base64.b64encode(raw).decode(), "branch": BRANCH, **who(author)}
    if sha:
        body["sha"] = sha
    return gh("PUT", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}", body)


def gh_delete(path, sha, message, author):
    return gh("DELETE", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}",
              {"message": message, "sha": sha, "branch": BRANCH, **who(author)})


# ---------------------------------------------------------------- building
def write_local(root, path, raw):
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(raw)


def zola_build(root, out, base_url):
    try:
        r = subprocess.run(["zola", "build", "--base-url", base_url, "--output-dir", out, "--force"],
                           cwd=root, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"zola could not run: {e}"
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-2000:]


def sync_dir(src, dst):
    """Make dst mirror src in place (the nginx root is an image layer, so it
    cannot be renamed away; copying into it works on overlayfs)."""
    shutil.copytree(src, dst, dirs_exist_ok=True)
    keep = {os.path.relpath(os.path.join(r, n), src) for r, ds, fs in os.walk(src) for n in ds + fs}
    for r, ds, fs in os.walk(dst, topdown=False):
        for n in fs + ds:
            full = os.path.join(r, n)
            if os.path.relpath(full, dst) not in keep:
                shutil.rmtree(full, ignore_errors=True) if os.path.isdir(full) else os.remove(full)


def rebuild_live():
    with _build_lock:
        tmp = tempfile.mkdtemp(prefix="live-")
        try:
            ok, log = zola_build(SITE_DIR, tmp, BASE_URL)
            if ok:
                sync_dir(tmp, LIVE_DIR)
        except OSError as e:
            ok, log = False, f"could not update the live pages: {e}"
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return ok, log


def build_preview(path, raw, delete=False, keep=True):
    """Copy the site, apply the edit, build; return (token, log). keep=False just validates."""
    token = secrets.token_urlsafe(12)
    work = tempfile.mkdtemp(prefix="preview-")
    src = os.path.join(work, "src")
    shutil.copytree(SITE_DIR, src, ignore=shutil.ignore_patterns("public", ".git", "*.new", "*.old"))
    if delete:
        try:
            os.remove(os.path.join(src, path))
        except OSError:
            pass
    else:
        write_local(src, path, raw)
    out = os.path.join(work, "public")
    ok, log = zola_build(src, out, f"{BASE_URL}/admin/preview/{token}")
    shutil.rmtree(src, ignore_errors=True)
    now = time.time()
    for t, (d, exp) in list(_previews.items()):
        if exp < now:
            shutil.rmtree(d, ignore_errors=True)
            _previews.pop(t, None)
    if ok and keep:
        _previews[token] = (work, now + 1800)
    else:
        shutil.rmtree(work, ignore_errors=True)
    return (token if ok else None), log


def page_for(path):
    """Best-guess public URL for a file, for the preview iframe."""
    if path.startswith("content/updates/"):
        if path.endswith("_index.md"):
            return "/updates/"
        name = os.path.splitext(os.path.basename(path))[0]
        name = re.sub(r"^\d{4}-\d{2}-\d{2}[_-]", "", name)  # zola drops the date prefix from slugs
        # visitors only ever see updates in the list, scrolled to and highlighted by the hash
        return "/updates/#" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if path.startswith("content/"):
        name = os.path.splitext(os.path.basename(path))[0]
        return "/" if name == "_index" else f"/{name}/"
    if path == "data/schedule.toml":
        return "/schedule/"
    if path == "data/rooms.toml":
        return "/rooms/"
    if path == "config.toml":
        return "/"
    if path.startswith("static/"):
        return "/" + path[len("static/"):]
    return "/"



# ---------------------------------------------------------------- documents
PAGE_LABELS = {"content/_index.md": "Home page", "content/faq.md": "FAQ", "content/guide.md": "Tournament guide",
               "content/help.md": "Help", "content/map.md": "Map & rooms", "content/rooms.md": "Find my rooms",
               "content/lost-found.md": "Lost & found", "content/schedule.md": "Schedule page"}
DATA_ITEMS = [("data/schedule.toml", "Tournament schedule", "calendar3"), ("data/rooms.toml", "Rooms", "door-open"),
              ("config.toml", "Settings", "gear")]
HIDDEN_STATIC = re.compile(r"^static/(fonts/|input\.css|style\.css|live\.js|site\.webmanifest|browserconfig\.xml|favicon|android-chrome|apple-touch|mstile|safari-pinned)")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MANAGED = {"title", "description", "date", "urgent"}


def toml_str(v):
    return json.dumps(str(v), ensure_ascii=False)


def parse_value(raw):
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"'):
        try:
            return json.loads(raw)
        except ValueError:
            return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    return raw  # bare date-times etc.


def parse_front(text):
    """Split '+++ ... +++' front matter. Returns (fields, kept_lines, body).
    fields has the managed keys; kept_lines are other front-matter lines, as
    [(section, line)] so they survive a round trip (template, ...)."""
    fields, kept, body = {}, [], text
    if text.startswith("+++"):
        end = text.find("\n+++", 3)
        if end != -1:
            fm = text[3:end].strip("\n")
            body = text[end + 4:].lstrip("\n")
            section = ""
            for line in fm.splitlines():
                st = line.strip()
                if st.startswith("[") and st.endswith("]"):
                    section = st[1:-1]
                    continue
                m = re.match(r"(\w+)\s*=\s*(.+)$", st)
                if m and ((section == "" and m.group(1) in MANAGED - {"urgent"}) or (section == "extra" and m.group(1) == "urgent")):
                    fields[m.group(1)] = parse_value(m.group(2))
                elif st:
                    kept.append((section, line))
    return fields, kept, body


def compose_front(fields, kept, body):
    out = ["+++"]
    for k in ("title", "description"):
        if fields.get(k) not in (None, ""):
            out.append(f"{k} = {toml_str(fields[k])}")
    if fields.get("date"):
        out.append(f"date = {fields['date']}")
    out += [line for sec, line in kept if sec == ""]
    extra = [line for sec, line in kept if sec == "extra"]
    if fields.get("urgent") or extra:
        out.append("")
        out.append("[extra]")
        if fields.get("urgent"):
            out.append("urgent = true")
        out += extra
    out.append("+++")
    return "\n".join(out) + "\n\n" + body.strip("\n") + "\n"


EVENT_KEYS = ["title", "start", "end", "was_start", "was_end", "note", "location", "description"]


def parse_simple(text, array):
    """Header keys plus the rows of one [[array]] table; good enough for our flat data files."""
    header, rows, cur = {}, [], None
    for line in text.splitlines():
        st = line.strip()
        if st.split("#", 1)[0].strip() == f"[[{array}]]":
            cur = {}
            rows.append(cur)
        elif m := re.match(r'(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|[^#"]+)', st):
            (cur if cur is not None else header)[m.group(1)] = parse_value(m.group(2))
    return header, rows


def parse_schedule(text):
    return parse_simple(text, "events")


ROOM_MESSAGES = [f"{m}_{p}" for m in ("not_found", "no_room", "team_id", "bad_id", "unavailable")
                 for p in ("title", "text")]


def compose_rooms(event_id, columns, messages):
    out = ["# Room lookup (/rooms). server/rooms_api.py looks IDs up live on this",
           "# ContestDojo event and returns room names only. Edit here or at /admin.", "",
           f"event_id = {toml_str(event_id)}", "",
           "# Messages on Find my rooms when a lookup finds nothing. {id} is the ID the",
           "# visitor typed. **bold** and [links](/map/) work."]
    out += [f"{k} = {toml_str(str(messages.get(k, '')).strip())}" for k in ROOM_MESSAGES]
    out += ["",
           "# Optional: ContestDojo's roomAssignments keys are used as the round labels,",
           "# in order of first appearance. List them here to rename or reorder them."]
    for c in columns:
        if (c.get("key") or "").strip():
            out += ["", "[[columns]]", f"key = {toml_str(c['key'].strip())}"]
            if (c.get("label") or "").strip():
                out.append(f"label = {toml_str(c['label'].strip())}")
    return "\n".join(out) + "\n"


ADVISORY_KEYS = ["status", "title", "timestamp", "body"]


def parse_settings(text):
    """config.toml: only the site-wide banner ([extra.advisory]) is editable; everything else is kept."""
    adv, inside = {}, False
    for line in text.splitlines():
        st = line.split("#", 1)[0].strip() if not line.strip().startswith("#") else ""
        if st.startswith("["):
            inside = st == "[extra.advisory]"
        elif inside and (m := re.match(r"(\w+)\s*=\s*(.+)$", st)):
            adv[m.group(1)] = parse_value(m.group(2))
    return {"enabled": bool(adv), **{k: str(adv.get(k, "")) for k in ADVISORY_KEYS}}


def compose_settings(advisory, current_text):
    kept, inside = [], False
    for line in (current_text or "").splitlines():
        st = line.strip()
        if st.startswith("["):
            inside = st.split("#", 1)[0].strip() == "[extra.advisory]"
        if not inside:
            kept.append(line)
    text = "\n".join(kept).rstrip() + "\n"
    if advisory.get("enabled"):
        text += "\n[extra.advisory]\n" + "".join(f"{k} = {toml_str(advisory.get(k, ''))}\n" for k in ADVISORY_KEYS)
    return text


def compose_schedule(header, events):
    out = ["# Tournament-day schedule. Times are 24-hour Pacific. Edit here or at /admin.",
           "# To change a time, set `start`/`end` and keep the original in `was_start`/`was_end`",
           "# (plus an optional `note`) so visitors see what moved.", ""]
    for k in ("title", "date", "timezone"):
        if header.get(k):
            out.append(f"{k} = {toml_str(header[k])}")
    for e in events:
        out.append("")
        out.append("[[events]]")
        for k in EVENT_KEYS:
            if e.get(k) not in (None, ""):
                out.append(f"{k} = {toml_str(e[k])}")
    return "\n".join(out) + "\n"


def doc_from_text(path, text):
    if path == "data/schedule.toml":
        header, events = parse_schedule(text)
        return {"kind": "schedule", "header": header, "events": events}
    if path == "data/rooms.toml":
        header, columns = parse_simple(text, "columns")
        return {"kind": "rooms", "event_id": str(header.get("event_id", "")), "columns": columns,
                "messages": {k: str(header.get(k, "")) for k in ROOM_MESSAGES}}
    if path == "config.toml":
        return {"kind": "settings", "advisory": parse_settings(text)}
    if path.endswith(".md"):
        fields, kept, body = parse_front(text)
        kind = "update" if path.startswith("content/updates/") and not path.endswith("_index.md") else "page"
        return {"kind": kind, "title": fields.get("title", ""), "description": fields.get("description", ""),
                "date": str(fields.get("date", "")), "urgent": bool(fields.get("urgent", False)), "body": body,
                "kept": kept}
    return None


def text_from_doc(path, doc, current_text=None):
    kind = doc.get("kind")
    if kind == "schedule":
        header = doc.get("header") or (parse_schedule(current_text)[0] if current_text else {})
        return compose_schedule(header, doc.get("events") or [])
    if kind == "rooms":
        return compose_rooms(str(doc.get("event_id", "")), doc.get("columns") or [], doc.get("messages") or {})
    if kind == "settings":
        return compose_settings(doc.get("advisory") or {}, current_text)
    if kind in ("update", "page"):
        kept = [tuple(k) for k in doc.get("kept") or []]
        fields = {"title": doc.get("title", ""), "description": doc.get("description", ""),
                  "date": doc.get("date", ""), "urgent": bool(doc.get("urgent"))}
        return compose_front(fields, kept, doc.get("body", ""))
    return ""


def local_text(path):
    try:
        return open(os.path.join(SITE_DIR, path), encoding="utf-8").read()
    except (OSError, UnicodeDecodeError):
        return None


def list_items():
    status, data = gh_tree()
    if status != 200:
        return status, data
    paths = {f["path"] for f in data["files"]}
    items = {"updates": [], "pages": [], "images": [],
             "data": [{"path": p, "title": t, "icon": i} for p, t, i in DATA_ITEMS if p in paths]}
    for f in data["files"]:
        p = f["path"]
        if p.startswith("content/updates/") and p.endswith(".md") and not p.endswith("_index.md"):
            text = local_text(p)
            fields = parse_front(text)[0] if text else {}
            m = re.match(r"content/updates/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})", p)
            items["updates"].append({"path": p, "title": fields.get("title") or os.path.basename(p)[16:-3].replace("-", " "),
                                     "date": str(fields.get("date", "")) or (f"{m.group(1)}T{m.group(2)}:{m.group(3)}:00" if m else ""),
                                     "urgent": bool(fields.get("urgent", False))})
        elif p.startswith("content/") and p.endswith(".md") and "/updates/" not in p:
            text = local_text(p)
            fields = parse_front(text)[0] if text else {}
            items["pages"].append({"path": p, "title": PAGE_LABELS.get(p) or fields.get("title") or os.path.basename(p)})
        elif p.startswith("static/") and os.path.splitext(p)[1].lower() in IMAGE_EXT and not HIDDEN_STATIC.match(p):
            items["images"].append({"path": p, "size": f["size"]})
    items["updates"].sort(key=lambda u: u["date"], reverse=True)
    items["pages"].sort(key=lambda u: list(PAGE_LABELS).index(u["path"]) if u["path"] in PAGE_LABELS else 99)
    return 200, items


# ---------------------------------------------------------------- sessions
def make_session():
    exp = str(int(time.time()) + SESSION_HOURS * 3600)
    sig = hmac.new(SESSION_SECRET, exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def valid_session(value):
    try:
        exp, sig = value.split(".", 1)
    except (ValueError, AttributeError):
        return False
    good = hmac.new(SESSION_SECRET, exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good) and int(exp) > time.time()


MIME = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".json": "application/json",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
        ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain"}


class Handler(BaseHTTPRequestHandler):
    server_version = "live-admin"

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, full, extra_headers=()):
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            return self.send_json(404, {"error": "not_found"})
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authed(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return "live_admin" in c and valid_session(c["live_admin"].value)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 25 * 1024 * 1024:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        p = url.path.rstrip("/") or "/"
        if p == "/admin":
            if not self.authed():
                return self.send_file(os.path.join(HERE, "admin_login.html"))
            return self.send_file(os.path.join(HERE, "admin.html"))
        if p.startswith("/admin/preview/"):
            if not self.authed():
                return self.send_json(401, {"error": "login"})
            parts = url.path[len("/admin/preview/"):].split("/", 1)
            token, rest = parts[0], (parts[1] if len(parts) > 1 else "")
            entry = _previews.get(token)
            if not entry:
                return self.send_json(404, {"error": "preview_expired"})
            full = os.path.normpath(os.path.join(entry[0], "public", rest))
            if not full.startswith(os.path.join(entry[0], "public")):
                return self.send_json(404, {"error": "not_found"})
            if os.path.isdir(full):
                full = os.path.join(full, "index.html")
            return self.send_file(full)
        if not p.startswith("/admin"):  # local development without nginx: serve the built site
            full = os.path.normpath(os.path.join(LIVE_DIR, url.path.lstrip("/")))
            if os.path.isdir(full):
                full = os.path.join(full, "index.html")
            return self.send_file(full) if full.startswith(LIVE_DIR) else self.send_json(404, {"error": "not_found"})
        if not p.startswith("/admin/api/"):
            return self.send_json(404, {"error": "not_found"})
        if p == "/admin/api/status":
            return self.send_json(200, {"configured": configured(),
                                        "authed": self.authed(), "repo": REPO, "branch": BRANCH})
        if not self.authed():
            return self.send_json(401, {"error": "login"})
        qs = urllib.parse.parse_qs(url.query)
        if p == "/admin/api/tree":
            return self.send_json(*gh_tree())
        if p == "/admin/api/items":
            return self.send_json(*list_items())
        if p == "/admin/api/doc":
            path = qs.get("path", [""])[0]
            if not editable(path):
                return self.send_json(400, {"error": "bad_path"})
            status, data = gh_get(path)
            if status != 200:
                return self.send_json(status, data)
            if "text" in data:
                doc = doc_from_text(path, data["text"])
                if doc is None:
                    return self.send_json(400, {"error": "unsupported", "detail": "This file can't be edited here."})
                data.update(doc)
            else:
                data["kind"] = "image" if os.path.splitext(path)[1].lower() in IMAGE_EXT else "binary"
            data["url"] = page_for(path)
            return self.send_json(200, data)
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        body = self.body_json()
        if body is None:
            return self.send_json(400, {"error": "bad_json"})
        if p == "/admin/api/login":
            pw = read_secret(PASSWORD_FILE)
            if not configured():
                return self.send_json(503, {"error": "not_configured"})
            time.sleep(0.5)
            if not hmac.compare_digest(str(body.get("password", "")), pw):
                return self.send_json(403, {"error": "wrong_password"})
            data = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", f"live_admin={make_session()}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age={SESSION_HOURS * 3600}"
                             + ("; Secure" if BASE_URL.startswith("https") else ""))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if p == "/admin/api/logout":
            self.send_response(200)
            self.send_header("Set-Cookie", "live_admin=; Path=/admin; Max-Age=0")
            self.send_header("Content-Length", "2")
            self.end_headers()
            return self.wfile.write(b"{}")
        if not self.authed():
            return self.send_json(401, {"error": "login"})
        path = str(body.get("path", ""))
        if not editable(path):
            return self.send_json(400, {"error": "bad_path"})
        raw = decode_content(body, path)
        if raw is None and p != "/admin/api/delete":
            return self.send_json(400, {"error": "bad_body"})
        if p in ("/admin/api/save", "/admin/api/delete") and not str(body.get("author", "")).strip():
            return self.send_json(400, {"error": "Enter your name first"})
        if p in ("/admin/api/save", "/admin/api/delete") and not note_of(body):
            return self.send_json(400, {"error": "Say what you changed first"})
        if p == "/admin/api/preview":
            token, log = build_preview(path, raw)
            if not token:
                return self.send_json(422, {"error": "build_failed", "log": log})
            return self.send_json(200, {"url": f"/admin/preview/{token}{page_for(path)}", "log": log})
        if p == "/admin/api/save":
            message = commit_message(body)
            if "base64" not in body:  # make sure the site still builds before anything is committed
                ok, log = build_preview(path, raw, keep=False)
                if not ok:
                    return self.send_json(422, {"error": "build_failed", "log": log})
            status, data = gh_put(path, raw, body.get("sha"), message, str(body.get("author", ""))[:60])
            if status not in (200, 201):
                return self.send_json(409 if status in (409, 422) else status, {"error": "github", "detail": data.get("error", ""), "status": status})
            write_local(SITE_DIR, path, raw)
            ok, log = rebuild_live()
            return self.send_json(200, {"sha": data["content"]["sha"], "commit": data["commit"]["html_url"], "url": page_for(path), "live": ok, "log": "" if ok else log})
        if p == "/admin/api/delete":
            status, data = gh_delete(path, body.get("sha"), commit_message(body), str(body.get("author", ""))[:60])
            if status != 200:
                return self.send_json(409 if status in (409, 422) else status, {"error": "github", "detail": data.get("error", ""), "status": status})
            try:
                os.remove(os.path.join(SITE_DIR, path))
            except OSError:
                pass
            ok, log = rebuild_live()
            return self.send_json(200, {"commit": data["commit"]["html_url"], "live": ok, "log": "" if ok else log})
        return self.send_json(404, {"error": "not_found"})

    def log_message(self, fmt, *args):
        pass


def decode_content(body, path=""):
    if "base64" in body:
        return base64.b64decode(body["base64"])
    if not isinstance(body.get("doc"), dict):
        return None
    text = text_from_doc(path, body["doc"], local_text(path))
    if text and not text.endswith("\n"):
        text += "\n"
    return text.encode()


if __name__ == "__main__":
    print(f"admin on 127.0.0.1:{PORT}, repo {REPO}@{BRANCH}, site {SITE_DIR}, "
          f"password {'present' if read_secret(PASSWORD_FILE) else 'missing'}, GitHub App {'present' if read_secret(APP_ID_FILE) and read_secret(APP_KEY_FILE) else 'missing'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
