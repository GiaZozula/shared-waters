import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { observableServerOptions, registerObservability } from './observability.js';
import { registerAgentRoutes } from './test-admission.js';
import { BudgetFailure } from './ai-budget.js';

function fixture(detailLimit = 60) {
  const logs: Record<string, any>[] = [];
  const server = Fastify({ ...observableServerOptions, logger: {
    ...(typeof observableServerOptions.logger === 'object' ? observableServerOptions.logger : {}),
    stream: { write: (line: string) => { logs.push(JSON.parse(line)); } },
  } });
  const observation = registerObservability(server, { detailLimit });
  return { server, logs, observation };
}

test('logs omit raw URLs, questions, headers, addresses and upstream error text; request IDs cannot be supplied by visitors', async () => {
  const { server, logs, observation } = fixture();
  const secret = 'SECRET-QUESTION-OR-CREDENTIAL';
  server.get('/', async () => 'page');
  server.post('/api/example', async () => ({ ok: true }));
  server.get('/api/broken', async () => { throw Object.assign(new Error(`postgres://user:${secret}@host/db`), { code: '42P01' }); });
  try {
    const first = await server.inject({ method: 'POST', url: `/api/example?secret=${secret}`, remoteAddress: '192.0.2.123',
      headers: { authorization: `Bearer ${secret}`, cookie: `sw_visitor=${secret}`, 'request-id': secret,
        'x-request-id': secret, referer: `https://example.test/${secret}` }, payload: { question: secret } });
    assert.equal(first.statusCode, 200);
    assert.match(first.headers['x-request-id'] as string, /^[a-f0-9-]{36}$/);
    const broken = await server.inject(`/api/broken?secret=${secret}`);
    assert.equal(broken.statusCode, 500);
    assert.equal(broken.json().message, 'The request could not be completed.');
    assert.ok(!broken.body.includes(secret));
    await server.inject(`/${secret}?secret=${secret}`);
    const page = await server.inject('/');
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    observation.flush();
    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(secret), serialized);
    assert.ok(!serialized.includes('192.0.2.123'));
    assert.ok(logs.some(entry => entry.err?.code === '42P01'));
    const summary = logs.find(entry => entry.event === 'traffic_summary')!;
    assert.equal(summary.pageRequests, 1);
    assert.equal(summary.routes['POST /api/example'].requests, 1);
    assert.equal(summary.routes['GET /api/broken'].errors, 1);
    assert.equal(summary.routes['GET unmatched'].requests, 1);
  } finally { await server.close(); }
});

test('paid/free/limited/provider-failure outcomes are visible without recording question content', async () => {
  const { server, logs, observation } = fixture();
  let admissions = 0;
  let failProvider = false;
  registerAgentRoutes(server, {} as Pool, async () => {
    if (failProvider) throw new Error('PRIVATE-PROVIDER-TEXT');
    return { id: 'stub', status: 'completed', output: [] };
  }, async () => {
    admissions++;
    if (admissions === 2) throw new BudgetFailure('ai_frequency_limit', 600);
    return { remaining: 250 - admissions, finish: async () => {} };
  });
  const ask = (question: string) => server.inject({ method: 'POST', url: '/api/ask', payload: { question } });
  try {
    assert.equal((await ask('What is a vessel-hour?')).statusCode, 200);
    const paid = await ask('Latest vessel presence?');
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.headers['cache-control'], 'no-store');
    assert.equal((await ask('Latest vessel presence?')).statusCode, 429);
    failProvider = true;
    assert.equal((await ask('Latest vessel presence?')).statusCode, 503);
    observation.flush();
    const summary = logs.find(entry => entry.event === 'traffic_summary')!;
    assert.deepEqual(summary.questions, { freeAnswered: 1, paidAdmitted: 2, paidAnswered: 1, limited: 1, paidFailed: 1 });
    assert.ok(logs.some(entry => entry.question?.reason === 'ai_frequency_limit'));
    assert.ok(logs.some(entry => entry.question?.reason === 'provider_unavailable'));
    assert.ok(!JSON.stringify(logs).includes('Latest vessel presence?'));
    assert.ok(!JSON.stringify(logs).includes('PRIVATE-PROVIDER-TEXT'));
  } finally { await server.close(); }
});

test('scanner traffic produces bounded details and one aggregate route; health is separate from visits', async () => {
  const { server, logs, observation } = fixture(2);
  server.get('/api/health', async () => ({ ok: true }));
  try {
    for (let i = 0; i < 80; i++) await server.inject(`/scanner-${i}`);
    await server.inject('/api/health');
    observation.flush();
    const details = logs.filter(entry => entry.event === 'http_request');
    assert.equal(details.length, 2);
    const summary = logs.find(entry => entry.event === 'traffic_summary')!;
    assert.equal(summary.routes['GET unmatched'].requests, 80);
    assert.equal(summary.healthChecks, 1);
    assert.equal(summary.pageRequests, 0);
    assert.equal(summary.suppressedDetails, 78);
    assert.equal(Object.keys(summary.routes).length, 1);
  } finally { await server.close(); }
});
