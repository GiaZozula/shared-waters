import assert from 'node:assert/strict';
import test from 'node:test';
import { retainReading } from './retained-reading.js';
import { adaptNowReads } from './adapt-now-reads.js';

test('failed browser polls preserve dated zeroes but mark retained sources unavailable or unverified', () => {
  const time = '2026-11-04T16:00:00Z';
  const previous = {fetch: {lastSuccessAt: time}, weather: {code: 95, validAt: time}, data: {status: 'fresh', observation: {waveHeightM: 0, seaSurfaceTemperatureC: 0, oceanCurrentVelocityKmh: 0, validAt: time}}};
  const retained = retainReading(previous, null);
  const scene = adaptNowReads({ais: null, marine: retained,
    whoi: retainReading({data: {status: 'recent_review', latestReview: {reviewDate: '2026-11-04', detectionCount: 0}}}, null),
    navwarn: retainReading({data: {status: 'latest_published_notice', notice: {zoneAState: 'restricted_10_knots', effectiveAt: time}}}, null)});
  assert.equal(scene.marine?.state, 'stale');
  assert.equal(scene.marine?.waveHeightMetres, 0);
  assert.equal(scene.marine?.validAt, time);
  assert.equal(scene.marine?.fetchedAt, time);
  assert.equal(scene.marine?.refreshUnavailable, true);
  assert.equal(scene.marine?.weather?.code, 95)
  assert.equal(scene.marine?.weather?.refreshUnavailable, true);
  assert.equal(scene.whaleReview?.rightWhaleRows, 0);
  assert.equal(scene.whaleReview?.refreshUnavailable, true);
  assert.equal(scene.restriction.status, 'unverified');
  assert.equal(scene.restriction.refreshUnavailable, true);
  assert.equal(retainReading(retained, previous), previous);
  assert.equal(retainReading(null, null), null);
  assert.equal('refreshUnavailable' in previous, false);
});
