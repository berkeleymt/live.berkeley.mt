#!/usr/bin/env python3
"""Password-protected editor for the files under content/, data/ and static/.

Runs next to nginx in the live.berkeley.mt image (see start.sh). Files are read
from and saved to GitHub (Contents API, branch BRANCH) so the repository stays
the only source of truth; every save is a commit, which triggers the normal
build-and-deploy. For instant feedback the pod also applies the saved file to
its own copy of the site (SITE_DIR) and rebuilds the live pages with zola.
Preview builds the edited file in a scratch copy and serves the result.

Secrets are files the deploy job writes into the data volume:
  ADMIN_PASSWORD_FILE  shared staff password
  GITHUB_TOKEN_FILE    fine-grained PAT, Contents read/write on REPO
"""
import base64, hashlib, hmac, json, os, re, secrets, shutil, subprocess, tempfile, threading, time, urllib.error, urllib.parse, urllib.request
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ADMIN_PORT", "3003"))
REPO = os.environ.get("ADMIN_REPO", "berkeleymt/live.berkeley.mt")
BRANCH = os.environ.get("ADMIN_BRANCH", "main")
SITE_DIR = os.environ.get("ADMIN_SITE_DIR", "/site")
LIVE_DIR = os.environ.get("ADMIN_LIVE_DIR", "/usr/share/nginx/html")
PASSWORD_FILE = os.environ.get("ADMIN_PASSWORD_FILE", "/app/data/admin.password")
TOKEN_FILE = os.environ.get("GITHUB_TOKEN_FILE", "/app/data/github.token")
BASE_URL = os.environ.get("ADMIN_BASE_URL", "https://live.berkeley.mt")
HERE = os.path.dirname(os.path.abspath(__file__))

EDITABLE = re.compile(r"^(content|data|static)/(?:[A-Za-z0-9_][A-Za-z0-9._-]*/)*[A-Za-z0-9_][A-Za-z0-9._ -]*$")
TEXT_EXT = {".md", ".toml", ".txt", ".css", ".js", ".json", ".svg", ".html", ".xml", ".csv", ".yaml", ".yml"}
SESSION_SECRET = secrets.token_bytes(32)
SESSION_HOURS = 24
_previews, _build_lock = {}, threading.Lock()


def read_secret(path):
    try:
        return open(path).read().strip() or None
    except OSError:
        return None


def editable(path):
    return bool(EDITABLE.match(path)) and ".." not in path


# ---------------------------------------------------------------- GitHub
def gh(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token or read_secret(TOKEN_FILE)}",
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
        return e.code, {"error": detail or e.reason}


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


def gh_put(path, raw, sha, message, author):
    if not sha:  # creating, or uploading over a file the client did not open
        status, cur = gh("GET", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={BRANCH}")
        if status == 200:
            sha = cur.get("sha")
    body = {"message": message, "content": base64.b64encode(raw).decode(), "branch": BRANCH,
            "committer": {"name": author or "Live staff", "email": "live@berkeley.mt"}}
    if sha:
        body["sha"] = sha
    return gh("PUT", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}", body)


def gh_delete(path, sha, message, author):
    return gh("DELETE", f"/repos/{REPO}/contents/{urllib.parse.quote(path)}",
              {"message": message, "sha": sha, "branch": BRANCH,
               "committer": {"name": author or "Live staff", "email": "live@berkeley.mt"}})


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


def rebuild_live():
    with _build_lock:
        tmp = LIVE_DIR + ".new"
        ok, log = zola_build(SITE_DIR, tmp, BASE_URL)
        if ok:
            old = LIVE_DIR + ".old"
            shutil.rmtree(old, ignore_errors=True)
            os.rename(LIVE_DIR, old)
            os.rename(tmp, LIVE_DIR)
            shutil.rmtree(old, ignore_errors=True)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
        return ok, log


def build_preview(path, raw, delete=False):
    """Copy the site, apply the edit, build; return (token, log)."""
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
    if ok:
        _previews[token] = (work, now + 1800)
    else:
        shutil.rmtree(work, ignore_errors=True)
    return (token if ok else None), log


def page_for(path):
    """Best-guess public URL for a file, for the preview iframe."""
    if path.startswith("content/updates/"):
        return "/updates/"
    if path.startswith("content/"):
        name = os.path.splitext(os.path.basename(path))[0]
        return "/" if name == "_index" else f"/{name}/"
    if path == "data/schedule.toml":
        return "/schedule/"
    if path == "data/rooms.toml":
        return "/rooms/"
    if path.startswith("static/"):
        return "/" + path[len("static/"):]
    return "/"


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
        if not p.startswith("/admin/api/"):
            return self.send_json(404, {"error": "not_found"})
        if p == "/admin/api/status":
            return self.send_json(200, {"configured": bool(read_secret(PASSWORD_FILE) and read_secret(TOKEN_FILE)),
                                        "authed": self.authed(), "repo": REPO, "branch": BRANCH})
        if not self.authed():
            return self.send_json(401, {"error": "login"})
        qs = urllib.parse.parse_qs(url.query)
        if p == "/admin/api/tree":
            return self.send_json(*gh_tree())
        if p == "/admin/api/file":
            path = qs.get("path", [""])[0]
            if not editable(path):
                return self.send_json(400, {"error": "bad_path"})
            return self.send_json(*gh_get(path))
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        body = self.body_json()
        if body is None:
            return self.send_json(400, {"error": "bad_json"})
        if p == "/admin/api/login":
            pw = read_secret(PASSWORD_FILE)
            if not pw or not read_secret(TOKEN_FILE):
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
        raw = decode_content(body)
        if p == "/admin/api/preview":
            token, log = build_preview(path, raw)
            if not token:
                return self.send_json(422, {"error": "build_failed", "log": log})
            return self.send_json(200, {"url": f"/admin/preview/{token}{page_for(path)}", "log": log})
        if p == "/admin/api/save":
            message = str(body.get("message") or f"Update {path}")[:200]
            status, data = gh_put(path, raw, body.get("sha"), message, str(body.get("author", ""))[:60])
            if status not in (200, 201):
                return self.send_json(409 if status in (409, 422) else status, {"error": "github", "detail": data.get("error", ""), "status": status})
            write_local(SITE_DIR, path, raw)
            ok, log = rebuild_live()
            return self.send_json(200, {"sha": data["content"]["sha"], "commit": data["commit"]["html_url"], "live": ok, "log": "" if ok else log})
        if p == "/admin/api/delete":
            status, data = gh_delete(path, body.get("sha"), str(body.get("message") or f"Delete {path}")[:200], str(body.get("author", ""))[:60])
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


def decode_content(body):
    if "base64" in body:
        return base64.b64decode(body["base64"])
    text = str(body.get("text", ""))
    if text and not text.endswith("\n"):
        text += "\n"
    return text.encode()


if __name__ == "__main__":
    print(f"admin on 127.0.0.1:{PORT}, repo {REPO}@{BRANCH}, site {SITE_DIR}, "
          f"password {'present' if read_secret(PASSWORD_FILE) else 'missing'}, token {'present' if read_secret(TOKEN_FILE) else 'missing'}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
