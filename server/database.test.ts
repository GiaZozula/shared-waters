import assert from 'node:assert/strict';
import test from 'node:test';
import { databasePoolOptions } from './database.js';

test('database URLs preserve TLS verification and the pool has a bounded connection budget', () => {
  const local = databasePoolOptions('postgres://localhost:5432/shared_water');
  assert.equal(local.connectionString, 'postgres://localhost:5432/shared_water');
  assert.equal(local.connectionTimeoutMillis, 10_000);
  assert.equal(local.max, 5);
  assert.equal(local.idleTimeoutMillis, 10_000);

  const required = databasePoolOptions('postgres://user:secret@dpg-example/shared_water?sslmode=require');
  assert.equal(required.connectionString, 'postgres://user:secret@dpg-example/shared_water?sslmode=require');

  const mixed = databasePoolOptions('postgres://user:secret@dpg-example/shared_water?sslmode=require&application_name=shared-water');
  assert.equal(mixed.connectionString, 'postgres://user:secret@dpg-example/shared_water?sslmode=require&application_name=shared-water');
});
