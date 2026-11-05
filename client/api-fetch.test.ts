import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiFetch } from './api-fetch.js';
import { apiOrigin } from '../shared/api-origin.js';

test('the API base routes question, evidence, Live and status reads with credentials while preserving options', async () => {
  const calls: { input: unknown; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => { calls.push({ input, init }); return new Response('{}'); };
  const signal = new AbortController().signal;
  const request = createApiFetch('https://api.shared-waters.giazozula.com/', transport);
  for (const path of ['/api/ask', '/api/query/evidence?id=whoi%3Aone', '/api/current/ais', '/api/health']) {
    await request(path, { method: 'POST', body: '{}', signal, cache: 'no-store', credentials: 'omit' });
    const call = calls.at(-1)!;
    assert.equal(call.input, `https://api.shared-waters.giazozula.com${path}`);
    assert.equal(call.init?.credentials, 'include');
    assert.equal(call.init?.signal, signal);
    assert.equal(call.init?.body, '{}');
    assert.equal(call.init?.cache, 'no-store');
  }
  await createApiFetch('', transport)('/api/health');
  assert.equal(calls.at(-1)?.input, '/api/health');
});

test('API configuration refuses credentials, paths, queries, wildcards and insecure remote origins', () => {
  for (const origin of ['https://user:secret@example.com', 'https://example.com/api', 'https://example.com?q=x',
    'https://example.com#x', 'http://remote.example', '*', 'https://*.example.com']) {
    assert.throws(() => apiOrigin(origin), origin);
  }
  assert.equal(apiOrigin('http://localhost:3001'), 'http://localhost:3001');
  const request = createApiFetch('https://api.example.com');
  for (const path of ['//host/api/ask', 'https://host/api/ask', '/assets/a.js', '/api/../private', '/api/\\private']) {
    assert.throws(() => request(path), path);
  }
});
