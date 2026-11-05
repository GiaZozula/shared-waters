import 'dotenv/config';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { importStoryEnding } from './story-ending.js';

const url = process.env.STORY_DATABASE_URL;
if (!url) throw new Error('Set STORY_DATABASE_URL to the reviewed source database.');
const pool = new pg.Pool(databasePoolOptions(url));
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await importStoryEnding(db);
  await db.query('COMMIT');
  console.log('Imported 108 reviewed vessel-hours and the 18 September lifting notice.');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { db.release(); await pool.end(); }
