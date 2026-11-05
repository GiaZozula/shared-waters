import 'dotenv/config';
import pg from 'pg';
import { refreshNavwarn } from './navwarn-store.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before refreshing NAVWARN.');
const db = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try { console.log(await refreshNavwarn(db)); }
finally { await db.end(); }
