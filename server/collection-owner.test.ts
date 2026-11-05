import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinationUrl, runtimeRole } from './collection-owner.js';

test('roles fail closed and preserve the single-process default', () => {
  assert.equal(runtimeRole(), 'all');
  for (const role of ['api', 'worker', 'all'] as const) assert.equal(runtimeRole(role), role);
  assert.throws(() => runtimeRole('workers'), /ROLE/);
});

test('coordination requires an explicit direct connection without changing TLS options', () => {
  assert.throws(() => coordinationUrl(undefined), /direct runtime/);
  assert.throws(() => coordinationUrl('postgres://u:p@ep-example-pooler.us-east-1.aws.neon.tech/db?sslmode=verify-full'), /direct PostgreSQL/);
  const url = 'postgres://u:p@ep-example.us-east-1.aws.neon.tech/db?sslmode=verify-full';
  assert.equal(coordinationUrl(url), url);
  assert.equal(coordinationUrl(url, url.replace('ep-example.', 'ep-example-pooler.')), url);
  assert.throws(() => coordinationUrl(url, url.replace('/db?', '/other?')), /same database/);
  assert.throws(() => coordinationUrl(url, url.replace('u:p@', 'owner:p@')), /runtime login/);
  assert.throws(() => coordinationUrl(url, url.replace('/db?', ':6543/db?')), /same database/);
  assert.throws(() => coordinationUrl('private-credential-that-is-not-a-url'), error => error instanceof Error && !JSON.stringify(error).includes('private-credential'));
});
