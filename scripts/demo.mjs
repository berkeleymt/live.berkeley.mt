#!/usr/bin/env node
// Reproducible local sandbox. No credentials, network Git remotes, resets, or process discovery.
import { mkdir, readFile, readdir, writeFile, access, realpath } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
const exec = promisify(execFile);
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const safeEnv = () =>
  Object.fromEntries(
    ["PATH", "HOME", "USER", "TMPDIR", "RUSTUP_HOME", "CARGO_HOME"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
const gitEnv = () => ({
  ...safeEnv(),
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "BMT demo",
  GIT_AUTHOR_EMAIL: "demo@example.invalid",
  GIT_COMMITTER_NAME: "BMT demo",
  GIT_COMMITTER_EMAIL: "demo@example.invalid",
});
async function git(cwd, ...args) {
  return (
    await exec("git", args, { cwd, env: gitEnv(), timeout: 15000 })
  ).stdout.trim();
}
export async function prepareSandbox(directory) {
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== resolve(directory))
    throw new Error("Sandbox must not be a symbolic link.");
  await writeFile(
    join(directory, ".env"),
    "# Intentionally empty: do not inherit application or production secrets.\n",
    { flag: "wx" },
  ).catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  const repo = join(directory, "content");
  const remote = join(directory, "backup.git");
  await mkdir(repo, { recursive: true });
  await mkdir(join(directory, "media"), { recursive: true });
  for (const name of await readdir(join(root, "content/media"))) {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name)) continue;
    const destination = join(directory, "media", name);
    if (!(await exists(destination))) await writeFile(destination, await readFile(join(root, "content/media", name)), { flag: 'wx' });
  }
  const event = await json(join(root, "content/bmt-2026.example.json"));
  event.notice =
    "Demo · Sample schedule, rooms and routes. Not official tournament information. Email is off.";
  event.faqs = [
    {
      question: "How do I find my room?",
      answer:
        "Open [My rooms](/rooms) and enter your student ID. Try **DEMO-1001** for sample assignments, then choose Directions beside a round.",
    },
    {
      question: "How do I get to campus?",
      answer:
        "Plan your trip with [TakeTransit](https://taketransit.berkeley.mt/). Allow time to find your building and check in before your first round.",
    },
    {
      question: "I lost something. What should I do?",
      answer:
        "Send a [private lost-and-found report](/lost-found) or ask the information desk. Only authorized staff can read your report.",
    },
  ];
  const site = await json(join(root, "content/site.json"));
  site.help = site.help.map(block => ({ ...block, markdown: ({
    wifi: 'Guest network: **BMT-Demo**. Open your Wi-Fi settings, choose the network and follow the sign-in screen. Ask the information desk if you need help.',
    'information-desk': '**Demo Learning Center, ground-floor lobby** · 8:00 am–4:00 pm. Ask us about rooms, the schedule, accessibility or lost items.',
    restrooms: 'In the sample building, restrooms are on the ground floor beside the lobby. The accessible restroom is opposite A101. A volunteer can help you find it.',
  })[block.id] ?? block.markdown }));
  const wayfinding = await json(join(root, "content/wayfinding.json"));
  for (const [name, value] of Object.entries({ event, site, wayfinding })) {
    const path = join(directory, `${name}.json`);
    if (!(await exists(path)))
      await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
      });
  }
  if (!(await exists(join(repo, ".git")))) {
    if (await exists(join(repo, "operations.json")))
      throw new Error(
        "Unversioned operations.json exists; refusing to overwrite it.",
      );
    await git(repo, "init", "--initial-branch=live");
    const schedule = [
      {
        id: "arrival",
        title: "Welcome & check-in",
        startTime: "08:00",
        endTime: "09:00",
        category: "general",
      },
      {
        id: "puzzle",
        title: "Puzzle round",
        startTime: "09:00",
        endTime: "10:00",
        category: "team",
      },
      {
        id: "individual",
        title: "Individual round",
        startTime: "10:00",
        endTime: "11:00",
        category: "individual",
      },
      {
        id: "lunch",
        title: "Lunch break",
        startTime: "11:00",
        endTime: "12:00",
        category: "general",
      },
      {
        id: "team",
        title: "Team round",
        startTime: "12:00",
        endTime: "13:00",
        category: "team",
      },
      {
        id: "relay",
        title: "Relay round",
        startTime: "13:15",
        endTime: "14:00",
        category: "team",
      },
      {
        id: "awards",
        title: "Awards & farewell",
        startTime: "15:00",
        endTime: "16:00",
        category: "ceremony",
      },
    ].map((row) => ({
      ...row,
      location: "Demo Learning Center",
      description:
        ({ arrival: 'Check in with your coach and keep your student ID handy.', lunch: 'Take a break and meet your team before the afternoon rounds.', awards: 'Join the closing celebration with your team and family.' })[row.id] ?? 'Check My rooms for your assigned room. Arrive a few minutes early and follow your proctor’s instructions.',
    }));
    const announcements = [
      {
        id: "demo-welcome",
        title: "Welcome to BMT",
        body: "Find your [rooms](/rooms), check the [schedule](/schedule) and keep an eye here for announcements. Need a hand? Ask a volunteer or visit the information desk.",
        timestamp: "2026-01-01T08:00:00Z",
        priority: "normal",
        pinned: true,
      },
      {
        id: "demo-future",
        title: "Ready for the first round?",
        body: "Have your pencils and student ID ready. Check [My rooms](/rooms) for your first room, and follow your proctor’s instructions when you arrive.",
        timestamp: "2026-01-01T08:00:00Z",
        scheduledAt: "2026-11-14T17:00:00Z",
        priority: "normal",
        pinned: false,
      },
    ];
    await writeFile(
      join(repo, "operations.json"),
      JSON.stringify(
        {
          schedule,
          delays: [],
          announcements,
          editorial: { event, site, wayfinding },
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    // Only a genuinely new sandbox gets shipped authored pages. Persisted installs
    // use the explicit conversion preview in Website content; no staff file is replaced.
    const pages = join(repo, 'pages');
    if (await exists(pages)) throw new Error('Unversioned pages exist; refusing to replace them.');
    await mkdir(pages);
    for (const name of await readdir(join(root, 'content/pages'))) {
      if (!/^[a-z0-9-]{1,64}\.md$/.test(name)) continue;
      await writeFile(join(pages, name), await readFile(join(root, 'content/pages', name)), { flag: 'wx' });
    }
    await git(repo, "add", "operations.json", "pages");
    await git(repo, "commit", "-m", "Initialize synthetic November BMT demo");
  }
  if (!(await exists(remote))) await git(directory, "init", "--bare", remote);
  const remotes = await git(repo, "remote");
  if (!remotes.split("\n").includes("origin"))
    await git(repo, "remote", "add", "origin", remote);
  if (
    (await git(repo, "remote", "get-url", "origin")) !== remote ||
    (await git(repo, "remote", "get-url", "--push", "origin")) !== remote
  )
    throw new Error(
      "Demo origin must be its local backup.git; refusing a network remote.",
    );
  return {
    ...gitEnv(),
    DEMO_MODE: "true",
    HOST: "127.0.0.1",
    PORT: process.env.DEMO_PORT ?? "3091",
    DATABASE_PATH: join(directory, "data.db"),
    PRIVATE_DB_PATH: join(directory, "private.db"),
    EVENT_CONTENT_PATH: join(directory, "event.json"),
    SITE_CONTENT_PATH: join(directory, "site.json"),
    WAYFINDING_CONTENT_PATH: join(directory, "wayfinding.json"),
    SITE_MEDIA_DIR: join(directory, "media"),
    PAGES_CONTENT_DIR: join(repo, 'pages'),
    LIVE_CONTENT_REPO: repo,
    STATIC_DIR: join(root, "dist"),
    POSTMARK_SERVER_TOKEN: "",
    POSTMARK_FROM_ADDRESS: "",
    ADMIN_PASSWORD: "",
    STAFF_COOKIE_SECURE: "false",
  };
}
async function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  try {
    await new Promise((resolveRun, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolveRun()
          : reject(new Error(`${command} ended (${signal ?? code})`)),
      );
    });
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  }
}
async function main() {
  const directory = resolve(process.env.DEMO_ROOT || join(root, ".demo"));
  const env = await prepareSandbox(directory);
  if (process.argv.includes("--prepare-only")) {
    console.log(`Prepared persistent sandbox at ${directory}`);
    return;
  }
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("DEMO_PORT must be a port number.");
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Choose DEMO_PORT=3092; no existing process was stopped.`,
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(resolvePort));
  });
  if (!process.argv.includes("--no-build")) {
    await run("npm", ["run", "build"], {
      ...safeEnv(),
      VITE_API_URL: "/api/live",
    });
    await run(
      "cargo",
      ["build", "--locked", "--manifest-path", join(root, "server/Cargo.toml")],
      safeEnv(),
    );
  }
  console.log(
    `\nBMT local demo: http://127.0.0.1:${port}/\nStaff: /staff/sign-in → choose a synthetic role (no password).\nRooms: DEMO-1001 (ID only; fictional routes)\nPersistent data: ${directory}\nGit backup is local only. Email is disabled. Ctrl-C stops only this child server.\n`,
  );
  const child = spawn(join(root, "server/target/debug/server"), [], {
    cwd: directory,
    env,
    stdio: "inherit",
  });
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 || signal === "SIGTERM"
        ? resolveExit()
        : reject(new Error(`Demo server exited ${code}`)),
    );
  });
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
