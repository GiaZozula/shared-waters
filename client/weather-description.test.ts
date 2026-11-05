import assert from 'node:assert/strict';
import test from 'node:test';
import {describeWeather} from '../shared/weather-description.js';
import {marineDataStatus} from '../server/marine.js';

test('weather descriptions preserve code, source clock and the exact 45-minute freshness boundary', () => {
  const validAt = '2026-11-04T16:00:00Z', at = Date.parse(validAt);
  assert.match(describeWeather({code: 95, validAt}, at).sentence, /storm.*WMO code 95/);
  assert.equal(describeWeather({code: 95, validAt}, at + 45 * 60_000).state, 'fresh');
  const later = at + 45.4 * 60_000;
  assert.equal(describeWeather({code: 95, validAt}, later).state, 'stale');
  assert.equal(marineDataStatus({validAt, waveHeightM: 0, seaSurfaceTemperatureC: 0, oceanCurrentVelocityKmh: 0}, new Date(later)).status, 'stale');
  assert.equal(describeWeather({code: 71, validAt}, at).state, 'unsupported');
  assert.equal(describeWeather({code: '95', validAt}, at).state, 'missing');
});
