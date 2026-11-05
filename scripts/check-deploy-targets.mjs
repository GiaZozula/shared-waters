// Preflight before any production SQL: same Neon endpoint/database, separate users.
try {
const migration = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
const runtime = new URL(process.env.RUNTIME_DATABASE_URL ?? '');
const host = url => url.hostname.replace(/-pooler(?=\.)/, '');
if (!['postgres:', 'postgresql:'].includes(migration.protocol) || !['postgres:', 'postgresql:'].includes(runtime.protocol) ||
    host(migration) !== host(runtime) || migration.pathname !== runtime.pathname || migration.username === runtime.username ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(process.env.RUNTIME_DATABASE_ROLE ?? '') ||
    decodeURIComponent(runtime.username) !== process.env.RUNTIME_DATABASE_ROLE ||
    migration.searchParams.has('options') || runtime.searchParams.has('options')) {
  throw new Error('Deployment database targets/roles do not match the reviewed contract.');
}
console.log('Separate migration/runtime identities target the same database endpoint.');
} catch {
  // URL parsing errors can contain the input, including credentials.
  console.error('Deployment database targets/roles do not match the reviewed contract.');
  process.exitCode = 1;
}
