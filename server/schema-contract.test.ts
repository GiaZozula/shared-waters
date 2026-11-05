import assert from 'node:assert/strict';
import test from 'node:test';
import { migrations, verifyMigrationLedger } from './schema-contract.js';

const known = migrations.map(({ version, checksum }) => ({ version, checksum }));
const future = { version: known.length + 1, checksum: 'a'.repeat(64) };

test('migration verification accepts a known prefix and well-formed future entries', () => {
  assert.doesNotThrow(() => verifyMigrationLedger(known));
  assert.doesNotThrow(() => verifyMigrationLedger([...known, future]));
  assert.doesNotThrow(() => verifyMigrationLedger([], false));
});

test('missing known history, drift, gaps and malformed future checksums fail closed', () => {
  for (const rows of [[], [future], [...known, { ...future, version: future.version + 1 }],
    [{ ...known[0], checksum: 'b'.repeat(64) }, ...known.slice(1), future],
    [...known, { ...future, checksum: 'malformed' }], [...known, known[0]]]) {
    assert.throws(() => verifyMigrationLedger(rows), /version\/checksum/);
  }
});
