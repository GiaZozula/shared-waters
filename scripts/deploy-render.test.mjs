import assert from 'node:assert/strict';
import test from 'node:test';
import { deployRender } from './deploy-render.mjs';

const sha = 'a'.repeat(40);
function fixture(overrides = {}) {
  const calls = [];
  let tick = 0;
  const options = { token: 'fake-render', serviceId: 'srv-local', sha, githubToken: 'fake-github',
    repository: 'GiaZozula/shared-waters', wait: async () => {}, now: () => tick++, timeoutMs: 5,
    request: async (url, init) => {
      calls.push({ url, ...init });
      let body;
      if (url.includes('api.github.com')) body = { object: { sha: overrides.head ?? sha } };
      else if (url.endsWith('/services/srv-local')) body = { autoDeploy: 'no', type: 'web_service', branch: 'main',
        repo: 'https://github.com/GiaZozula/shared-waters', serviceDetails: { plan: 'free' }, ...overrides.service };
      else if (init.method === 'POST') body = { id: 'dep-local' };
      else body = { commit: { id: overrides.commit ?? sha }, status: overrides.status ?? 'live' };
      return Response.json(body);
    } };
  return { options, calls };
}

test('deploys the checked commit and waits for that commit to be live', async () => {
  const { options, calls } = fixture();
  assert.deepEqual(await deployRender(options), { id: 'dep-local', sha });
  assert.deepEqual(JSON.parse(calls.find(c => c.method === 'POST').body), { commitId: sha, clearCache: 'do_not_clear' });
  assert.ok(calls.every(c => c.redirect === 'error'));
  assert.equal(calls.find(c => c.url.includes('github.com')).headers.Authorization, 'Bearer fake-github');
  assert.ok(calls.filter(c => c.url.includes('render.com')).every(c => c.headers.Authorization === 'Bearer fake-render'));
});

for (const [name, overrides] of [
  ['old repository still connected', { service: { repo: 'https://github.com/GiaZozula/SharedWaters' } }],
  ['superseded commit', { head: 'b'.repeat(40) }],
  ['automatic deployment still enabled', { service: { autoDeploy: 'yes' } }],
  ['wrong service/paid plan', { service: { serviceDetails: { plan: 'starter' } } }],
]) test(`refuses to trigger deployment: ${name}`, async () => {
  const { options, calls } = fixture(overrides);
  await assert.rejects(deployRender(options));
  assert.ok(!calls.some(c => c.method === 'POST'));
});

for (const overrides of [{ commit: 'b'.repeat(40) }, { status: 'build_failed' }, { status: 'build_in_progress' }]) {
  test(`fails closed on mismatched, failed or timed-out deployment: ${JSON.stringify(overrides)}`, async () => {
    const { options } = fixture(overrides);
    await assert.rejects(deployRender(options));
  });
}

test('rejects the old repository configuration before making any requests', async () => {
  const { options, calls } = fixture();
  await assert.rejects(deployRender({ ...options, repository: 'GiaZozula/SharedWaters' }));
  assert.equal(calls.length, 0);
});
