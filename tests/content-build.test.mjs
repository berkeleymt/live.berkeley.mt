import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildNeeded } from '../scripts/content-build-needed.mjs';
const context = { enabled: 'true', event: 'push', before: 'a'.repeat(40), changed: ['content/event.json', 'content/media/image.png'] };

test('content-only image/deployment skip is opt-in; code, manual dispatch and uncertainty still build', () => {
  assert.equal(buildNeeded(context), false);
  for (const override of [{ enabled: undefined }, { enabled: 'false' }, { event: 'workflow_dispatch' }, { before: undefined }, { before: '0'.repeat(40) }, { changed: undefined }, { changed: [] }, { changed: ['content/site.json', 'src/main.tsx'] }, { changed: ['content-tools.js'] }, { changed: ['.github/workflows/build-and-push.yaml'] }]) assert.equal(buildNeeded({ ...context, ...override }), true, JSON.stringify(override));
  assert.equal(buildNeeded({ ...context, changed: ['content/filename\nwith-newline.json'] }), false);
});

test('build filter CLI is conservative without a usable Git base and workflow gates both build and deploy', async () => {
  const output = execFileSync(process.execPath, ['scripts/content-build-needed.mjs'], { encoding: 'utf8', env: { ...process.env, LIVE_CONTENT_RUNTIME_RELOAD: 'true', GITHUB_EVENT_NAME: 'push', BEFORE_SHA: 'a'.repeat(40), GITHUB_SHA: 'b'.repeat(40) } });
  assert.equal(output, 'build=true\n');
  const workflow = await readFile('.github/workflows/build-and-push.yaml', 'utf8');
  assert.match(workflow, /vars.LIVE_CONTENT_RUNTIME_RELOAD/);
  assert.match(workflow, /if: needs.changes.outputs.build == 'true'/);
  assert.match(workflow, /deploy:\s+needs: build/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.ok(!workflow.startsWith('concurrency:'));
  assert.match(workflow, /group: \$\{\{ github.workflow \}\}-build/);
});
