import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { aiPolicy, BudgetFailure, publishedAiLimits, visitorIdentity } from './ai-budget.js';
import { registerAgentRoutes } from './agent.js';

test('paid questions default off and require explicit positive limits and a private identity secret', () => {
  assert.throws(() => aiPolicy({}), /ai_disabled/);
  const env = { AI_QUESTIONS_ENABLED: 'true', AI_CLIENT_CALLS: '3', AI_CLIENT_WINDOW_SECONDS: '600',
    AI_SITE_CALLS: '20', AI_SITE_WINDOW_SECONDS: '3600', AI_CONCURRENCY: '1', AI_TOTAL_CALLS: '100',
    AI_IDENTITY_SECRET: 'a'.repeat(32) };
  assert.equal(aiPolicy(env).totalCalls, 100);
  for (const value of ['0', '-1', '1.2', 'Infinity', '', '9007199254740992'])
    assert.throws(() => aiPolicy({ ...env, AI_TOTAL_CALLS: value }), /ai_budget_unavailable/);
  assert.throws(() => aiPolicy({ ...env, AI_IDENTITY_SECRET: 'short' }), /ai_budget_unavailable/);
});

test('question status publishes numeric limits and withholds secrets', async () => {
  const secret = 'identity-secret-value-not-for-status';
  const key = 'provider-key-not-for-status';
  const keys = ['AI_QUESTIONS_ENABLED', 'AI_CLIENT_CALLS', 'AI_CLIENT_WINDOW_SECONDS', 'AI_SITE_CALLS', 'AI_SITE_WINDOW_SECONDS', 'AI_CONCURRENCY', 'AI_TOTAL_CALLS', 'AI_IDENTITY_SECRET', 'DEEPSEEK_API_KEY'] as const;
  const previous = Object.fromEntries(keys.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    AI_QUESTIONS_ENABLED: 'false', AI_CLIENT_CALLS: '5', AI_CLIENT_WINDOW_SECONDS: '600',
    AI_SITE_CALLS: '50', AI_SITE_WINDOW_SECONDS: '3600', AI_CONCURRENCY: '2', AI_TOTAL_CALLS: '250',
    AI_IDENTITY_SECRET: secret, DEEPSEEK_API_KEY: key,
  });
  assert.equal(publishedAiLimits()?.totalCalls, 250);
  const server = Fastify();
  registerAgentRoutes(server, {} as Pool);
  try {
    const body = (await server.inject('/api/ask/status')).json();
    assert.equal(body.configured, false);
    assert.equal(body.limits.clientCalls, 5);
    assert.equal(body.limits.siteWindowSeconds, 3600);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes(secret), false);
    assert.equal(encoded.includes(key), false);
  } finally {
    for (const name of keys) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await server.close();
  }
});

test('browser identity validates its signature, ignores forged IDs, and uses a secure private cookie', () => {
  const secret = 'test-secret'.repeat(4);
  const visitor = visitorIdentity(undefined, secret);
  assert.ok(visitor.cookie?.includes('HttpOnly; SameSite=Lax; Max-Age=2592000; Secure'));
  assert.equal(visitorIdentity(visitor.cookie, secret).id, visitor.id);
  assert.notEqual(visitorIdentity(visitor.cookie, 'other-secret'.repeat(4)).id, visitor.id);
  const tampered = visitor.cookie!.replace(visitor.id, '00000000-0000-0000-0000-000000000000');
  assert.notEqual(visitorIdentity(tampered, secret).id, '00000000-0000-0000-0000-000000000000');
  assert.notEqual(visitorIdentity('sw_visitor=garbage', secret).id, 'garbage');
});

test('a model key alone cannot enable production calls; the kill switch preserves free explanations', async () => {
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const oldEnabled = process.env.AI_QUESTIONS_ENABLED;
  process.env.DEEPSEEK_API_KEY = 'unused-test-key';
  process.env.AI_QUESTIONS_ENABLED = 'false';
  const server = Fastify();
  registerAgentRoutes(server, {} as Pool);
  try {
    const status = await server.inject('/api/ask/status');
    assert.equal(status.json().configured, false);
    const paid = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Latest vessel presence?' } });
    assert.equal(paid.statusCode, 503); assert.equal(paid.json().error, 'ai_disabled');
    const free = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'What is this project?' } });
    assert.equal(free.statusCode, 200);
  } finally {
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
    if (oldEnabled === undefined) delete process.env.AI_QUESTIONS_ENABLED; else process.env.AI_QUESTIONS_ENABLED = oldEnabled;
    await server.close();
  }
});

test('admission fails before provider; forwarded headers cannot change socket identity; explanations stay free', async () => {
  const server = Fastify();
  let modelCalls = 0;
  const peers: string[] = [];
  registerAgentRoutes(server, {} as Pool, async () => {
    modelCalls++; return { id: 'stub', status: 'completed', output: [] };
  }, async address => { peers.push(address); throw new BudgetFailure('ai_frequency_limit', 600); });
  try {
    for (const forwarded of ['1.2.3.4', '8.8.8.8']) {
      const response = await server.inject({ method: 'POST', url: '/api/ask', remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': forwarded, forwarded: `for=${forwarded}` }, payload: { question: 'Latest vessel presence?' } });
      assert.equal(response.statusCode, 429);
      assert.equal(response.headers['retry-after'], '600');
      assert.equal(response.json().error, 'ai_frequency_limit');
    }
    assert.deepEqual(peers, ['127.0.0.1', '127.0.0.1']);
    const free = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'What is this project?' } });
    assert.equal(free.statusCode, 200);
    assert.equal(peers.length, 2);
    assert.equal(modelCalls, 0);
  } finally { await server.close(); }
});

test('provider failure finishes reservation without retry; payload is bounded before admission', async () => {
  const server = Fastify();
  let admitted = 0; let finished = 0; let calls = 0;
  registerAgentRoutes(server, {} as Pool, async body => {
    calls++; assert.equal(body.max_output_tokens, 650);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 16_000);
    throw new Error('provider down');
  }, async () => { admitted++; return { remaining: 4, finish: async () => { finished++; } }; });
  try {
    const result = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Latest vessel presence?' } });
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers['x-ai-remaining-calls'], '4');
    assert.equal(admitted, 1); assert.equal(finished, 1); assert.equal(calls, 1);
    const large = await server.inject({ method: 'POST', url: '/api/ask', payload: {
      question: 'Latest vessel presence?', previousEvidenceIds: Array.from({ length: 100 }, (_, i) => `${i}:` + 'a'.repeat(195)) } });
    assert.equal(large.statusCode, 400);
    assert.equal(admitted, 1);
    const oversized = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'x'.repeat(25_000) } });
    assert.equal(oversized.statusCode, 413);
  } finally { await server.close(); }
});

test('the secondary socket-peer throttle bounds its identity map and fails closed at capacity', async () => {
  const server = Fastify();
  registerAgentRoutes(server, {} as Pool, async () => { throw new Error('Free explanations must not call the provider'); });
  try {
    for (let i = 0; i < 1000; i++) {
      const response = await server.inject({ method: 'POST', url: '/api/ask', remoteAddress: `test-peer-${i}`,
        payload: { question: 'What is a vessel-hour?' } });
      assert.equal(response.statusCode, 200);
    }
    const rejected = await server.inject({ method: 'POST', url: '/api/ask', remoteAddress: 'one-more-peer',
      payload: { question: 'What is a vessel-hour?' } });
    assert.equal(rejected.statusCode, 429);
    const known = await server.inject({ method: 'POST', url: '/api/ask', remoteAddress: 'test-peer-0',
      payload: { question: 'What is a vessel-hour?' } });
    assert.equal(known.statusCode, 200);
  } finally { await server.close(); }
});

test('replacing the model never bypasses the default production kill switch', async () => {
 const old = process.env.AI_QUESTIONS_ENABLED;
 process.env.AI_QUESTIONS_ENABLED = 'false';
 const server = Fastify(); let calls = 0;
 registerAgentRoutes(server, {} as Pool, async () => { calls++; return {id:'fake',status:'completed',output:[]}; });
 try {
  const response = await server.inject({method:'POST',url:'/api/ask',payload:{question:'Latest vessel presence?'}});
  assert.notEqual(response.statusCode,200); assert.equal(calls,0);
 } finally {await server.close(); if(old===undefined) delete process.env.AI_QUESTIONS_ENABLED;else process.env.AI_QUESTIONS_ENABLED=old;}
});
