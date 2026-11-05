import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3001';
const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { api: 'connected', database: 'connected' });
const html = await fetch(base);
assert.equal(html.headers.get('cache-control'), 'no-cache');
assert.match(await html.text(), /<html/);
const replay = await fetch(`${base}/api/story/replay`);
assert.equal(replay.status, 200);
const ais = await (await fetch(`${base}/api/current/ais`)).json();
assert.equal(ais.collection.state, 'disabled');
const question = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'Explain the latest evidence' }) });
assert.equal(question.status, 503);
console.log('Container serves static/API reads with collection and paid questions disabled.');
