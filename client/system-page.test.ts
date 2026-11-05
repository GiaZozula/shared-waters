import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./system-page.ts', import.meta.url), 'utf8');

test('the system page keeps one compliance section and does not poll or mount a map', () => {
  assert.doesNotMatch(source, /mountZoneScene|setInterval|zone-scene|style\.css|Operations overview/);
  assert.match(readFileSync(new URL('./system-diagrams.ts', import.meta.url), 'utf8'), /Private metrics/);
  assert.match(source, /waiting for an owner/);
  for (const line of [
    'A recent fetch is not a recent observation.',
    'A missing or unverified notice does not mean the water is unrestricted.',
    'A vessel-hour is not a track, an exact speed, or a compliance finding.',
    'No AIS position means unknown coverage, not an empty sea.',
    'Whale coordinates locate the glider, and the source clock is not UTC.',
    'This is a reading of public records, not a navigation or enforcement tool.',
  ]) assert.equal(source.split(line).length - 1, 1);
});
