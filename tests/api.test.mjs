import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const binary = resolve("server/target/debug/server");
const initial = await readFile(
  new URL("../content/event.json", import.meta.url),
  "utf8",
);

async function launch(t, password) {
  const directory = await mkdtemp(join(tmpdir(), "live-api-test-"));
  const path = join(directory, "event.json");
  await writeFile(path, initial);
  const child = spawn(binary, [], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      EVENT_CONTENT_PATH: path,
      SITE_CONTENT_PATH: resolve('content/site.json'),
      WAYFINDING_CONTENT_PATH: resolve('content/wayfinding.json'),
      ...(password ? { ADMIN_PASSWORD: password } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(directory, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timed out")),
      10000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Server exited ${code}`)));
    child.stdout.on("data", (bytes) => {
      const match = String(bytes).match(/Server listening on \[::\]:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const api = (endpoint, { method = "GET", body, auth = true } = {}) =>
    fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(password && auth
          ? {
              Authorization:
                "Basic " + Buffer.from(`staff:${password}`).toString("base64"),
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  return { api, path };
}

test("content and legacy APIs work together on an isolated database", async (t) => {
  const { api, path } = await launch(t, "local-tests-only");
  let document;
  await t.test(
    "public payload keeps every legacy field and adds event metadata",
    async () => {
      const response = await api("/api/live", { auth: false });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const live = await response.json();
      for (const field of [
        "schedule",
        "announcements",
        "delays",
        "venues",
        "info",
      ])
        assert.ok(Array.isArray(live[field]), field);
      assert.equal(live.event.date, JSON.parse(initial).date);
      assert.ok(live.schedule.length > 0);
      assert.ok(live.lastUpdated);
      document = await (await api("/api/content")).json();
    },
  );
  await t.test("admin reads and writes require authentication", async () => {
    // The SPA sign-in shell is public; all protected data remains fail-closed.
    for (const endpoint of ["/api/content", "/api/site/editor", "/api/wayfinding/editor", "/api/lost-found/staff"])
      assert.equal((await api(endpoint, { auth: false })).status, 401);
    assert.equal(
      (
        await api("/api/content", {
          method: "PUT",
          body: document,
          auth: false,
        })
      ).status,
      401,
    );
  });
  await t.test(
    "publishing changes the public API and the same editable JSON file",
    async () => {
      const response = await api("/api/content", {
        method: "PUT",
        body: {
          ...document,
          content: { ...document.content, title: "API test event" },
        },
      });
      assert.equal(response.status, 200);
      const next = await response.json();
      assert.notEqual(next.revision, document.revision);
      assert.equal(
        (await (await api("/api/live", { auth: false })).json()).event.title,
        "API test event",
      );
      assert.equal(
        JSON.parse(await readFile(path, "utf8")).title,
        "API test event",
      );
    },
  );
  await t.test("a stale editor cannot overwrite a publication", async () => {
    assert.equal(
      (await api("/api/content", { method: "PUT", body: document })).status,
      409,
    );
    document = await (await api("/api/content")).json();
  });
  await t.test(
    "validation failures leave both disk and public content unchanged",
    async () => {
      const before = await readFile(path, "utf8");
      const response = await api("/api/content", {
        method: "PUT",
        body: {
          ...document,
          content: { ...document.content, date: "2026-02-30" },
        },
      });
      assert.equal(response.status, 422);
      assert.equal(await readFile(path, "utf8"), before);
    },
  );
  await t.test(
    "external file edits become live automatically and invalidate drafts",
    async () => {
      await writeFile(
        path,
        JSON.stringify({ ...document.content, title: "Direct file edit" }),
      );
      assert.equal(
        (await api("/api/content", { method: "PUT", body: document })).status,
        409,
      );
      const deadline = Date.now() + 7000;
      let title;
      while (Date.now() < deadline) {
        title = (await (await api("/api/live", { auth: false })).json()).event
          .title;
        if (title === "Direct file edit") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(title, "Direct file edit");
      document = await (await api("/api/content")).json();
    },
  );
  await t.test(
    "invalid files preserve the last good public copy and block saves",
    async () => {
      await writeFile(path, "{broken");
      assert.equal((await api("/api/content")).status, 503);
      assert.equal(
        (await (await api("/api/live", { auth: false })).json()).event.title,
        "Direct file edit",
      );
      assert.equal(
        (await api("/api/content", { method: "PUT", body: document })).status,
        409,
      );
      await writeFile(path, JSON.stringify(document.content));
      assert.equal((await api("/api/content")).status, 200);
    },
  );
  await t.test(
    "existing schedule and delay creation, editing and removal still work",
    async () => {
      const input = {
        title: "Test round",
        startTime: "10:00",
        endTime: "11:00",
        location: "Test room",
        category: "team",
      };
      const created = await api("/api/schedule", {
        method: "POST",
        body: input,
      });
      assert.ok(created.ok);
      const entry = await created.json();
      assert.equal(
        (
          await api(`/api/schedule/${entry.id}`, {
            method: "PUT",
            body: { ...input, title: "Edited round" },
          })
        ).status,
        200,
      );
      const delayed = await api("/api/delays", {
        method: "POST",
        body: {
          eventId: entry.id,
          newTime: "10:15",
          newEndTime: "11:15",
          reason: "Test delay",
        },
      });
      assert.ok(delayed.ok);
      const delay = await delayed.json();
      let live = await (await api("/api/live")).json();
      assert.equal(
        live.schedule.find((item) => item.id === entry.id).title,
        "Edited round",
      );
      assert.equal(
        live.delays.find((item) => item.eventId === entry.id).newTime,
        "10:15",
      );
      assert.equal(
        (await api(`/api/delays/${delay.id}`, { method: "DELETE" })).status,
        200,
      );
      assert.equal(
        (await api(`/api/schedule/${entry.id}`, { method: "DELETE" })).status,
        200,
      );
      live = await (await api("/api/live")).json();
      assert.equal(
        live.schedule.some((item) => item.id === entry.id),
        false,
      );
    },
  );
  await t.test(
    "public query parameters cannot reveal future announcements; staff still can",
    async () => {
      const scheduledAt = new Date(Date.now() + 3600000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      const response = await api("/api/announcements", {
        method: "POST",
        body: {
          title: "Future test",
          body: "Not published yet",
          scheduledAt,
          pinned: true,
        },
      });
      assert.ok(response.ok);
      const announcement = await response.json();
      for (const query of [
        "",
        "?include_future=true",
        `?at=${encodeURIComponent(new Date(Date.now() + 7200000).toISOString())}`,
      ]) {
        const live = await (
          await api(`/api/live${query}`, { auth: false })
        ).json();
        assert.equal(
          live.announcements.some((item) => item.id === announcement.id),
          false,
        );
      }
      const staff = await (await api("/api/live?include_future=true")).json();
      assert.ok(
        staff.announcements.some((item) => item.id === announcement.id),
      );
      assert.equal(
        (
          await api(`/api/announcements/${announcement.id}`, {
            method: "PUT",
            body: {
              title: "Published test",
              body: "Published now",
              priority: "urgent",
              pinned: true,
            },
          })
        ).status,
        200,
      );
      const live = await (await api("/api/live", { auth: false })).json();
      assert.equal(
        live.announcements.find((item) => item.id === announcement.id).priority,
        "urgent",
      );
      assert.equal(
        (
          await api(`/api/announcements/${announcement.id}`, {
            method: "DELETE",
          })
        ).status,
        200,
      );
    },
  );
  await t.test("SQLite export is an authenticated migration path, not a Git-backup claim", async () => {
    const response = await api("/api/publishing");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { mode: "sqlite" });
    const exported = await (await api("/api/publishing/export")).json();
    assert.deepEqual(Object.keys(exported).sort(), ["announcements", "delays", "schedule"]);
    assert.equal((await api("/api/publishing/export", { auth: false })).status, 401);
    assert.equal((await api("/api/publishing/push", { method: "POST" })).status, 409);
    assert.equal((await api("/api/publishing/restore", { method: "POST", body: { revision: "0".repeat(40) } })).status, 409);
  });
  await t.test(
    "email subscription API remains available with Postmark disabled",
    async () => {
      const response = await api("/api/email/subscribe", {
        method: "POST",
        body: { email: "local-test@example.invalid" },
        auth: false,
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.emailDeliveryEnabled, false);
      assert.match(result.message, /unavailable/);
      const repeated = await (await api('/api/email/subscribe', { method: 'POST', body: { email: 'local-test@example.invalid' }, auth: false })).json();
      assert.equal(repeated.emailDeliveryEnabled, false);
      assert.match(repeated.message, /unavailable/);
    },
  );
});

test("all publishing endpoints fail closed without a staff identity", async (t) => {
  const { api } = await launch(t);
  assert.equal((await api('/api/content')).status, 401);
  const document = { revision: '0'.repeat(64), content: JSON.parse(initial) };
  for (const endpoint of ["/api/publishing", "/api/publishing/export"]) {
    assert.equal((await api(endpoint)).status, 401);
  }
  for (const endpoint of ["/api/publishing/push", "/api/publishing/restore"]) {
    assert.equal((await api(endpoint, { method: "POST", body: { revision: "0".repeat(40) } })).status, 401);
  }
  assert.equal(
    (await api("/api/content", { method: "PUT", body: document })).status,
    401,
  );
});
