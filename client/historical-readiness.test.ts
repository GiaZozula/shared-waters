import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { historicalReadiness } from './historical-readiness.js';

const reviewed = JSON.parse(readFileSync(new URL('../data/story/snapshot.json', import.meta.url), 'utf8')).data;

test('reviewed Story readiness is independent of additional historical imports', () => {
  assert.equal(historicalReadiness({ total: 358 }, reviewed).level, 'ready');
  assert.equal(historicalReadiness({ total: 250 }, reviewed).level, 'attention');
  const status = historicalReadiness({ total: 500 }, reviewed);
  assert.equal(status.level, 'ready');
  assert.match(status.detail, /500 vessel-hour records stored across all imported history/);
  assert.match(status.detail, /13–19 September 2026 Story is ready with 358/);
});

test('matching all-history total cannot conceal incomplete or old-window replay', () => {
  for (const replay of [{ ...reviewed, status: 'incomplete', presence: [] }, { ...reviewed, end: '2026-09-17T00:00:00Z' }]) {
    assert.equal(historicalReadiness({ total: 358 }, replay).level, 'attention');
  }
});

test('missing and explicit zero history remain distinct without claiming no vessels', () => {
  const absent = historicalReadiness(null, null);
  assert.equal(absent.level, 'unavailable');
  assert.match(absent.detail, /count could not be loaded/);
  const empty = historicalReadiness({ total: 0 }, { ...reviewed, status: 'not_imported', presence: [] });
  assert.equal(empty.level, 'attention');
  assert.match(empty.detail, /^0 vessel-hour records stored/);
  assert.doesNotMatch(empty.detail, /no ships|no vessels|empty sea/);
  assert.equal(historicalReadiness({ total: 358 }, null).level, 'attention');
});


test('green Story status cannot conceal missing notices, detections, or wrong boundaries', () => {
  for (const partial of [
    {...reviewed, notices: []}, {...reviewed, detections: []},
    {...reviewed, notices: reviewed.notices.map((row: Record<string, unknown>) => ({...row, effectiveAt: '2026-09-16T00:00:00Z'}))},
  ]) assert.equal(historicalReadiness({total: 358}, partial).level, 'attention');
});
