import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, exportStory } from './story-export.js';
import type pg from 'pg';

test('committed snapshot is fingerprinted public replay data with source-local precision', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../data/story/snapshot.json', import.meta.url), 'utf8'));
  assert.equal(snapshot.schemaVersion, 1);
  assert.match(snapshot.sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(Number.isFinite(Date.parse(snapshot.generatedAt)));
  assert.equal(createHash('sha256').update(canonical(snapshot.data)).digest('hex'), snapshot.contentFingerprint);
  assert.equal(snapshot.data.presence.length, 358);
  assert.equal(snapshot.data.detections.length, 2);
  assert.equal(snapshot.data.notices[0].effectiveAt, '2026-09-15T12:30:00.000Z');
  assert.equal(snapshot.data.detections[0].sourceLocalTime, '2026-09-14 15:23:53');
  assert.equal(snapshot.data.detections[1].sourceLocalTime, '2026-09-14 15:38:53');
  const fields = {
    presence: ['id','eventAt','latitude','longitude','vesselId','speedBandGroup','sourceUrl','shipName','vesselType'],
    notices: ['id','sourceRecordId','publishedAt','effectiveAt','zoneAState','appliesTo','cancels','sourceUrl'],
    detections: ['id','reviewDate','sourceLocalTime','occurrence','platformLatitude','platformLongitude','sourceUrl'],
  };
  for (const [collection, allowed] of Object.entries(fields)) for (const row of snapshot.data[collection]) {
    assert.deepEqual(Object.keys(row).sort(), allowed.sort());
    const url = new URL(row.sourceUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username + url.password, '');
    assert.doesNotMatch(url.search, /token|secret|key|password/i);
  }
});

test('export refuses empty/incomplete source rather than publishing a misleading snapshot', async () => {
  const db = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  await assert.rejects(exportStory(db, 'a'.repeat(40), new Date().toISOString()), /reviewed/);
});
