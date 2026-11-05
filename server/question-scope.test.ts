import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerAgentRoutes } from './test-admission.js';
import { registerDomainRoutes } from './domain-routes.js';
import { calendarDate, questionDates, requestsCurrent } from '../shared/question-scope.js';

const records = ['2026-09-14 15:23:53', '2026-09-14 15:38:53', '2026-09-22 12:00:00'].map((time, i) => ({
  id: `whoi:${i}`, reviewDate: time.slice(0, 10), sourceLocalTime: time, occurrence: 'detected',
  platformLatitude: 49.358, platformLongitude: -64.687, sourceUrl: 'https://example.test/review',
}));
function fixture(calls: { name: string; args: object }[]) {
  const reads: { sql: string; values: unknown[] }[] = [];
  const requests: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, values: unknown[] = []) => {
    reads.push({ sql, values });
    if (sql.includes('UNION SELECT')) return { rows: records.filter(row => (values[0] as string[]).includes(row.id)).map(row => ({ id: row.id })) };
    let rows = records.filter(row => !values.length || (values.length === 1 ? row.reviewDate === values[0] :
      row.reviewDate >= String(values[0]) && row.reviewDate <= String(values[1])));
    if (sql.includes('DESC')) rows = rows.slice().reverse().slice(0, 1);
    return { rows };
  } } as unknown as pg.Pool;
  const server = Fastify();
  registerDomainRoutes(server, db);
  registerAgentRoutes(server, db, async body => {
    requests.push(body);
    return { id: 'stub', status: 'completed', output: calls.map((call, i) => ({
      type: 'function_call', name: call.name, arguments: JSON.stringify(call.args), call_id: `call-${i}`,
    })) };
  });
  const ask = (question: string, extra: Record<string, unknown> = {}) => server.inject({ method: 'POST', url: '/api/ask',
    payload: { question, mode: 'story', selectedTime: '2026-09-15T12:00:00Z', ...extra } });
  return { server, ask, reads, requests };
}

test('Story latest detection is bounded to review dates through the selected calendar day', async () => {
  const f = fixture([{ name: 'get_latest_detection', args: {} }]);
  try {
    const response = await f.ask('latest whale detection?');
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().evidenceIds, ['whoi:1']);
    assert.match(response.json().answer, /Story review dates 2026-09-13 through 2026-09-15/);
    assert.ok(response.json().warnings.some((line: string) => /not established as before the selected UTC instant/.test(line)));
    assert.deepEqual(f.reads[0].values, ['2026-09-13', '2026-09-15']);
    assert.match(String(f.requests[0].input), /Mode: story/);
  } finally { await f.server.close(); }
});

test('Live and an explicitly current Story request can use the global latest index, with override labelled', async () => {
  for (const explicit of [false, true]) {
    const f = fixture([{ name: 'get_latest_detection', args: {} }]);
    try {
      const response = await f.ask(explicit ? 'latest whale detection now?' : 'latest whale detection?',
        explicit ? {} : { mode: 'live', selectedTime: null });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().evidenceIds, ['whoi:2']);
      assert.deepEqual(f.reads[0].values, []);
      if (explicit) assert.ok(response.json().warnings.some((line: string) => /not the selected Story time/.test(line)));
    } finally { await f.server.close(); }
  }
});

test('dated detection question returns only the requested review date, full source-local seconds and evidence', async () => {
  const f = fixture([{ name: 'get_detections_on_date', args: { date: '2026-09-14' } }]);
  try {
    const response = await f.ask('What whale detections are indexed on September 14, 2026?');
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().evidenceIds, ['whoi:0', 'whoi:1']);
    assert.match(response.json().answer, /15:23:53/);
    assert.match(response.json().answer, /15:38:53/);
    assert.match(response.json().answer, /source-local times with unresolved UTC offset/);
    assert.deepEqual(f.reads[0].values, ['2026-09-14']);
  } finally { await f.server.close(); }
});

test('wrong date, aggregate substitution and current-only historical tools fail before any data read', async () => {
  const cases = [
    { question: 'whale detections on 2026-09-14?', name: 'get_detections_on_date', args: { date: '2026-09-22' } },
    { question: 'whale detections on 2026-09-14?', name: 'get_story_snapshot', args: {} },
    { question: 'whale detections on 2026-09-14?', name: 'get_latest_detection', args: {} },
    { question: 'marine conditions at the selected Story time?', name: 'get_marine_conditions', args: {} },
    { question: 'whale review for the Story?', name: 'get_acoustic_review', args: {} },
    { question: 'What happened in the Story?', name: 'get_current_state', args: {} },
    { question: 'detections on 2026-09-14 and 2026-09-15?', name: 'get_detections_on_date', args: { date: '2026-09-14' } },
  ];
  for (const item of cases) {
    const f = fixture([{ name: item.name, args: item.args }]);
    try {
      const response = await f.ask(item.question);
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error, 'question_scope_mismatch');
      assert.equal(f.reads.length, 0);
    } finally { await f.server.close(); }
  }
});

test('selected day fallback is a review date, and an empty day remains unknown rather than zero whales', async () => {
  const f = fixture([{ name: 'get_detections_on_date', args: { date: '2026-09-15' } }]);
  try {
    const response = await f.ask('whale detections on the selected day?');
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().evidenceIds, []);
    assert.match(response.json().answer, /does not establish whale absence or a reviewed zero-detection day/);
  } finally { await f.server.close(); }
});

test('contradictory mode/time context is rejected before the model', async () => {
  for (const extra of [{ mode: 'live' }, { selectedTime: '2026-09-22T12:00:00Z' }]) {
    const f = fixture([{ name: 'get_latest_detection', args: {} }]);
    try {
      const response = await f.ask('latest detection?', extra);
      assert.equal(response.statusCode, 400);
      assert.equal(f.requests.length, 0);
      assert.equal(f.reads.length, 0);
    } finally { await f.server.close(); }
  }
});

test('detection meaning is a free explanation with no unrelated prior evidence', async () => {
  const f = fixture([{ name: 'get_evidence_by_id', args: { id: 'whoi:2' } }]);
  try {
    const response = await f.ask('What does a whale detection actually mean?', { previousEvidenceIds: ['whoi:2'] });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.json().answer, /observing glider, not a whale/);
    assert.deepEqual(response.json().evidenceIds, []);
    assert.equal(f.requests.length, 0);
    assert.equal(f.reads.length, 0);
  } finally { await f.server.close(); }
});

test('calendar parsing is strict and ocean current does not mean current-time intent', () => {
  assert.equal(calendarDate('2026-02-30'), null);
  assert.equal(calendarDate('2026-09-14'), '2026-09-14');
  assert.deepEqual(questionDates('detections on Sep 14, 2026?'), ['2026-09-14']);
  assert.deepEqual(questionDates('14 September 2026'), ['2026-09-14']);
  assert.equal(requestsCurrent('ocean current velocity on September 14'), false);
  assert.equal(requestsCurrent('current restriction?'), true);
});

test('an approximate Story position can use archive detection dates without fabricating a UTC instant', async () => {
  const f = fixture([{ name: 'get_latest_detection', args: {} }]);
  try {
    const response = await f.ask('latest whale detection?', { selectedTime: null });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(f.reads[0].values, ['2026-09-13', '2026-09-19']);
    assert.equal(response.json().selectedTime, null);
    assert.match(response.json().answer, /through 2026-09-19/);
  } finally { await f.server.close(); }
});
