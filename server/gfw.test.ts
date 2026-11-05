import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseGfwSnapshot } from './gfw.js';

const directory = new URL('../data/gfw/', import.meta.url);
const names = [
  'zone_a_presence_2026-09-13_2026-09-17.json',
  'zone_a_presence_speed_at_or_below_10kn.json',
  'zone_a_presence_speed_above_10kn.json',
] as const;
const inputs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8')) as unknown));

test('checked snapshot becomes 250 unique, sourced vessel-hour records', () => {
  const records = parseGfwSnapshot(inputs[0], inputs[1], inputs[2]);
  assert.equal(records.length, 250);
  assert.equal(new Set(records.map((record) => record.sourceRecordId)).size, 250);
  assert.equal(records.filter((record) => record.speedBandGroup === 'bands_below_or_up_to_10').length, 169);
  assert.equal(records.filter((record) => record.speedBandGroup === 'bands_from_10_up').length, 81);
  assert.equal(records[0].eventAt, '2026-09-13T00:00:00Z');
  assert.equal(records.at(-1)?.eventAt, '2026-09-17T23:00:00Z');
});

test('missing or malformed category queries fail rather than silently removing evidence', () => {
  assert.throws(() => parseGfwSnapshot(inputs[0], { entries: [{ 'public-global-presence:v4.0': null }] }, inputs[2]));
  assert.throws(() => parseGfwSnapshot(inputs[0], inputs[1], inputs[1]), /partition|conflicting/);
  const invalid = structuredClone(inputs[0]) as { entries: Array<Record<string, Array<Record<string, unknown>>>> };
  invalid.entries[0]['public-global-presence:v4.0'][0].date = '2026-02-30 12:00';
  assert.throws(() => parseGfwSnapshot(invalid, inputs[1], inputs[2]), /invalid vessel, UTC hour/);
});

test('minimal reproduction inputs retain the reviewed Story while excluding provider identifiers and numeric speeds', async () => {
  const ending = await Promise.all(['all', 'lower', 'upper'].map(async name =>
    JSON.parse(await readFile(new URL(`ending/${name}.json`, directory), 'utf8'))));
  const records = [...parseGfwSnapshot(inputs[0], inputs[1], inputs[2]),
    ...parseGfwSnapshot(ending[0], ending[1], ending[2], 'public-global-presence:v5.0')];
  const saved = JSON.parse(await readFile(new URL('../data/story/snapshot.json', import.meta.url), 'utf8')).data.presence;
  assert.equal(records.length, 358);
  for (const record of records) {
    const expected = saved.find((row: {id: string}) => row.id === record.id);
    assert.ok(expected, record.id);
    assert.equal(Date.parse(record.eventAt), Date.parse(expected.eventAt));
    assert.equal(record.latitude, expected.latitude);
    assert.equal(record.longitude, expected.longitude);
    assert.equal(record.speedBandGroup, expected.speedBandGroup);
    for (const payload of Object.values(record.rawPayload)) {
      const row = payload as Record<string, unknown>;
      assert.ok(Object.keys(row).every(key => ['vesselId', 'date', 'lat', 'lon', 'hours', 'shipName', 'vesselType'].includes(key)));
    }
    const original = record.rawPayload.presence as Record<string, unknown>;
    const category = record.rawPayload.categoryQuery as Record<string, unknown>;
    assert.equal(original.shipName ?? category.shipName ?? null, expected.shipName);
    assert.equal(original.vesselType ?? category.vesselType ?? null, expected.vesselType);
  }
});
