import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerApiBoundary } from './api-boundary.js';
import { registerApiProtection } from './api-protection.js';
import { visitorIdentity } from './ai-budget.js';

const frontend = 'https://shared-waters.giazozula.com';
const legacy = 'https://shared-waters.onrender.com';
function fixture() {
  const app = Fastify(); let questions = 0; let reads = 0;
  registerApiBoundary(app, { allowedOrigins: [frontend, legacy] });
  registerApiProtection(app);
  app.get('/api/health', async () => ({ reads: ++reads }));
  app.post('/api/ask', async (request, reply) => {
    questions++;
    const identity = visitorIdentity(request.headers.cookie, 'private-test-secret'.repeat(3));
    if (identity.cookie) reply.header('Set-Cookie', identity.cookie);
    return { identity: identity.id };
  });
  return { app, counts: () => ({ questions, reads }) };
}

test('exact credentialed CORS handles JSON preflight before any domain reads or question admission', async () => {
  const f = fixture();
  try {
    const result = await f.app.inject({ method: 'OPTIONS', url: '/api/ask', headers: {
      origin: frontend, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type',
    } });
    assert.equal(result.statusCode, 204);
    assert.equal(result.headers['access-control-allow-origin'], frontend);
    assert.equal(result.headers['access-control-allow-credentials'], 'true');
    assert.equal(result.headers['access-control-allow-headers'], 'Content-Type');
    assert.match(String(result.headers.vary), /Origin/);
    assert.deepEqual(f.counts(), { questions: 0, reads: 0 });
    const get = await f.app.inject({ method: 'OPTIONS', url: '/api/health', headers: {
      origin: frontend, 'access-control-request-method': 'GET',
    } });
    assert.equal(get.statusCode, 204);
  } finally { await f.app.close(); }
});

test('untrusted origins, sibling domains, null origins and preview sites cannot read or spend', async () => {
  const f = fixture();
  try {
    for (const origin of ['https://evil.example', 'https://giazozula.com', 'https://preview.pages.dev',
      `${frontend}.evil.example`, 'null', `${frontend}/`]) {
      for (const method of ['GET', 'POST', 'OPTIONS'] as const) {
        const result = await f.app.inject({ method, url: method === 'GET' ? '/api/health' : '/api/ask',
          headers: { origin, 'content-type': 'application/json', 'access-control-request-method': 'POST' },
          ...(method === 'POST' ? { payload: '{}' } : {}) });
        assert.equal(result.statusCode, 403, `${method} ${origin}`);
        assert.equal(result.headers['access-control-allow-origin'], undefined);
      }
    }
    assert.deepEqual(f.counts(), { questions: 0, reads: 0 });
  } finally { await f.app.close(); }
});

test('allowed-origin questions retain a signed secure host-only cookie and accept its return', async () => {
  const f = fixture();
  try {
    const first = await f.app.inject({ method: 'POST', url: '/api/ask', headers: { origin: frontend }, payload: {} });
    assert.equal(first.statusCode, 200);
    const cookie = String(first.headers['set-cookie']);
    assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
    assert.doesNotMatch(cookie, /Domain=/i);
    const second = await f.app.inject({ method: 'POST', url: '/api/ask',
      headers: { origin: frontend, cookie: cookie.split(';')[0] }, payload: {} });
    assert.equal(second.json().identity, first.json().identity);
    assert.equal(second.headers['set-cookie'], undefined);
    assert.equal(second.headers['access-control-allow-origin'], frontend);
    const bad = await f.app.inject({ method: 'POST', url: '/api/ask',
      headers: { cookie: cookie.split(';')[0] }, payload: {} });
    assert.equal(bad.statusCode, 403);
    const simple = await f.app.inject({ method: 'POST', url: '/api/ask',
      headers: { origin: frontend, 'content-type': 'text/plain' }, payload: '{}' });
    assert.equal(simple.statusCode, 415);
    assert.equal(f.counts().questions, 2);
  } finally { await f.app.close(); }
});

test('cached reads preserve each requesting origin and errors preserve credentialed CORS', async () => {
  const f = fixture();
  try {
    for (const origin of [frontend, legacy]) {
      const result = await f.app.inject({ url: '/api/health', headers: { origin } });
      assert.equal(result.statusCode, 200);
      assert.equal(result.headers['access-control-allow-origin'], origin);
      assert.equal(result.headers.vary, 'Origin');
    }
    assert.equal(f.counts().reads, 1);
    for (const headers of [
      { origin: frontend, 'access-control-request-method': 'DELETE' },
      { origin: frontend, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization' },
      { 'access-control-request-method': 'POST' },
    ]) {
      const result = await f.app.inject({ method: 'OPTIONS', url: '/api/ask', headers });
      assert.equal(result.statusCode, 403);
    }
    const missing = await f.app.inject({ url: '/api/not-found', headers: { origin: frontend } });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['access-control-allow-origin'], frontend);
    assert.equal((await f.app.inject('/api/health')).statusCode, 200);
  } finally { await f.app.close(); }
});
