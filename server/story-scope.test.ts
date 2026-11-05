import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { matchesReviewedStory } from '../shared/story-scope.js';
import { readStoryReplay } from './replay.js';
import { parsePresenceWindow } from './domain-queries.js';

const reviewed = JSON.parse(readFileSync(new URL('../data/story/snapshot.json', import.meta.url), 'utf8')).data;

test('reviewed Story requires all evidence families and exact notice boundaries', async () => {
  assert.equal(matchesReviewedStory(reviewed), true);
  for (const data of [reviewed, {...reviewed, notices: []}, {...reviewed, detections: []},
    {...reviewed, detections: [{...reviewed.detections[0]}, {...reviewed.detections[0]}]},
    {...reviewed, notices: reviewed.notices.map((n: object) => ({...n, zoneAState: 'no_restriction_stated'}))}]) {
    const db = {query: async (sql: string) => ({rows: sql.includes('FROM historical_presence') ? data.presence :
      sql.includes('FROM navwarn_notices') ? data.notices : data.detections})} as unknown as Pick<pg.Pool, 'query'>;
    assert.equal((await readStoryReplay(db)).status, data === reviewed ? 'ready' : 'incomplete');
  }
});

test('comparisons include the ending days, retaining exclusive end and hour guards', () => {
  assert.ok(parsePresenceWindow('2026-09-18T00:00:00Z', '2026-09-19T00:00:00Z'));
  assert.ok(parsePresenceWindow('2026-09-19T20:00:00Z', '2026-09-20T00:00:00Z'));
  assert.equal(parsePresenceWindow('2026-09-19T20:00:00Z', '2026-09-20T01:00:00Z'), null);
  assert.equal(parsePresenceWindow('2026-09-15T12:00:00Z', '2026-09-15T13:00:00Z'), null);
  assert.equal(parsePresenceWindow('2026-09-18T00:01:00Z', '2026-09-19T00:00:00Z'), null);
});
