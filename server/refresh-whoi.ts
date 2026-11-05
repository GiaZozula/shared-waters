import 'dotenv/config';
import pg from 'pg';
import { refreshWhoi } from './whoi-store.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before refreshing WHOI.');
const db = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try { console.log(await refreshWhoi(db)); }
finally { await db.end(); }
