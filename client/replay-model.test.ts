import assert from 'node:assert/strict';
import test from 'node:test';
import { frameAt, minuteForInstant, REPLAY_LAST_MINUTE, type ReplayData } from './replay-model.js';

const data: ReplayData = { zoneId: 'zone_a', start: '2026-09-13T00:00:00Z', end: '2026-09-20T00:00:00Z', status: 'ready', note: '',
  presence: [{ id: 'gfw:one', eventAt: '2026-09-15T12:00:00Z', latitude: 49, longitude: -64,
    vesselId: 'vessel-one', speedBandGroup: 'bands_from_10_up', sourceUrl: 'https://example.com',
    shipName: null, vesselType: null }],
  notices: [{ id: 'navwarn:z-early', sourceRecordId: 'early', publishedAt: '2026-09-15T10:00:00Z',
    effectiveAt: '2026-09-15T12:30:00Z', zoneAState: 'restricted_10_knots', appliesTo: 'vessels_over_13_m', cancels: null, sourceUrl: 'https://example.com' },
  { id: 'navwarn:a-later', sourceRecordId: 'later', publishedAt: '2026-09-15T11:30:00Z',
    effectiveAt: '2026-09-15T12:30:00Z', zoneAState: 'restricted_10_knots', appliesTo: 'vessels_over_13_m', cancels: 'earlier notice', sourceUrl: 'https://example.com' }],
  detections: [{ id: 'whoi:one', reviewDate: '2026-09-14', sourceLocalTime: '2026-09-14 15:23:53',
    occurrence: 'detected', platformLatitude: 49, platformLongitude: -64, sourceUrl: 'https://example.com' }] };

test('minute scrub changes notice at exact effective minute, without inventing WHOI UTC timing', () => {
  assert.equal(frameAt(data, minuteForInstant('2026-09-15T12:29:00Z')).notice, null);
  const atEffect = frameAt(data, minuteForInstant('2026-09-15T12:30:00Z'));
  assert.equal(atEffect.notice?.id, 'navwarn:a-later');
  assert.equal(atEffect.upperCategory, 1);
  assert.equal(atEffect.hour, '2026-09-15T12:00:00.000Z');
  assert.equal(minuteForInstant('2026-09-20T00:00:00Z'), REPLAY_LAST_MINUTE);
  assert.equal('detections' in atEffect, false);
});
