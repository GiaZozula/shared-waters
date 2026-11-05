import 'dotenv/config';
import pg from 'pg';
import { refreshMarine } from './marine-store.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before refreshing marine data.');
const db = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try {
  await refreshMarine(db);
  console.log('Marine feed refreshed.');
} finally {
  await db.end();
}
