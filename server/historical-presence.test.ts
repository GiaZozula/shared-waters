import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { readHistoricalPresence } from './historical-presence.js';

test('public historical reads exclude raw provider fields even if the database adds columns', async () => {
  const sql: string[] = [];
  const db = { query: async (statement: string) => {
    sql.push(statement);
    return { rows: statement.includes('COUNT(*)') ? [{ total: '1' }] : [{
      id: 'gfw:one', eventAt: '2026-09-19T20:00:00Z', latitude: 49.3, longitude: -64.7,
      vesselId: 'public-id', speedBandGroup: 'bands_from_10_up', sourceUrl: 'https://example.test/gfw',
      rawPayload: {mmsi: 'private-fixture', speed: 17}, rawReference: 'private', ingestedAt: 'private',
    }] };
  } } as unknown as Pick<pg.Pool, 'query'>;
  const result = await readHistoricalPresence(db, 25, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].speedBandGroup, 'bands_from_10_up');
  assert.doesNotMatch(JSON.stringify(result), /rawPayload|rawReference|ingestedAt|mmsi|private-fixture/);
  assert.doesNotMatch(sql[1], /raw_payload|raw_reference|ingested_at/);
});
