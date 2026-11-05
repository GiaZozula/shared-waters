import 'dotenv/config';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { verifyRuntime } from './schema-contract.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the runtime credential.');
const db = new pg.Pool({ ...databasePoolOptions(process.env.DATABASE_URL), max: 1 });
try {
  const client = await db.connect();
  try { await verifyRuntime(client); } finally { client.release(); }
  console.log('Schema and restricted runtime privileges verified.');
} catch {
  console.error('Schema/runtime verification failed. Deployment must not proceed; inspect privately.');
  process.exitCode = 1;
} finally { await db.end(); }
