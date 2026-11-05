import assert from 'node:assert/strict';
import test from 'node:test';
import { marineDataStatus, parseMarineCurrent } from './marine.js';

const response = {
  latitude: 49.375008, longitude: -64.70833, utc_offset_seconds: 0, timezone: 'GMT',
  current_units: { time: 'iso8601', interval: 'seconds', wave_height: 'm',
    sea_surface_temperature: '°C', ocean_current_velocity: 'km/h' },
  current: { time: '2026-09-24T19:15', interval: 900, wave_height: 0.96,
    sea_surface_temperature: 11.8, ocean_current_velocity: 2.0 },
};

test('parses the checked Open-Meteo current shape and keeps model grid and raw values', () => {
  const parsed = parseMarineCurrent(response);
  assert.equal(parsed.sourceRecordId, 'zone_a/2026-09-24T19:15:00Z');
  assert.equal(parsed.gridLatitude, 49.375008);
  assert.equal(parsed.waveHeightM, 0.96);
  assert.equal(parsed.rawPayload, response);
});

test('null is missing but zero is a measured model value', () => {
  const zero = parseMarineCurrent({ ...response, current: { ...response.current, wave_height: 0 } });
  assert.equal(zero.waveHeightM, 0);
  const empty = parseMarineCurrent({ ...response, current: { ...response.current,
    wave_height: null, sea_surface_temperature: null, ocean_current_velocity: null } });
  assert.equal(marineDataStatus(empty, new Date('2026-09-24T19:20:00Z')).status, 'missing');
});

test('rejects changed units, missing measurements, bad time, and distant model cell', () => {
  assert.throws(() => parseMarineCurrent({ ...response, current_units: { ...response.current_units, wave_height: 'ft' } }));
  assert.throws(() => parseMarineCurrent({ ...response, current: { time: response.current.time, interval: 900 } }));
  assert.throws(() => parseMarineCurrent({ ...response, current: { ...response.current, time: '2026-02-30T19:15' } }));
  assert.throws(() => parseMarineCurrent({ ...response, latitude: 50 }));
});

test('freshness follows model valid time, independent of fetch state', () => {
  const current = parseMarineCurrent(response);
  assert.deepEqual(marineDataStatus(current, new Date('2026-09-24T19:40:00Z')), { status: 'fresh', ageMinutes: 25 });
  assert.deepEqual(marineDataStatus(current, new Date('2026-09-24T20:01:00Z')), { status: 'stale', ageMinutes: 46 });
  assert.deepEqual(marineDataStatus(null, new Date('2026-09-24T19:40:00Z')), { status: 'missing', ageMinutes: null });
});
