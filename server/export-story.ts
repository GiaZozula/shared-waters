import 'dotenv/config';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { exportStory } from './story-export.js';
import { databasePoolOptions } from './database.js';

// Deliberate operator command. Never imported by client or normal build/startup.
const databaseUrl = process.env.STORY_DATABASE_URL;
if (!databaseUrl) throw new Error('Set STORY_DATABASE_URL to the reviewed source database.');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pool = new pg.Pool(databasePoolOptions(databaseUrl));
const db = await pool.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL timezone TO 'UTC'");
  const snapshot = await exportStory(db, commit, new Date().toISOString());
  await db.query('COMMIT');
  const directory = new URL('../data/story/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const target = new URL('snapshot.json', directory);
  const temporary = new URL('snapshot.json.tmp', directory);
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(temporary, target);
  console.log(`Story exported: ${snapshot.data.presence.length} presence rows, SHA-256 ${snapshot.contentFingerprint}`);
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally { db.release(); await pool.end(); }
