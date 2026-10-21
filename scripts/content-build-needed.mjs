import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Opt-in only after the deployment owner verifies runtime reload on every serving instance.
// Unknown/missing diffs build conservatively; manual dispatch always builds.
export function buildNeeded({ enabled, event, before, changed }) {
  return enabled !== 'true' || event !== 'push' || !/^[a-f0-9]{40}$/.test(before ?? '') || /^0+$/.test(before)
    || !Array.isArray(changed) || changed.length === 0 || changed.some(path => !path.startsWith('content/'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { LIVE_CONTENT_RUNTIME_RELOAD: enabled, GITHUB_EVENT_NAME: event, BEFORE_SHA: before, GITHUB_SHA: after } = process.env;
  let changed;
  if (/^[a-f0-9]{40}$/.test(before ?? '') && /^[a-f0-9]{40}$/.test(after ?? '')) {
    try { changed = execFileSync('git', ['diff', '--name-only', '-z', before, after], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
    catch { /* A missing base/object must never skip a required build. */ }
  }
  console.log(`build=${buildNeeded({ enabled, event, before, changed })}`);
}
