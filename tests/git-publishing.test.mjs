import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test, after } from "node:test";

const exec = promisify(execFile);
const binary = resolve("server/target/debug/server");
// Builders cannot modify shared dependency files. Optional isolated compilation
// copies the manifest/lock/sources and updates only the temporary lockfile.
if (process.env.LIVE_PUBLISHING_ISOLATED_BUILD === "1") {
  const root = await mkdtemp(join(tmpdir(), "live-publishing-build-"));
  const build = join(root, "server");
  await mkdir(build);
  after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve("content"), join(root, "content"), { recursive: true });
  await cp(resolve("server/Cargo.toml"), join(build, "Cargo.toml"));
  await cp(resolve("server/Cargo.lock"), join(build, "Cargo.lock"));
  await cp(resolve("server/src"), join(build, "src"), { recursive: true });
  const env = { ...process.env, CARGO_TARGET_DIR: resolve("server/target") };
  const unit = await exec("cargo", ["test", "--offline", "--manifest-path", join(build, "Cargo.toml")], { env, timeout: 180000, maxBuffer: 2_000_000 });
  console.log(unit.stdout);
  await exec("cargo", ["build", "--offline", "--manifest-path", join(build, "Cargo.toml")], { env, timeout: 180000, maxBuffer: 2_000_000 });
}

const initialEvent = await readFile(new URL("../content/event.json", import.meta.url), "utf8");
const fixture = () => ({
  schedule: [{ id: "round", title: "Synthetic demo round", startTime: "10:00", endTime: "11:00", location: "Synthetic room", category: "team" }],
  delays: [], announcements: [],
});

// Only disposable dedicated repositories. No identity changes, network or credentials.
async function git(directory, ...args) {
  const { stdout } = await exec("git", args, { cwd: directory, timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
}
async function setup(t, content = fixture()) {
  const directory = await mkdtemp(join(tmpdir(), "live-git-publishing-"));
  const processes = [];
  t.after(async () => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const repo = join(directory, "content");
  await mkdir(repo);
  await git(repo, "init", "--initial-branch=live");
  await writeFile(join(repo, "operations.json"), JSON.stringify(content));
  await git(repo, "add", "operations.json");
  await git(repo, "commit", "-m", "Synthetic fixture");
  const remote = join(directory, "backup.git");
  await git(directory, "init", "--bare", remote);
  await git(repo, "remote", "add", "origin", remote);
  const eventPath = join(directory, "event.json");
  await writeFile(eventPath, initialEvent);
  const start = async ({ password = "synthetic-tests-only", expectFailure = false } = {}) => {
    const child = spawn(binary, [], {
      cwd: directory,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: "0", EVENT_CONTENT_PATH: eventPath, SITE_CONTENT_PATH: resolve('content/site.json'), WAYFINDING_CONTENT_PATH: resolve('content/wayfinding.json'), LIVE_CONTENT_REPO: repo, ...(password ? { ADMIN_PASSWORD: password } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);
    let output = "";
    child.stderr.on("data", bytes => { output += String(bytes); });
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); expectFailure ? resolvePort(null) : reject(new Error(`Exited ${code}: ${output}`)); });
      child.stdout.on("data", bytes => {
        const match = String(bytes).match(/Server listening on \[::\]:(\d+)/);
        if (match) { clearTimeout(timer); resolvePort(match[1]); }
      });
    });
    if (expectFailure) { assert.equal(port, null, "must fail closed at startup"); return {}; }
    const api = (path, { method = "GET", body, revision, auth = true, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: {
        ...(auth ? { Authorization: "Basic " + Buffer.from(`staff:${password}`).toString("base64") } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(revision !== undefined ? { "If-Match": `"${revision}"` } : {}), ...headers,
      }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
    });
    const live = async (auth = false, query = "") => (await api(`/api/live${query}`, { auth })).json();
    const status = async () => (await api("/api/publishing")).json();
    return { api, live, status, child };
  };
  const commit = async (value, message = "Direct content edit") => {
    await writeFile(join(repo, "operations.json"), typeof value === "string" ? value : JSON.stringify(value));
    await git(repo, "add", "operations.json");
    await git(repo, "commit", "-m", message);
    return git(repo, "rev-parse", "HEAD");
  };
  return { directory, repo, remote, start, commit };
}
async function eventually(read, predicate, description) {
  const deadline = Date.now() + 8500;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`${description}: ${JSON.stringify(value)}`);
}

// Existing API signatures, revision handling, privacy and validation.
test("Git mode preserves legacy CRUD and protects staff publications", async t => {
  const { repo, start } = await setup(t);
  const { api, live, status } = await start();
  let revision = (await live()).operationRevision;
  const initial = revision;
  async function save(path, method, body) {
    const response = await api(path, { method, body, revision });
    assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`);
    const etag = response.headers.get("etag");
    assert.match(etag, /^"[0-9a-f]{40}"$/);
    revision = etag.slice(1, -1);
    return response;
  }
  for (const path of ["/api/publishing", "/api/publishing/export", "/api/publishing/push", "/api/publishing/restore"]) {
    const response = await api(path, { auth: false, method: path.endsWith("push") || path.endsWith("restore") ? "POST" : "GET" });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await api("/api/schedule", { auth: false, method: "POST", body: {} })).status, 401);
  assert.equal((await api("/api/schedule", { method: "POST", body: {} })).status, 428);
  assert.equal((await api("/api/schedule", { method: "POST", body: {}, revision: "*" })).status, 412);
  const input = { title: "Équipe 日本語", startTime: "12:00", endTime: "13:00", location: "Synthetic room", category: "team", description: "Synthetic public information" };
  const created = await (await save("/api/schedule", "POST", input)).json();
  const afterCreate = revision;
  assert.notEqual(revision, initial);
  assert.equal((await api(`/api/schedule/${created.id}`, { method: "PUT", body: input, revision: initial })).status, 409);
  await save(`/api/schedule/${created.id}`, "PUT", input);
  assert.equal(revision, afterCreate, "semantic no-op does not create an empty commit");
  assert.equal((await api(`/api/schedule/${created.id}`, { method: "PUT", body: { title: "Partial PUT" }, revision })).status, 422);
  for (const badTime of ["é:12", "24:00", "12:99"]) {
    assert.equal((await api(`/api/schedule/${created.id}`, { method: "PUT", body: { ...input, startTime: badTime }, revision })).status, 422);
  }
  assert.equal((await live()).operationRevision, revision);
  await save(`/api/schedule/${created.id}`, "PUT", { ...input, title: "Edited round" });
  const delayed = await (await save("/api/delays", "POST", { eventId: created.id, newTime: "12:15", newEndTime: "13:15", reason: "Synthetic delay" })).json();
  assert.equal((await live()).delays.find(d => d.id === delayed.id).newTime, "12:15");
  await save(`/api/delays/${delayed.id}`, "DELETE");
  const replacement = await (await save("/api/delays", "POST", { eventId: created.id, newTime: "12:20", newEndTime: "13:20" })).json();
  await save(`/api/schedule/${created.id}`, "DELETE");
  assert.equal((await live()).delays.some(d => d.id === replacement.id), false, "deleting events removes linked delays");
  assert.equal((await api(`/api/schedule/${created.id}`, { method: "DELETE", revision })).status, 404);

  const scheduledAt = new Date(Date.now() + 1800000).toISOString();
  const announcement = await (await save("/api/announcements", "POST", { title: "Synthetic scheduled update", body: "Staff editorial draft", priority: "urgent", pinned: true, scheduledAt })).json();
  for (const query of ["", "?include_future=true", `?at=${encodeURIComponent(new Date(Date.now() + 3600000).toISOString())}&include_future=true`]) {
    assert.equal((await live(false, query)).announcements.some(a => a.id === announcement.id), false, "public preview bypass denied");
  }
  assert.equal((await live(true, "?include_future=true")).announcements.find(a => a.id === announcement.id).pinned, true);
  const exportedResponse = await api("/api/publishing/export");
  assert.equal(exportedResponse.headers.get("cache-control"), "no-store");
  const exported = await exportedResponse.json();
  assert.deepEqual(Object.keys(exported).sort(), ["announcements", "delays", "schedule"]);
  assert.ok(exported.announcements.some(a => a.id === announcement.id));
  assert.equal((await api("/api/email/subscribe", { method: "POST", body: { email: "synthetic@example.invalid" }, auth: false })).status, 200);
  assert.ok(!await readFile(join(repo, "operations.json"), "utf8").then(text => text.includes("synthetic@example.invalid")));
  assert.ok(!JSON.stringify(exported).includes("subscriber"));
  await save(`/api/announcements/${announcement.id}`, "PUT", { title: "Published", body: "Now public", priority: "normal", pinned: true });
  assert.ok((await live()).announcements.some(a => a.id === announcement.id));
  await save(`/api/announcements/${announcement.id}`, "DELETE");
  assert.equal((await live()).announcements.some(a => a.id === announcement.id), false);
  assert.equal((await status()).healthy, true);
  assert.equal(await git(repo, "status", "--porcelain"), "");
});

test("commit failure and timeout never expose uncommitted content or discard drafts", async t => {
  const { repo, start, commit } = await setup(t);
  const { api, live, status } = await start();
  const before = await live();
  const input = { ...fixture().schedule[0], title: "Unconfirmed draft" };
  delete input.id;
  const hook = join(repo, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n"); await chmod(hook, 0o755);
  assert.equal((await api("/api/schedule/round", { method: "PUT", body: input, revision: before.operationRevision })).status, 503);
  assert.equal((await live()).schedule[0].title, before.schedule[0].title);
  assert.ok((await readFile(join(repo, "operations.json"), "utf8")).includes(input.title));
  let health = await status();
  assert.equal(health.dirty, true); assert.ok(health.lastFailure);
  assert.equal((await api("/api/publishing/restore", { method: "POST", body: { revision: before.operationRevision }, revision: before.operationRevision })).status, 409);
  assert.equal((await api("/api/schedule/round", { method: "PUT", body: input, revision: before.operationRevision })).status, 409);
  // Recover by committing the retained draft, never resetting it.
  await rm(hook); await git(repo, "commit", "-m", "Review retained failed draft");
  let current = await eventually(live, value => value.schedule[0].title === input.title, "retained draft publication");
  await writeFile(hook, "#!/bin/sh\nsleep 8\n"); await chmod(hook, 0o755);
  const started = Date.now();
  assert.equal((await api("/api/schedule/round", { method: "PUT", body: { ...input, title: "Timeout draft" }, revision: current.operationRevision })).status, 503);
  assert.ok(Date.now() - started < 10000, "Git hook has bounded timeout");
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal((await live()).schedule[0].title, input.title, "no late hook commit after timeout");
  assert.equal(await git(repo, "rev-parse", "HEAD"), current.operationRevision);
  await rm(hook);
  // A killed Git command may leave a lock. Only the test operator, after proving
  // the process group is gone and HEAD did not move, removes that stale lock.
  assert.ok((await status()).issues.some(issue => issue.kind === "index_locked"));
  await rm(join(repo, ".git/index.lock"), { force: true });
  await git(repo, "commit", "-m", "Review timed out draft");
  current = await eventually(live, value => value.schedule[0].title === "Timeout draft", "timeout recovery");
  // A later invalid committed HEAD must retain the last valid snapshot.
  const invalid = await commit("{broken", "Invalid JSON direct commit");
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal((await live()).operationRevision, current.operationRevision);
  health = await status();
  assert.equal(health.head, invalid); assert.equal(health.dirty, false);
  assert.ok(health.issues.some(issue => issue.kind === "invalid_head"));
  // Restore is a forward commit based on the invalid HEAD, not a reset.
  const restored = await api("/api/publishing/restore", { method: "POST", body: { revision: before.operationRevision }, revision: invalid });
  assert.equal(restored.status, 200);
  const restoredRevision = (await restored.json()).revision;
  assert.notEqual(restoredRevision, before.operationRevision);
  assert.equal(await git(repo, "rev-parse", "HEAD^"), invalid);
  assert.equal((await live()).schedule[0].title, before.schedule[0].title);
  assert.equal((await status()).healthy, true);
});

test("direct valid commits, dirty recovery, scheduled visibility and verified explicit push", async t => {
  const { repo, remote, start, commit } = await setup(t);
  const { api, live, status } = await start();
  const original = (await live()).operationRevision;
  const direct = fixture();
  direct.schedule[0].title = "Direct committed title";
  direct.announcements.push({ id: "due-soon", title: "Due soon", body: "Synthetic scheduled", timestamp: new Date().toISOString(), scheduledAt: new Date(Date.now() + 7000).toISOString(), priority: "normal" });
  const changed = await commit(direct);
  assert.equal((await api("/api/schedule/round", { method: "PUT", body: direct.schedule[0], revision: original })).status, 409);
  await eventually(live, value => value.operationRevision === changed, "valid direct commit publication");
  await eventually(live, value => value.announcements.some(a => a.id === "due-soon"), "scheduled update visible when due without another commit");
  assert.equal((await status()).lastPush, null, "local publication is not remote backup");
  assert.equal((await api("/api/publishing/push", { method: "POST", revision: original })).status, 409);
  const pushed = await api("/api/publishing/push", { method: "POST", revision: changed });
  assert.equal(pushed.status, 200);
  const verified = await pushed.json();
  assert.equal(verified.revision, changed); assert.ok(verified.verifiedAt);
  assert.equal(await git(remote, "rev-parse", "refs/heads/live"), changed);
  assert.equal((await status()).lastPush.ok, true);
  // Untracked staff edits block publication and push but are never removed.
  const note = join(repo, "staff-review.txt");
  await writeFile(note, "Synthetic staff edit; retain");
  assert.equal((await status()).dirty, true);
  assert.equal((await api("/api/publishing/push", { method: "POST", revision: changed })).status, 409);
  assert.equal(await readFile(note, "utf8"), "Synthetic staff edit; retain");
  await git(repo, "add", "staff-review.txt"); await git(repo, "commit", "-m", "Retain staff note");
  const current = await eventually(live, value => value.operationRevision !== changed, "other public-file commit publication");
  // Local bare remote rejection proves that a failed push is not called backup.
  const hook = join(remote, "hooks/pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n"); await chmod(hook, 0o755);
  assert.equal((await api("/api/publishing/push", { method: "POST", revision: current.operationRevision })).status, 503);
  assert.equal((await status()).lastPush.ok, false);
  assert.equal(await git(remote, "rev-parse", "refs/heads/live"), changed);
  assert.equal((await live()).operationRevision, current.operationRevision);
  await rm(hook);
  assert.equal((await api("/api/publishing/push", { method: "POST", revision: current.operationRevision })).status, 200);
  // Unknown nested/private fields cannot reach the public schema.
  const invalid = structuredClone(direct); invalid.schedule[0].privateRoster = ["Synthetic forbidden field"];
  await commit(invalid, "Reject private fields");
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal((await live()).operationRevision, current.operationRevision);
  assert.ok(!JSON.stringify(await live()).includes("privateRoster"));
});

test("visibility is atomic, concurrent stale writes fail, and a valid publication survives restart", async t => {
  const { repo, start } = await setup(t);
  const first = await start();
  const previous = await first.live();
  const hook = join(repo, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nsleep 1\n"); await chmod(hook, 0o755);
  const input = { ...fixture().schedule[0], title: "Atomic committed title" };
  const pending = first.api("/api/schedule/round", { method: "PUT", body: input, revision: previous.operationRevision });
  await eventually(() => readFile(join(repo, "operations.json"), "utf8"), value => value.includes(input.title), "pre-commit worktree write");
  const during = await first.live();
  assert.equal(during.operationRevision, previous.operationRevision);
  assert.equal(during.schedule[0].title, previous.schedule[0].title, "uncommitted disk content is never public");
  const stale = first.api("/api/schedule/round", { method: "PUT", body: { ...input, title: "Stale concurrent edit" }, revision: previous.operationRevision });
  assert.equal((await pending).status, 200);
  assert.equal((await stale).status, 409);
  const published = await first.live();
  assert.notEqual(published.operationRevision, previous.operationRevision);
  assert.equal(await git(repo, "rev-parse", "HEAD"), published.operationRevision);
  assert.equal(published.schedule[0].title, input.title);
  await rm(hook);
  first.child.kill(); await once(first.child, "exit");
  const restarted = await start();
  assert.equal((await restarted.live()).operationRevision, published.operationRevision);
  // Missing operations.json at a later HEAD is invalid, but a forward restore repairs it.
  await git(repo, "rm", "operations.json");
  await git(repo, "commit", "-m", "Accidental removal in disposable test");
  const missing = await git(repo, "rev-parse", "HEAD");
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal((await restarted.live()).operationRevision, published.operationRevision);
  assert.ok((await restarted.status()).issues.some(issue => issue.kind === "invalid_head"));
  const restored = await restarted.api("/api/publishing/restore", { method: "POST", body: { revision: published.operationRevision }, revision: missing });
  assert.equal(restored.status, 200);
  assert.equal(await git(repo, "rev-parse", "HEAD^"), missing);
  assert.equal((await restarted.live()).schedule[0].title, input.title);
});

test("invalid startup and unauthenticated Git configuration fail closed", async t => {
  const first = await setup(t, fixture());
  // Named staff credentials need not use the legacy owner password. Missing identity
  // denies every staff API while allowing the committed public snapshot to be read.
  const anonymous = await first.start({ password: '' });
  assert.equal((await anonymous.api('/api/publishing', { auth: false })).status, 401);
  assert.equal((await anonymous.api('/api/live', { auth: false })).status, 200);
  anonymous.child.kill(); await once(anonymous.child, 'exit');
  await first.commit("{broken", "Startup corruption");
  const retained = await first.start();
  assert.equal((await retained.live()).schedule[0].title, fixture().schedule[0].title);
  retained.child.kill(); await once(retained.child, 'exit');
  await git(first.repo, 'update-ref', '-d', 'refs/live/local-loaded');
  await first.start({ expectFailure: true });
});

test('Markdown local Git pages are actual files, CAS-protected, exported and forward-restored after invalid commits', async t => {
  const f = await setup(t); let s = await f.start();
  const source = await readFile(resolve('content/pages/home.md'), 'utf8');
  const initial = await (await s.api('/api/pages')).json(); assert.deepEqual(initial.files, {});
  const savedResponse = await s.api('/api/pages/editor', { method: 'PUT', body: { revision: initial.revision, files: { 'home.md': source } } });
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text()); const saved = await savedResponse.json();
  assert.equal(await readFile(join(f.repo, 'pages/home.md'), 'utf8'), source);
  assert.equal(await git(f.repo, 'show', `${saved.revision}:pages/home.md`), source.trim());
  assert.ok(!JSON.parse(await readFile(join(f.repo, 'operations.json'), 'utf8')).pages);
  assert.equal((await (await s.api('/api/publishing/export')).json()).pages['home.md'], source);
  assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: { revision: initial.revision, files: {} } })).status, 409);
  await writeFile(join(f.repo, 'pages/home.md'), 'invalid Markdown file');
  await git(f.repo, 'add', 'pages/home.md'); await git(f.repo, 'commit', '-m', 'Synthetic invalid page');
  const invalid = await git(f.repo, 'rev-parse', 'HEAD');
  await eventually(s.status, health => health.issues.some(issue => issue.kind === 'invalid_head'), 'invalid Markdown head');
  assert.equal((await (await s.api('/api/pages')).json()).files['home.md'], source);
  s.child.kill(); await once(s.child, 'exit'); s = await f.start();
  assert.equal((await (await s.api('/api/pages')).json()).revision, saved.revision);
  const restored = await s.api('/api/publishing/restore', { method: 'POST', body: { revision: saved.revision }, revision: invalid });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(await git(f.repo, 'rev-parse', 'HEAD^'), invalid);
  assert.equal(await readFile(join(f.repo, 'pages/home.md'), 'utf8'), source);
  const current = await (await s.api('/api/pages')).json();
  const removed = await s.api('/api/pages/editor', { method: 'PUT', body: { revision: current.revision, files: {} } });
  assert.equal(removed.status, 200, await removed.clone().text());
  assert.equal(await git(f.repo, 'ls-tree', '-r', 'HEAD', '--', 'pages'), '');
});
