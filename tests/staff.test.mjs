import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { canStaff, hasAnyCapability, staffReturnPath, CAPABILITY_LABELS } from "../src/features/staff/model.ts";

// Compile the owned module against a minimal AppState, without touching the shared
// main.rs/routes.rs. API handlers below are inert sentinels, never the live server.
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "server/target");
let temporary;
let binary;
let accountFixture;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "bmt-staff-contract-"));
  const manifest = (await readFile(join(root, "server/Cargo.toml"), "utf8"))
    .replace('name = "server"', 'name = "staff-contract-harness"') + '\n[[bin]]\nname = "staff-contract-harness"\npath = "main.rs"\n';
  await writeFile(join(temporary, "Cargo.toml"), manifest);
  await writeFile(join(temporary, "Cargo.lock"), await readFile(join(root, "server/Cargo.lock")));
  await writeFile(join(temporary, "main.rs"), `
#[path = ${JSON.stringify(join(root, "server/src/staff.rs"))}] mod staff;
mod routes {
    #[derive(Clone)]
    pub struct AppState {
        pub staff: std::sync::Arc<crate::staff::StaffStore>,
        pub admin_password: Option<String>,
    }
}
use axum::{extract::State, http::HeaderMap, middleware, routing::{any, get, post}, Json, Router};
use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--fixture") {
        let salt = SaltString::encode_b64(b"synthetic-tests-only").unwrap();
        let hash = Argon2::default().hash_password(b"synthetic-test-password", &salt).unwrap().to_string();
        println!("{}", serde_json::json!({"accounts": [
            {"id":"test-dispatcher","username":"test.dispatcher","name":"Synthetic test dispatcher","role":"dispatcher","passwordHash":hash},
            {"id":"test-read-only","username":"test.reader","name":"Synthetic read-only inbox","role":"info_desk","passwordHash":hash,"capabilities":["found:read","updates:read","access:read"]}
        ]}));
        return;
    }
    let state = routes::AppState { staff: std::sync::Arc::new(staff::StaffStore::from_env().expect("staff configuration rejected")), admin_password: std::env::var("ADMIN_PASSWORD").ok() };
    let mut protected = Router::new();
    for path in ["/api/content", "/api/site/editor", "/api/site/editor/assets", "/api/site/media", "/api/wayfinding/editor", "/api/publishing", "/api/publishing/export", "/api/publishing/push", "/api/publishing/restore", "/api/schedule", "/api/schedule/test", "/api/delays", "/api/delays/test", "/api/announcements", "/api/announcements/test", "/api/lost-found/staff", "/api/lost-found/staff/test", "/api/room-lookup/staff", "/api/unmapped", "/api/settings", "/admin"] {
        protected = protected.route(path, any(|| async { Json(serde_json::json!({"allowed":true})) }));
    }
    protected = protected.route("/api/staff/access", get(staff::session)).route_layer(middleware::from_fn_with_state(state.clone(), staff::require_auth));
    let app = Router::new().merge(staff::public_router()).merge(protected)
        .route("/api/live", get(|State(state): State<routes::AppState>, headers: HeaderMap| async move { Json(serde_json::json!({"preview":staff::can(&state, &headers, staff::Capability::UpdatesRead)})) }))
        .route("/api/lost-found", post(|| async { Json(serde_json::json!({"receipt":"synthetic-receipt"})) }))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("STAFF_TEST_PORT={}", listener.local_addr().unwrap().port());
    axum::serve(listener, app).await.unwrap();
}
`);
  const args = ["--offline", "--manifest-path", join(temporary, "Cargo.toml"), "--target-dir", target];
  await run("cargo", ["test", ...args], { timeout: 240_000, maxBuffer: 4_000_000 });
  await run("cargo", ["build", ...args], { timeout: 240_000, maxBuffer: 4_000_000 });
  binary = join(target, "debug/staff-contract-harness");
  accountFixture = (await run(binary, ["--fixture"], { env: { PATH: process.env.PATH } })).stdout;
}, { timeout: 500_000 });

after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function launch(t, configuration = {}) {
  const directory = await mkdtemp(join(temporary, "server-"));
  const child = spawn(binary, [], {
    cwd: directory,
    env: { PATH: process.env.PATH, ...configuration },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  });
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("Staff test server did not start")), 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Staff test server exited ${code}`)); });
    child.stdout.on("data", (bytes) => {
      const match = String(bytes).match(/STAFF_TEST_PORT=(\d+)/);
      if (match) { clearTimeout(timer); resolvePort(match[1]); }
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const api = (path, { method = "GET", body, cookie, csrf, headers = {} } = {}) => fetch(origin + path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-Staff-CSRF": csrf } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const demo = async (accountId, previous) => {
    const response = await api("/api/staff/demo", { method: "POST", body: { accountId }, cookie: previous?.cookie, headers: { "X-Staff-Request": "1", Origin: origin } });
    assert.equal(response.status, 200);
    const data = await response.json();
    return { data, csrf: data.csrfToken, cookie: response.headers.get("set-cookie").split(";")[0], rawCookie: response.headers.get("set-cookie") };
  };
  return { api, demo, origin };
}

const boundaries = [
  ["/api/schedule", "POST", "schedule:write"],
  ["/api/schedule/test", "PUT", "schedule:write"],
  ["/api/delays", "POST", "schedule:write"],
  ["/api/delays/test", "DELETE", "schedule:write"],
  ["/api/announcements", "GET", "updates:read"],
  ["/api/announcements/test", "PUT", "updates:write"],
  ["/api/content", "GET", "content:write"],
  ["/api/content", "PUT", "content:write"],
  ["/api/site/editor/assets", "GET", "content:write"],
  ["/api/site/editor/assets", "POST", "content:write"],
  ["/api/site/editor", "PUT", "content:write"],
  ["/api/site/media", "GET", "content:write"],
  ["/api/site/media", "POST", "content:write"],
  ["/api/wayfinding/editor", "GET", "rooms:write"],
  ["/api/wayfinding/editor", "PUT", "rooms:write"],
  ["/api/room-lookup/staff", "GET", "rooms:write"],
  ["/api/lost-found/staff", "GET", "found:read"],
  ["/api/lost-found/staff/test", "PATCH", "found:write"],
  ["/api/publishing", "GET", "publishing:write"],
  ["/api/publishing/export", "GET", "publishing:write"],
  ["/api/publishing/push", "POST", "publishing:write"],
  ["/api/publishing/restore", "POST", "publishing:write"],
  ["/api/staff/access", "GET", "access:read"],
  ["/api/settings", "GET", "settings:write"],
];

const roleGrants = {
  "demo-dispatcher": ["schedule:write", "updates:read", "updates:write", "access:read"],
  "demo-crisis": ["updates:read", "updates:write", "found:read", "found:write", "access:read"],
  "demo-info": ["updates:read", "found:read", "found:write", "access:read"],
  "demo-admin": Object.keys(CAPABILITY_LABELS).filter(capability => !['people:write', 'settings:write'].includes(capability)),
};

test("role utilities deny absent grants and constrain login return destinations", () => {
  assert.equal(canStaff(null, "schedule:write"), false);
  assert.equal(hasAnyCapability({ capabilities: ["updates:read"] }, ["updates:write", "found:read"]), false);
  assert.equal(hasAnyCapability({ capabilities: ["updates:read"] }, ["updates:read"]), true);
  for (const bad of [null, "https://evil.test", "//evil.test", "/administrator", "/admin\\evil", "/staff/sign-in", "/admin\n", "/admin/../outside", "/admin/%2e%2e/outside"]) assert.equal(staffReturnPath(bad), "/admin");
  assert.equal(staffReturnPath("/admin/rooms?building=test#floor"), "/admin/rooms?building=test#floor");
});

test("all four synthetic roles enforce every API permission boundary", async (t) => {
  const { api, demo } = await launch(t, { DEMO_MODE: "true", STAFF_COOKIE_SECURE: "false" });
  for (const [account, grants] of Object.entries(roleGrants)) {
    const session = await demo(account);
    assert.deepEqual(new Set(session.data.user.capabilities), new Set(grants));
    assert.equal(session.data.user.demo, true);
    assert.match(session.rawCookie, /HttpOnly; SameSite=Strict/);
    assert.equal(session.data.csrfToken.length, 64);
    assert.ok(session.data.expiresAt > Date.now() / 1000);
    for (const [path, method, capability] of boundaries) {
      const response = await api(path, { method, cookie: session.cookie, csrf: session.csrf });
      assert.equal(response.status, grants.includes(capability) ? 200 : 403, `${account} ${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      if (response.status === 403) assert.equal(typeof (await response.json()).error, "string");
    }
    assert.equal((await api("/api/unmapped", { cookie: session.cookie })).status, 403);
    assert.equal((await (await api("/api/live", { cookie: session.cookie })).json()).preview, true);
  }
});

test("missing credentials fail closed while public reads and receipts stay public", async (t) => {
  const { api } = await launch(t);
  for (const [path, method] of boundaries) {
    const response = await api(path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.has("www-authenticate"), false);
  }
  const page = await api("/admin");
  assert.equal(page.status, 303);
  assert.equal(page.headers.get("location"), "/staff/sign-in");
  const discovery = await api("/api/staff/session");
  assert.equal(discovery.headers.get("cache-control"), "no-store");
  const data = await discovery.json();
  assert.equal(data.user, null);
  assert.equal(data.demoMode, false);
  assert.deepEqual(data.demoAccounts, []);
  assert.equal(data.passwordLoginEnabled, false);
  assert.equal(data.ownerLoginEnabled, false);
  assert.equal((await api("/api/staff/demo", { method: "POST", body: { accountId: "demo-admin" }, headers: { "X-Staff-Request": "1" } })).status, 404);
  assert.equal((await api("/api/staff/login", { method: "POST", body: { username: "owner", password: "guess" }, headers: { "X-Staff-Request": "1" } })).status, 401);
  assert.equal((await api("/api/content", { cookie: `bmt_live_staff=${"a".repeat(64)}` })).status, 401);
  assert.equal((await (await api("/api/live")).json()).preview, false);
  assert.equal((await api("/api/lost-found", { method: "POST", body: { description: "Synthetic test" } })).status, 200);
});

test("session rotation, logout and origin/CSRF protections reject stale or foreign requests", async (t) => {
  const { api, demo, origin } = await launch(t, { DEMO_MODE: "true", STAFF_COOKIE_SECURE: "false" });
  const first = await demo("demo-admin");
  assert.equal((await api("/api/content", { method: "PUT", cookie: first.cookie })).status, 403);
  assert.equal((await api("/api/content", { method: "PUT", cookie: first.cookie, csrf: "wrong" })).status, 403);
  assert.equal((await api("/api/content", { method: "PUT", cookie: first.cookie, csrf: first.csrf, headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await api("/api/content", { method: "PUT", cookie: first.cookie, csrf: first.csrf, headers: { "Sec-Fetch-Site": "same-site" } })).status, 403);
  assert.equal((await api("/api/content", { method: "PUT", cookie: first.cookie, csrf: first.csrf, headers: { Origin: origin } })).status, 200);
  const second = await demo("demo-info", first);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal((await api("/api/content", { cookie: first.cookie })).status, 401);
  assert.equal((await api("/api/lost-found/staff", { cookie: second.cookie })).status, 200);
  assert.equal((await api("/api/staff/logout", { method: "POST", cookie: second.cookie, headers: { "X-Staff-Request": "1" } })).status, 403);
  const logout = await api("/api/staff/logout", { method: "POST", cookie: second.cookie, csrf: second.csrf, headers: { "X-Staff-Request": "1", Origin: origin } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await logout.json()).user, null);
  assert.equal((await api("/api/lost-found/staff", { cookie: second.cookie })).status, 401);
  assert.equal((await api("/api/staff/demo", { method: "POST", body: { accountId: "demo-admin" } })).status, 403);
  assert.equal((await api("/api/staff/demo", { method: "POST", body: { accountId: "demo-admin" }, headers: { "X-Staff-Request": "1", Origin: "null" } })).status, 403);
});

test("private Argon2 accounts and explicit per-account grants work without demo mode", async (t) => {
  const path = join(temporary, "synthetic-accounts.json");
  await writeFile(path, accountFixture, { mode: 0o600 });
  const { api } = await launch(t, { STAFF_ACCOUNTS_PATH: path });
  const discovery = await (await api("/api/staff/session")).json();
  assert.equal(discovery.passwordLoginEnabled, true);
  assert.equal(discovery.demoMode, false);
  const login = (username, password) => api("/api/staff/login", { method: "POST", body: { username, password }, headers: { "X-Staff-Request": "1" } });
  assert.equal((await login("test.dispatcher", "wrong")).status, 401);
  assert.equal((await login("not-an-account", "synthetic-test-password")).status, 401);
  assert.equal((await api("/api/staff/login", { method: "POST", body: { username: "test.dispatcher", password: "synthetic-test-password" } })).status, 403);
  const signedIn = await login("TEST.READER", "synthetic-test-password");
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get("set-cookie"), /; Secure$/);
  const cookie = signedIn.headers.get("set-cookie").split(";")[0];
  const user = await signedIn.json();
  assert.equal(user.user.demo, false);
  assert.equal(user.user.authSource, "account");
  assert.equal(JSON.stringify(user).includes("passwordHash"), false);
  assert.equal(JSON.stringify(user).includes("argon2"), false);
  assert.equal((await api("/api/lost-found/staff", { cookie })).status, 200);
  assert.equal((await api("/api/lost-found/staff/test", { method: "PATCH", cookie, csrf: user.csrfToken })).status, 403);
});

test("legacy owner Basic Auth remains usable, but an empty owner password is never accepted", async (t) => {
  const { api } = await launch(t, { ADMIN_PASSWORD: "synthetic-owner-only" });
  const authorization = `Basic ${Buffer.from("legacy:anything-wrong").toString("base64")}`;
  assert.equal((await api("/api/content", { headers: { Authorization: authorization } })).status, 401);
  const good = `Basic ${Buffer.from("legacy:synthetic-owner-only").toString("base64")}`;
  assert.equal((await api("/api/content", { method: "PUT", headers: { Authorization: good } })).status, 200);
  assert.equal((await api("/api/content", { method: "PUT", headers: { Authorization: good, Origin: "https://evil.example" } })).status, 403);
  const session = await (await api("/api/staff/session", { headers: { Authorization: good } })).json();
  assert.equal(session.user.role, "administrator");
  assert.equal(session.csrfToken, null);
  const ownerLogin = await api("/api/staff/login", { method: "POST", body: { username: "owner", password: "synthetic-owner-only" }, headers: { "X-Staff-Request": "1" } });
  assert.equal(ownerLogin.status, 200);
  assert.ok((await ownerLogin.json()).csrfToken);
  const empty = await launch(t, { ADMIN_PASSWORD: "" });
  assert.equal((await empty.api("/api/content", { headers: { Authorization: `Basic ${Buffer.from("owner:").toString("base64")}` } })).status, 401);
});

test('two-role demo enforces operational access and Super-only People, with live demotion/removal', async t => {
  const { api, demo } = await launch(t, { DEMO_MODE: 'true', STAFF_COOKIE_SECURE: 'false' });
  const discovery = await (await api('/api/staff/session')).json();
  assert.deepEqual(discovery.demoAccounts.map(a => a.role), ['admin', 'super']);
  assert.equal(discovery.authMode, 'legacy');
  assert.equal(discovery.googleClientId, null);
  const admin = await demo('demo-operator');
  const boss = await demo('demo-super');
  for (const session of [admin, boss]) {
    for (const [path, method, capability] of boundaries) {
      assert.equal((await api(path, { method, cookie: session.cookie, csrf: session.csrf })).status,
        session.data.user.capabilities.includes(capability) ? 200 : 403, `${session.data.user.role} ${path}`);
    }
  }
  assert.equal((await api('/api/staff/people')).status, 401);
  assert.equal((await api('/api/staff/people', { cookie: admin.cookie })).status, 403);
  const mutate = (session, email, method, body, headers = { 'X-Staff-Request': '1' }) => api('/api/staff/people' + (email ? '/' + encodeURIComponent(email) : ''), { method, body, cookie: session.cookie, csrf: session.csrf, headers });
  assert.equal((await mutate(admin, '', 'POST', { email: 'denied@example.test', role: 'super' })).status, 403);
  assert.equal((await api('/api/staff/people', { method: 'POST', cookie: boss.cookie, body: { email: 'no-csrf@example.test', role: 'admin' }, headers: { 'X-Staff-Request': '1' } })).status, 403);
  assert.equal((await mutate(boss, '', 'POST', { email: 'bad-origin@example.test', role: 'admin' }, { 'X-Staff-Request': '1', Origin: 'https://evil.test' })).status, 403);
  for (const role of ['administrator', 'dispatcher', 'info_desk', 'crisis_manager']) assert.equal((await mutate(boss, '', 'POST', { email: 'invalid@example.test', role })).status, 400);
  assert.equal((await mutate(boss, '', 'POST', { email: 'not-an-email', role: 'admin' })).status, 400);
  assert.equal((await mutate(boss, '', 'POST', { email: ' New@Example.Test ', role: 'admin' })).status, 204);
  assert.equal((await mutate(boss, '', 'POST', { email: 'new@example.test', role: 'admin' })).status, 409);
  const list = await api('/api/staff/people', { cookie: boss.cookie });
  assert.equal(list.headers.get('cache-control'), 'no-store');
  const people = (await list.json()).accounts;
  assert.equal(people.find(p => p.email === 'new@example.test').addedBy, 'super@example.test');
  assert.equal(JSON.stringify(people).includes('csrf'), false);
  assert.equal((await mutate(boss, 'super@example.test', 'DELETE')).status, 409);
  assert.equal((await mutate(boss, 'super@example.test', 'PATCH', { role: 'admin' })).status, 409);
  assert.equal((await mutate(boss, 'admin@example.test', 'PATCH', { role: 'super' })).status, 204);
  assert.equal((await (await api('/api/staff/session', { cookie: admin.cookie, headers: { 'X-Staff-Presence': '1' } })).json()).user.role, 'super');
  assert.equal((await mutate(admin, 'super@example.test', 'DELETE')).status, 409, 'bootstrap protected even from another Super');
  assert.equal((await mutate(admin, 'admin@example.test', 'PATCH', { role: 'admin' })).status, 409, 'cannot demote self');
  assert.ok((await (await api('/api/staff/people', { cookie: boss.cookie })).json()).accounts.find(p => p.email === 'admin@example.test').online);
  assert.equal((await mutate(boss, 'admin@example.test', 'PATCH', { role: 'admin' })).status, 204);
  assert.equal((await api('/api/staff/people', { cookie: admin.cookie })).status, 403, 'live demotion');
  assert.equal((await mutate(boss, 'admin@example.test', 'DELETE')).status, 204);
  assert.equal((await api('/api/content', { cookie: admin.cookie })).status, 401, 'live removal');
  assert.equal((await (await api('/api/staff/session', { cookie: admin.cookie })).json()).user, null);
  assert.equal((await mutate(boss, '', 'POST', { email: 'admin@example.test', role: 'admin' })).status, 204);
  assert.equal((await api('/api/content', { cookie: admin.cookie })).status, 401, 'no resurrection on re-add');
  const next = await demo('demo-super', boss);
  assert.equal((await api('/api/staff/people', { cookie: boss.cookie })).status, 401, 'rotation');
  assert.equal((await api('/api/staff/logout', { method: 'POST', cookie: next.cookie, csrf: next.csrf, headers: { 'X-Staff-Request': '1' } })).status, 200);
  assert.equal((await api('/api/staff/people', { cookie: next.cookie })).status, 401, 'logout');
});

test('Google configuration never falls back to local accounts and missing/invalid Google is explicit', async t => {
  const dir = await mkdtemp(join(temporary, 'private-google-'));
  const config = { STAFF_AUTH_MODE: 'google', SUPER_ADMIN_EMAILS: 'bootstrap@example.test', STAFF_STATE_PATH: join(dir, 'staff.sqlite'), ADMIN_PASSWORD: 'synthetic-owner' };
  const { api } = await launch(t, config);
  const data = await (await api('/api/staff/session')).json();
  assert.equal(data.authMode, 'google');
  assert.equal(data.passwordLoginEnabled, false);
  assert.equal(data.ownerLoginEnabled, false);
  assert.equal(data.googleClientId, null);
  assert.equal(JSON.stringify(data).includes('bootstrap@example.test'), false);
  const headers = { 'X-Staff-Request': '1' };
  assert.equal((await api('/api/staff/google-login', { method: 'POST', body: { credential: 'not-a-token' }, headers })).status, 503);
  assert.equal((await api('/api/staff/login', { method: 'POST', body: { username: 'owner', password: 'synthetic-owner' }, headers })).status, 403);
  assert.equal((await api('/api/content', { headers: { Authorization: `Basic ${Buffer.from('owner:synthetic-owner').toString('base64')}` } })).status, 401);
  assert.equal((await api('/api/staff/demo', { method: 'POST', body: { accountId: 'demo-super' }, headers })).status, 404);
  const configured = await launch(t, { ...config, GOOGLE_CLIENT_ID: 'synthetic-client' });
  assert.equal((await (await configured.api('/api/staff/session')).json()).googleClientId, 'synthetic-client');
  // Malformed tokens are rejected before any network access. Cryptographic cases use offline Rust fixtures.
  assert.equal((await configured.api('/api/staff/google-login', { method: 'POST', body: { credential: 'not-a-token' }, headers })).status, 401);
  assert.equal((await configured.api('/api/staff/google-login', { method: 'POST', body: { credential: 'not-a-token' } })).status, 403);
  assert.equal((await configured.api('/api/staff/google-login', { method: 'POST', body: { credential: 'not-a-token' }, headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, GOOGLE_CLIENT_ID: 'synthetic-client', STAFF_AUTH_MODE: 'legacy' }, timeout: 10000 }), /cannot fall back to legacy/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, SUPER_ADMIN_EMAILS: '' }, timeout: 10000 }), /requires at least one explicit/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, DEMO_MODE: 'true' }, timeout: 10000 }), /cannot be combined/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, STAFF_STATE_PATH: join(root, 'server', 'never-created.sqlite') }, timeout: 10000 }), /outside Git checkouts/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, STATIC_DIR: dir }, timeout: 10000 }), /outside public\/content/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, ...config, LIVE_CONTENT_REMOTE_REPO: dir }, timeout: 1000 }), /outside public\/content/);
  const old = JSON.parse(accountFixture); old.accounts[0].role = 'super';
  const path = join(dir, 'never-promote.json'); await writeFile(path, JSON.stringify(old), { mode: 0o600 });
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, STAFF_AUTH_MODE: 'legacy', STAFF_ACCOUNTS_PATH: path }, timeout: 10000 }), /invalid, reserved or duplicated/);
});

test("unsafe cookie configuration and invalid private account imports fail startup", async () => {
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, STAFF_COOKIE_SECURE: "false" }, timeout: 10000 }), /STAFF_COOKIE_SECURE=false is allowed only/);
  const invalid = join(temporary, "invalid-accounts.json");
  const fixture = JSON.parse(accountFixture);
  fixture.accounts[0].passwordHash = "plaintext-is-never-accepted";
  await writeFile(invalid, JSON.stringify(fixture), { mode: 0o600 });
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, STAFF_ACCOUNTS_PATH: invalid }, timeout: 10000 }), /Invalid Argon2 password hash/);
  await assert.rejects(run(binary, [], { env: { PATH: process.env.PATH, STAFF_ACCOUNTS_PATH: join(temporary, "missing.json") }, timeout: 10000 }), /Cannot read STAFF_ACCOUNTS_PATH/);
});
