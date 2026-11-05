import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerQuestionRoutes } from './question-routes.js';
import { registerAgentRoutes } from './test-admission.js';

test('current state combines verified notice with unknown AIS coverage', async () => {
  const server = Fastify();
  server.get('/api/query/restriction', async () => ({ at: '2026-09-25T00:00:00Z', status: 'current_notice_verified',
    statement: 'restricted_10_knots', notice: { id: 'navwarn:one', publishedAt: '2026-09-15T00:00:00Z',
      effectiveAt: '2026-09-15T12:30:00Z', appliesTo: 'vessels_over_13_m', cancels: null,
      sourceUrl: 'https://example.test/notice' }, evidenceIds: ['navwarn:one'] }));
  server.get('/api/current/ais', async () => ({ connection: { status: 'connected' }, data: {
    status: 'unknown', recentWindowMinutes: 30, lastStored: null, positions: [{id: 'ais:must-not-be-cited'}] } }));
  const db = { query: async (sql: string) => sql.includes('UNION SELECT') ?
    { rows: [{ id: 'navwarn:one' }] } : { rows: [] } } as unknown as Pool;
  registerQuestionRoutes(server, db);
  registerAgentRoutes(server, db, async () => ({ id: 'one', status: 'completed', output: [
    { type: 'function_call', name: 'get_current_state', arguments: '{}', call_id: 'one' }] }));
  try {
    const response = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Is Zone A restricted now and how fresh is AIS?' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().evidenceIds, ['navwarn:one']);
    assert.equal(response.json().facts.get_current_state.ais.status, 'unknown');
    assert.match(response.json().answer, /unknown, not zero ships/);
    assert.match(response.json().answer, /10-knot limit/);
  } finally { await server.close(); }
});

test('evidence follow-up accepts only a prior ID and returns source-specific facts', async () => {
  const server = Fastify();
  const db = { query: async (sql: string, values: string[]) => sql.includes('UNION SELECT') ?
    { rows: [{ id: 'whoi:one' }] } : sql.includes('FROM whoi_detections') && values[0] === 'whoi:one' ?
      { rows: [{ id: 'whoi:one', kind: 'whoi_detection', sourceLocalTime: '2026-09-14 15:38:53',
        occurrence: 'detected', platformLatitude: 49.358, platformLongitude: -64.687,
        sourceUrl: 'https://example.test/review' }] } : { rows: [] } } as unknown as Pool;
  registerQuestionRoutes(server, db);
  registerAgentRoutes(server, db, async () => ({ id: 'one', status: 'completed', output: [
    { type: 'function_call', name: 'get_evidence_by_id', arguments: '{"id":"whoi:one"}', call_id: 'one' }] }));
  try {
    const rejected = await server.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Tell me about whoi:one' } });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error, 'evidence_not_in_previous_answer');
    const accepted = await server.inject({ method: 'POST', url: '/api/ask', payload: {
      question: 'Tell me about whoi:one', previousEvidenceIds: ['whoi:one'] } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.deepEqual(accepted.json().evidenceIds, ['whoi:one']);
    assert.equal(accepted.json().facts.get_evidence_by_id.sourceUrl, 'https://example.test/review');
    assert.match(accepted.json().answer, /coordinates locate the glider, not a whale/);
  } finally { await server.close(); }
});
