import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prepareSandbox, root } from "../scripts/demo.mjs";
import { parseSiteDocument } from "../src/features/site/config.ts";
const exec = promisify(execFile);
async function launch(t, sqlite = false) {
  const directory = await mkdtemp(join(tmpdir(), "bmt-integrated-"));
  const env = { ...(await prepareSandbox(directory)), PORT: "0" };
  if (sqlite) delete env.LIVE_CONTENT_REPO;
  const processes = [];
  t.after(async () => {
    for (const child of processes)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit");
      }
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    const child = spawn(join(root, "server/target/debug/server"), [], {
      cwd: directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);
    let output = "";
    child.stderr.on("data", (bytes) => {
      output += bytes;
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(output || "Startup timed out")),
        10000,
      );
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Exited ${code}: ${output}`));
      });
      child.stdout.on("data", (bytes) => {
        const match = String(bytes).match(
          /Server listening on 127.0.0.1:(\d+)/,
        );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const api = (path, { method = "GET", body, session, headers = {} } = {}) =>
      fetch(origin + path, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(session
            ? { Cookie: session.cookie, "X-Staff-CSRF": session.csrf }
            : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    const role = async (accountId) => {
      const res = await api("/api/staff/demo", {
        method: "POST",
        body: { accountId },
        headers: { Origin: origin, "X-Staff-Request": "1" },
      });
      assert.equal(res.status, 200, await res.clone().text());
      const data = await res.json();
      return {
        cookie: res.headers.get("set-cookie").split(";")[0],
        csrf: data.csrfToken,
      };
    };
    return { api, role, child, origin };
  }
  return { ...(await start()), start, directory, env };
}
test('receipt mail settings/actions use Admin and Super authorization, CSRF, and private projections', async t => {
  const { api, role, origin } = await launch(t);
  const admin = await role('demo-operator'); const superAdmin = await role('demo-super');
  const headers = { Origin: origin, 'X-Staff-Request': '1' };
  assert.equal((await api('/api/settings/lost-found-mail')).status, 401);
  assert.equal((await api('/api/settings/lost-found-mail', { session: admin })).status, 403);
  const settings = await expectJson(await api('/api/settings/lost-found-mail', { session: superAdmin }));
  assert.deepEqual(settings, { status: 'not_configured', from: null, replyTo: null, provider: 'Postmark', deliveryTracking: false });
  const report = { idempotencyKey: randomUUID(), kind: 'found', description: 'Private receipt marker 982', location: 'Synthetic desk', occurredAt: 'Noon Pacific', email: 'receipt982@example.invalid', phone: '555-0100', confirmationEmail: true };
  const receipt = await expectJson(await api('/api/lost-found', { method: 'POST', body: report }), 201);
  assert.deepEqual(Object.keys(receipt).sort(), ['emailState', 'receipt']); assert.equal(receipt.emailState, 'not_configured');
  const inbox = await expectJson(await api('/api/lost-found/staff', { session: admin }));
  const item = inbox.reports.find(r => r.receipt === receipt.receipt); assert.ok(item);
  const path = `/api/lost-found/staff/${item.id}/mail`;
  const body = { idempotencyKey: randomUUID(), revision: item.delivery.revision, action: 'handled', note: 'Synthetic manual follow-up in person' };
  assert.equal((await api(path, { method: 'POST', body })).status, 401);
  assert.equal((await api(path, { method: 'POST', body, headers: { ...headers, Cookie: admin.cookie } })).status, 403);
  assert.equal((await api(path, { method: 'POST', body, session: admin, headers: { ...headers, Origin: 'https://foreign.invalid' } })).status, 403);
  const saved = await expectJson(await api(path, { method: 'POST', body, session: admin, headers }));
  assert.equal(saved.delivery.state, 'handled'); assert.equal(saved.delivery.history.length, 1);
  assert.deepEqual(await expectJson(await api(path, { method: 'POST', body, session: admin, headers })), saved);
  assert.equal((await api(path, { method: 'POST', body: { ...body, action: 'retry' }, session: superAdmin, headers })).status, 409);
  assert.deepEqual(await expectJson(await api('/api/lost-found', { method: 'POST', body: report }), 201), { receipt: receipt.receipt, emailState: 'handled' });
  for (const path of ['/api/site', '/api/live', '/api/wayfinding']) {
    const text = await (await api(path)).text();
    for (const secret of ['receipt982@example.invalid', 'Private receipt marker 982', 'Synthetic manual follow-up in person']) assert.ok(!text.includes(secret));
  }
});

test('ContestDojo settings, private mappings and ID-only projection use real staff middleware', async t => {
  const {api,role,origin} = await launch(t);
  const admin=await role('demo-operator'); const superAdmin=await role('demo-super');
  const headers={ Origin: origin, 'X-Staff-Request':'1' };
  const write=(session,body)=>({session,body,method:'POST',headers});
  assert.equal((await api('/api/roster')).status,401);
  assert.equal((await api('/api/settings/contestdojo',{session:admin})).status,403);
  let settings=await expectJson(await api('/api/settings/contestdojo',{session:superAdmin})); assert.equal(settings.token,undefined);
  let state=await expectJson(await api('/api/roster',{session:admin})); assert.equal(state.count,1); assert.ok(state.columns.includes('number'));
  assert.equal((await api('/api/roster/mapping',{method:'POST',body:{revision:state.revision,mapping:state.mapping},session:admin})).status,403);
  const res=await api('/api/rooms/lookup',{method:'POST',body:{studentId:' demo-1001 '}});
  assert.equal(res.headers.get('cache-control'),'private, no-store'); assert.equal(res.headers.get('referrer-policy'),'no-referrer');
  const found=await expectJson(res); assert.equal(found.assignments.length,2); assert.ok(found.assignments.every(a=>a.status==='matched' && a.scheduleId));
  for (const key of ['number','name','team','org','contact','studentId','token','rows']) assert.ok(!Object.keys(found).includes(key)); assert.ok(!JSON.stringify(found).includes('Synthetic Student'));
  for (const a of found.assignments) assert.deepEqual(Object.keys(a).sort(),['endTime','roomId','round','scheduleId','startTime','status']);
  const unknown=await api('/api/rooms/lookup',{method:'POST',body:{studentId:'unknown'}}); const malformed=await api('/api/rooms/lookup',{method:'POST',body:{name:'anything'}}); assert.equal(unknown.status,404); assert.equal(await unknown.text(),await malformed.text());
  assert.equal((await api('/api/rooms/lookup',{method:'POST',body:{studentId:'DEMO-1001'},headers:{Origin:'https://elsewhere.invalid'}})).status,403);
  const original=structuredClone(state.mapping); const rounds=Object.keys(original.roomColumns);
  const variants=[
    {...original,roomColumns:Object.fromEntries(rounds.map(id=>[id,original.roomColumns[rounds[0]]]))},
    {...original,roomColumns:{...original.roomColumns,[rounds[0]]:''}},
    {...original,fields:{tests:'number'}},
  ];
  for (let n=0;n<variants.length;n++) {
    await expectJson(await api('/api/roster/mapping',write(admin,{revision:state.revision,mapping:variants[n]})));
    const result=await expectJson(await api('/api/rooms/lookup',{method:'POST',body:{studentId:'DEMO-1001'}}));
    assert.equal(result.assignments.length,[2,1,0][n]);
    if (n===0) assert.equal(result.assignments[0].roomId,result.assignments[1].roomId);
    state=await expectJson(await api('/api/roster',{session:admin}));
  }
  await expectJson(await api('/api/roster/mapping',write(admin,{revision:state.revision,mapping:original})));
  state=await expectJson(await api('/api/roster',{session:admin}));
  const testId=Object.keys(state.mapping.roomColumns)[0];
  for (const mapping of [{...state.mapping,idColumn:'missing'},{...state.mapping,roomColumns:{unknown:'number'}},{...state.mapping,roomAliases:{UNKNOWN:'not-public'}}]) assert.equal((await api('/api/roster/mapping',write(admin,{revision:state.revision,mapping}))).status,422);
  const badRoom={...state.mapping,roomColumns:{[testId]:'number'}};
  await expectJson(await api('/api/roster/mapping',write(admin,{revision:state.revision,mapping:badRoom})));
  const unmatched=await expectJson(await api('/api/rooms/lookup',{method:'POST',body:{studentId:'DEMO-1001'}})); assert.equal(unmatched.assignments[0].roomId,null); assert.equal(unmatched.assignments[0].status,'unmatched'); assert.ok(!JSON.stringify(unmatched).includes('DEMO-1001'));
  assert.equal((await api('/api/roster/mapping',write(admin,{revision:state.revision,mapping:state.mapping}))).status,409);
  state=await expectJson(await api('/api/roster',{session:admin})); assert.equal(state.unmatchedRoomCount,1);
  settings=await expectJson(await api('/api/settings/contestdojo',{session:superAdmin}));
  await expectJson(await api('/api/settings/contestdojo',{...write(superAdmin,{revision:settings.revision,eventId:'new-synthetic',token:'SYNTHETIC-SECRET-ONLY',autoSync:false}),method:'PUT'}));
  const redacted=await expectJson(await api('/api/settings/contestdojo',{session:superAdmin})); assert.equal(redacted.tokenConfigured,true); assert.ok(!JSON.stringify(redacted).includes('SYNTHETIC-SECRET-ONLY'));
  assert.equal((await expectJson(await api('/api/rooms/status'))).available,false);
  assert.equal((await api('/api/rooms/lookup',{method:'POST',body:{studentId:'DEMO-1001'}})).status,503);
  state=await expectJson(await api('/api/roster/sync',write(admin,{}))); assert.equal(state.count,1); assert.equal(state.eventMatches,true);
  // Legacy endpoint still requires its original check-in code.
  assert.equal((await api('/api/wayfinding/lookup',{method:'POST',body:{studentId:'DEMO-1001'}})).status,422);
  await expectJson(await api('/api/roster/clear',write(admin,{confirm:'CLEAR'}))); assert.equal((await expectJson(await api('/api/rooms/status'))).available,false);
  for(let n=0;n<20;n++) await api('/api/rooms/lookup',{method:'POST',body:{studentId:'limited-synthetic'}});
  const limited=await api('/api/rooms/lookup',{method:'POST',body:{studentId:'limited-synthetic'}}); assert.equal(limited.status,429); assert.equal(limited.headers.get('retry-after'),'600');
});

async function expectJson(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

test("demo launcher honors an isolated DEMO_ROOT and preserves existing publications", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bmt-launcher-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { cwd: root, env: { ...process.env, DEMO_ROOT: directory }, timeout: 30000 };
  const script = join(root, "scripts/demo.mjs");
  const first = await exec(process.execPath, [script, "--prepare-only"], options);
  assert.ok(first.stdout.includes(directory));
  const content = join(directory, "content/operations.json");
  const publication = await readFile(content, "utf8");
  assert.equal(JSON.parse(publication).editorial.event.date, "2026-11-14");
  await exec(process.execPath, [script, "--prepare-only"], options);
  assert.equal(await readFile(content, "utf8"), publication);
});

test("real application demo: roles, private reports, rooms, atomic plans and complete Git publication", async (t) => {
  const app = await launch(t);
  const { api, role, directory } = app;
  const admin = await role("demo-admin");
  const info = await role("demo-info");
  const dispatcher = await role("demo-dispatcher");
  const live = await expectJson(await api("/api/live"));
  assert.equal(live.event.date, "2026-11-14");
  assert.match(live.event.notice, /Demo.*not official tournament information/i);
  for (const path of [
    "/",
    "/schedule",
    "/updates",
    "/map",
    "/faq",
    "/help",
    "/directions",
    "/lookup",
    "/lost-and-found",
    "/guide",
    "/rooms",
    "/lost-found",
    "/admin",
    "/staff/sign-in",
    "/classic",
  ]) {
    const res = await api(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), /text\/html/);
  }
  for (const path of [
    "/api/content",
    "/api/site/editor",
    "/api/wayfinding/editor",
    "/api/publishing",
    "/api/lost-found/staff",
  ])
    assert.equal((await api(path)).status, 401, path);
  assert.equal((await api("/api/publishing", { session: info })).status, 403);
  assert.equal(
    (await api("/api/site/editor", { session: dispatcher })).status,
    403,
  );
  assert.equal(
    (
      await api("/api/schedule/plan/preview", {
        method: "POST",
        session: info,
        body: {},
      })
    ).status,
    403,
  );
  const report = {
    idempotencyKey: randomUUID(),
    kind: "lost",
    description: "Unique synthetic privacy marker 739124",
    location: "Demo A101",
    occurredAt: "November 14 around noon",
    name: "Synthetic family",
    email: "synthetic739124@example.invalid",
  };
  const receipt = await expectJson(
    await api("/api/lost-found", { method: "POST", body: report }),
    201,
  );
  assert.deepEqual(
    await expectJson(
      await api("/api/lost-found", { method: "POST", body: report }),
      201,
    ),
    receipt,
  );
  const inbox = await expectJson(
    await api("/api/lost-found/staff", { session: info }),
  );
  const item = inbox.reports.find((r) => r.receipt === receipt.receipt);
  assert.ok(item);
  const update = {
    idempotencyKey: randomUUID(),
    revision: item.revision,
    status: "contacted",
    notes: "Synthetic family contacted in person; no email was sent.",
  };
  assert.equal(
    (
      await api(`/api/lost-found/staff/${item.id}`, {
        method: "PATCH",
        body: update,
        headers: { Cookie: info.cookie },
      })
    ).status,
    403,
  );
  const saved = await expectJson(
    await api(`/api/lost-found/staff/${item.id}`, {
      method: "PATCH",
      body: update,
      session: info,
    }),
  );
  assert.equal(saved.status, "contacted");
  assert.match(saved.history.at(-1).actor, /demo-info|Demo info/i);
  const lookup = await expectJson(
    await api("/api/wayfinding/lookup", {
      method: "POST",
      body: { studentId: "DEMO-1001", checkInCode: "DEMO-CHECKIN-2026" },
    }),
  );
  assert.ok(lookup.assignments.length);
  assert.equal(lookup.source.mode, "demo");
  assert.notEqual(
    (
      await api("/api/wayfinding/lookup", {
        method: "POST",
        body: { studentId: "DEMO-1001", checkInCode: "wrong" },
      })
    ).status,
    200,
  );

  const plan = {
    fromId: "individual",
    delayMinutes: 30,
    absorbId: "lunch",
    absorbMinutes: 15,
    reason: "Demo: 30 minute delay, lunch absorbs 15.",
  };
  const preview = await expectJson(
    await api("/api/schedule/plan/preview", {
      method: "POST",
      session: dispatcher,
      body: plan,
    }),
  );
  const round = preview.rows.find((r) => r.id === "individual");
  assert.equal(round.afterStart, "10:30");
  assert.equal(round.afterEnd, "11:30");
  assert.equal(preview.rows.find((r) => r.id === "team").afterStart, "12:15");
  assert.equal(
    (
      await api("/api/schedule/plan/apply", {
        method: "POST",
        session: dispatcher,
        body: { revision: preview.revision, plan },
      })
    ).status,
    428,
  );
  const review = {
    revision: preview.revision,
    confirmation: preview.confirmation,
    plan,
  };
  await expectJson(
    await api("/api/schedule/plan/apply", {
      method: "POST",
      session: dispatcher,
      body: review,
    }),
  );
  assert.equal(
    (
      await api("/api/schedule/plan/apply", {
        method: "POST",
        session: dispatcher,
        body: review,
      })
    ).status,
    409,
  );
  assert.equal(
    (await expectJson(await api("/api/live"))).delays.find(
      (d) => d.eventId === "individual",
    ).newTime,
    "10:30",
  );
  const site = parseSiteDocument(
    await expectJson(await api("/api/site/editor", { session: admin })),
  );
  const legacyIntro = site.content.guide.intro;
  site.content.guide.intro = "This compatibility field is no longer the editor.";
  assert.equal((await api('/api/site/editor', { method: 'PUT', session: admin, body: site })).status, 422);
  site.content.guide.intro = legacyIntro;
  site.content.branding.caption = 'Reviewed synthetic shared branding';
  const published = await expectJson(
    await api("/api/site/editor", {
      method: "PUT",
      session: admin,
      body: site,
    }),
  );
  parseSiteDocument(published);
  assert.notEqual(published.revision, site.revision);
  assert.equal(
    (await expectJson(await api("/api/site"))).content.branding.caption,
    site.content.branding.caption,
  );
  assert.equal(
    (
      await api("/api/site/editor", {
        method: "PUT",
        session: admin,
        body: site,
      })
    ).status,
    409,
  );
  const pageDraft = await expectJson(await api('/api/pages/editor', { session: admin }));
  assert.deepEqual(Object.keys(pageDraft.files).sort(), ['faq.md', 'guide.md', 'help.md', 'home.md', 'lost-found.md', 'map.md', 'rooms.md', 'schedule.md', 'updates.md']);
  pageDraft.files['guide.md'] += '\nA reviewed synthetic guide edit.\n';
  const authored = await expectJson(await api('/api/pages/editor', { method: 'PUT', session: admin, body: { revision: pageDraft.revision, files: pageDraft.files } }));
  assert.equal(authored.files['guide.md'], await readFile(join(directory, 'content/pages/guide.md'), 'utf8'));
  const event = await expectJson(await api("/api/content", { session: admin }));
  event.content.subtitle = "Published editorial bundle";
  await expectJson(
    await api("/api/content", { method: "PUT", session: admin, body: event }),
  );
  const directions = await expectJson(
    await api("/api/wayfinding/editor", { session: admin }),
  );
  directions.content.title = "Reviewed demo room directions";
  await expectJson(
    await api("/api/wayfinding/editor", {
      method: "PUT",
      session: admin,
      body: directions,
    }),
  );
  const publishedLive = await expectJson(await api("/api/live"));
  assert.equal(publishedLive.event.subtitle, event.content.subtitle);
  const exported = await expectJson(
    await api("/api/publishing/export", { session: admin }),
  );
  assert.equal(exported.editorial.wayfinding.title, directions.content.title);
  for (const path of [
    "/api/live",
    "/api/site",
    "/api/wayfinding",
    "/api/publishing/export",
    "/api/pages",
  ]) {
    const text = await (
      await api(path, { session: path.endsWith("export") ? admin : undefined })
    ).text();
    assert.doesNotMatch(
      text,
      /synthetic739124|Unique synthetic privacy marker|passwordHash|codeHash|privateRoster/,
    );
  }
  const status = await expectJson(
    await api("/api/publishing", { session: admin }),
  );
  await expectJson(
    await api("/api/publishing/push", {
      method: "POST",
      session: admin,
      headers: { "If-Match": `"${status.revision}"` },
    }),
  );
  const remote = (
    await exec("git", [
      "--git-dir",
      join(directory, "backup.git"),
      "rev-parse",
      "refs/heads/live",
    ])
  ).stdout.trim();
  assert.equal(remote, status.revision);
  const tracked = (
    await exec("git", ["-C", join(directory, "content"), "ls-files"])
  ).stdout.trim();
  assert.equal(tracked, ['operations.json', ...Object.keys(pageDraft.files).sort().map(name => `pages/${name}`)].join('\n'));
  const before = await readFile(
    join(directory, "content/operations.json"),
    "utf8",
  );
  const authoredBefore = await readFile(join(directory, 'content/pages/guide.md'), 'utf8');
  await prepareSandbox(directory);
  assert.equal(await readFile(join(directory, 'content/pages/guide.md'), 'utf8'), authoredBefore, 'existing sandbox pages are never replaced');
  assert.equal(
    await readFile(join(directory, "content/operations.json"), "utf8"),
    before,
  );
  app.child.kill();
  await once(app.child, "exit");
  const restarted = await app.start();
  assert.equal(
    (await expectJson(await restarted.api("/api/live"))).event.subtitle,
    event.content.subtitle,
  );
  const freshAdmin = await restarted.role("demo-admin");
  assert.ok(
    (
      await expectJson(
        await restarted.api("/api/lost-found/staff", { session: freshAdmin }),
      )
    ).reports.some(
      (r) => r.receipt === receipt.receipt && r.status === "contacted",
    ),
  );
});

test("SQLite mode retains atomic plan preview and rejects stale application", async (t) => {
  const { api, role } = await launch(t, true);
  const dispatcher = await role("demo-dispatcher");
  const live = await expectJson(await api("/api/live"));
  const plan = {
    fromId: live.schedule[1].id,
    delayMinutes: 30,
    absorbId: live.schedule.find((e) => /Lunch/.test(e.title)).id,
    absorbMinutes: 15,
    reason: "Synthetic SQLite adjustment",
  };
  const preview = await expectJson(
    await api("/api/schedule/plan/preview", {
      method: "POST",
      session: dispatcher,
      body: plan,
    }),
  );
  const review = {
    revision: preview.revision,
    confirmation: preview.confirmation,
    plan,
  };
  await expectJson(
    await api("/api/schedule/plan/apply", {
      method: "POST",
      session: dispatcher,
      body: review,
    }),
  );
  assert.equal(
    (
      await api("/api/schedule/plan/apply", {
        method: "POST",
        session: dispatcher,
        body: review,
      })
    ).status,
    409,
  );
  const updated = await expectJson(await api("/api/live"));
  assert.equal(updated.delays.length, live.schedule.length - 1);
  assert.ok(!updated.operationRevision);
});
