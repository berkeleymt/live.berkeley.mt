import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

test("frontend helpers use private requests, safe errors, and encoded email drafts", async () => {
  const source = await readFile(new URL("../src/features/lost-found/api.ts", import.meta.url), "utf8");
  // Emulate Vite's build-time env substitution; type-only imports are stripped.
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText.replaceAll("import.meta.env", "({})");
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const originalFetch = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response('{"receipt":"opaque-test"}', { status: 201 }); };
    assert.deepEqual(await helpers.lostFoundRequest("", { method: "POST", body: "synthetic-test-only" }), { receipt: "opaque-test" });
    assert.equal(captured.url, "/api/lost-found");
    assert.equal(captured.init.cache, "no-store");
    assert.equal(captured.init.credentials, "same-origin");
    assert.ok(captured.init.signal instanceof AbortSignal);
    globalThis.fetch = async () => new Response("Private upstream content must not appear in an error", { status: 503 });
    await assert.rejects(helpers.lostFoundRequest("/staff"), (error) => error.status === 503 && !error.message.includes("upstream content"));
    const href = helpers.contactHref({ email: "synthetic+demo@example.invalid", receipt: "opaque-test" });
    assert.equal(href, "mailto:synthetic%2Bdemo%40example.invalid?subject=BMT%20lost-and-found%20%E2%80%94%20receipt%20opaque-test");
    assert.equal(helpers.requestMessage(new TypeError("private detail"), "Safe recovery message"), "Safe recovery message");
  } finally { globalThis.fetch = originalFetch; }
});

// Isolated socket/API tests of the actual module, even before shared main.rs is
// wired. The test-only role header below is NOT part of production code.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoSource = await readFile(join(root, "server/Cargo.toml"), "utf8");
const fixture = () => ({
  idempotencyKey: randomUUID(), kind: "lost",
  description: "Synthetic test bottle with a star sticker", location: "Demo desk",
  occurredAt: "November 14, 2026, about 9 am Pacific", name: "Synthetic Person",
  email: "synthetic-api@example.invalid",
});

function command(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (bytes) => { output += bytes; });
    child.stderr.on("data", (bytes) => { output += bytes; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}:\n${output}`)));
  });
}

test("lost-and-found private module and HTTP API", { timeout: 240_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-lost-found-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "src"));
  await writeFile(join(directory, "Cargo.toml"), cargoSource.replace('name = "server"', 'name = "live_lost_found_test_harness"'));
  await writeFile(join(directory, "Cargo.lock"), await readFile(join(root, "server/Cargo.lock")));
  await writeFile(join(directory, "src/main.rs"), `
#[path = ${JSON.stringify(join(root, "server/src/lost_found.rs"))}]
mod lost_found;
use axum::{extract::Request, middleware::{self, Next}, response::Response, Router};
use std::{sync::Arc, net::SocketAddr};
async fn test_access(mut request: Request, next: Next) -> Response {
    let role = request.headers().get("x-test-role").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if role == "reader" || role == "writer" || role == "denied" {
        request.extensions_mut().insert(lost_found::LostFoundAccess {
            actor: format!("synthetic-{role}"), can_read: role != "denied", can_write: role == "writer",
        });
    }
    next.run(request).await
}
#[tokio::main]
async fn main() {
    let store = Arc::new(lost_found::LostFoundStore::open(std::env::var("PRIVATE_DB_PATH").unwrap(), std::env::var("DEMO_MODE").as_deref() == Ok("true")).unwrap());
    let app = Router::new().merge(lost_found::public_router(store.clone()))
        .merge(lost_found::admin_router(store).layer(middleware::from_fn(test_access)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("TEST_PORT={}", listener.local_addr().unwrap().port());
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}
`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CARGO_TARGET_DIR: join(root, "server/target") };
  await t.test("Rust module unit tests pass", async () => {
    const output = await command("cargo", ["test", "--manifest-path", join(directory, "Cargo.toml")], { env });
    assert.match(output, /test result: ok/);
  });
  await command("cargo", ["build", "--manifest-path", join(directory, "Cargo.toml")], { env });
  const binary = join(root, "server/target/debug/live_lost_found_test_harness");
  const processes = [];
  // Only test-owned children are stopped. Existing dev/preview servers are untouched.
  t.after(async () => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
    }
  });
  async function launch(path, demo = "false") {
    const child = spawn(binary, [], { cwd: directory, env: { PATH: process.env.PATH, PRIVATE_DB_PATH: path, DEMO_MODE: demo }, stdio: ["ignore", "pipe", "pipe"] });
    processes.push(child);
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test server startup timed out")), 10_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Test server exited early")); });
      child.stdout.on("data", (data) => { const match = String(data).match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    return async (path, { method = "GET", body, role, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(role ? { "x-test-role": role } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
    });
  }
  const dbPath = join(directory, "private.sqlite");
  const api = await launch(dbPath);
  let receipt, report;
  const body = fixture();
  await t.test("anonymous submit returns only an opaque receipt and safely retries", async () => {
    const response = await api("/api/lost-found", { method: "POST", body });
    assert.equal(response.status, 201);
    assert.match(response.headers.get("cache-control"), /no-store/);
    receipt = await response.json(); assert.deepEqual(Object.keys(receipt), ["receipt"]);
    assert.match(receipt.receipt, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await (await api("/api/lost-found", { method: "POST", body })).json(), receipt);
    assert.equal((await api("/api/lost-found", { method: "POST", body: { ...body, description: "Changed report body" } })).status, 409);
  });
  await t.test("there is no public list or receipt readback; staff fails closed", async () => {
    assert.equal((await api("/api/lost-found")).status, 405);
    assert.equal((await api(`/api/lost-found/${receipt.receipt}`)).status, 404);
    for (const suffix of ["", "?q=synthetic"]) assert.equal((await api(`/api/lost-found/staff${suffix}`)).status, 401);
    assert.equal((await api("/api/lost-found/staff", { role: "denied" })).status, 403);
    const response = await api("/api/lost-found/staff", { role: "reader" });
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    const page = await response.json(); assert.equal(page.total, 1); assert.equal(page.demoMode, false);
    report = page.reports[0]; assert.equal(report.email, body.email); assert.notEqual(report.id, receipt.receipt);
  });
  await t.test("type, email, length and body-size validation rejects invalid reports", async () => {
    for (const invalid of [{ email: "" }, { email: "x@@example.org" }, { kind: "mystery" }, { description: "x" }, { location: "x".repeat(201) }, { occurredAt: "" }, { name: 23 }, { unexpected: "rejected" }]) {
      assert.equal((await api("/api/lost-found", { method: "POST", body: { ...fixture(), ...invalid } })).status, 422);
    }
    assert.equal((await api("/api/lost-found", { method: "POST", body: { ...fixture(), description: "x".repeat(13_000) } })).status, 413);
  });
  await t.test("read/write capabilities, conflict detection and status audit are enforced", async () => {
    const update = { idempotencyKey: randomUUID(), revision: 1, status: "contacted", notes: "Synthetic staff manually contacted this person; no automatic email." };
    const path = `/api/lost-found/staff/${report.id}`;
    assert.equal((await api(path, { method: "PATCH", body: update })).status, 401);
    assert.equal((await api(path, { method: "PATCH", body: update, role: "reader" })).status, 403);
    const response = await api(path, { method: "PATCH", body: update, role: "writer" });
    assert.equal(response.status, 200); const saved = await response.json();
    assert.equal(saved.status, "contacted"); assert.equal(saved.revision, 2);
    assert.equal(saved.history[0].actor, "synthetic-writer"); assert.equal(saved.history[0].fromStatus, "new");
    assert.equal((await (await api(path, { method: "PATCH", body: update, role: "writer" })).json()).revision, 2);
    assert.equal((await api(path, { method: "PATCH", body: { ...update, idempotencyKey: randomUUID(), status: "resolved" }, role: "writer" })).status, 409);
    assert.equal((await api(path, { method: "PATCH", body: { ...update, idempotencyKey: randomUUID(), revision: 2, status: "resolved" }, role: "writer" })).status, 200);
  });
  await t.test("staff search, filters and pagination remain bounded", async () => {
    const get = async (query) => (await api(`/api/lost-found/staff?${query}`, { role: "reader" })).json();
    assert.equal((await get("q=star&status=resolved&kind=lost&limit=1")).total, 1);
    assert.equal((await get("status=new")).total, 0);
    assert.equal((await get("q=%25")).total, 0);
    assert.equal((await get("offset=1&limit=1")).reports.length, 0);
    for (const query of ["limit=51", "limit=0", "offset=10001"]) assert.equal((await api(`/api/lost-found/staff?${query}`, { role: "reader" })).status, 422);
    assert.equal((await api("/api/lost-found/staff?status=unknown", { role: "reader" })).status, 400);
  });
  await t.test("private records persist; demo seeds once without overwriting reports", async () => {
    const restarted = await launch(dbPath, "true");
    const page = await (await restarted("/api/lost-found/staff", { role: "reader" })).json();
    assert.equal(page.total, 3); assert.equal(page.reports.find((r) => r.id === report.id).status, "resolved");
    assert.equal(page.reports.filter((r) => r.synthetic && r.email.endsWith("@example.invalid")).length, 2);
    const again = await launch(dbPath, "true");
    assert.equal((await (await again("/api/lost-found/staff", { role: "reader" })).json()).total, 3);
    const notTrue = await launch(join(directory, "not-demo.sqlite"), "1");
    assert.equal((await (await notTrue("/api/lost-found/staff", { role: "reader" })).json()).total, 0);
  });
  await t.test("email abuse is limited but an identical retry still succeeds", async () => {
    for (let i = 0; i < 4; i++) assert.equal((await api("/api/lost-found", { method: "POST", body: fixture() })).status, 201);
    const limited = await api("/api/lost-found", { method: "POST", body: fixture() });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "1800");
    assert.deepEqual(await (await api("/api/lost-found", { method: "POST", body })).json(), receipt);
  });
  await t.test("forged forwarding headers cannot evade the peer limit", async () => {
    const limitedApi = await launch(join(directory, "limited.sqlite"));
    for (let i = 0; i < 60; i++) {
      const response = await limitedApi("/api/lost-found", { method: "POST", body: { ...fixture(), email: "bad" }, headers: { "x-forwarded-for": `192.0.2.${i}` } });
      assert.equal(response.status, 422);
    }
    assert.equal((await limitedApi("/api/lost-found", { method: "POST", body: fixture(), headers: { "forwarded": "for=198.51.100.42", "x-forwarded-for": "198.51.100.42" } })).status, 429);
  });
});
