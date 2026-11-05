import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import pg from 'pg';
import WebSocket from 'ws';
import { inZoneA, parseAisPosition } from './ais.js';
import { registerAisRoute } from './ais-routes.js';
import { setAisConnectionStatus, storeAisPosition } from './ais-store.js';

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.AISSTREAM_API_KEY;
if (!databaseUrl || !apiKey) throw new Error('Set DATABASE_URL and AISSTREAM_API_KEY before the Gulf probe.');

// The Gulf box confirmed and stayed empty. This rectangle includes that Gulf and the busier
// western North Atlantic lanes, and is used only by this probe.
const gulfBox = [[35, -75], [52, -50]] as const;
const inProbeBox = (latitude: number, longitude: number) =>
  latitude >= gulfBox[0][0] && latitude <= gulfBox[1][0] &&
  longitude >= gulfBox[0][1] && longitude <= gulfBox[1][1];

const schema = `ais_gulf_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: databaseUrl });
const db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const app = Fastify();
let created = false;

try {
  const publicBefore = await admin.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM public.ais_positions');
  await admin.query(`CREATE SCHEMA ${schema}`);
  created = true;
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  registerAisRoute(app, db);

  const captured = await new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    let confirmed = false;
    let frames = 0;
    let rejected = 0;
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`No accepted position within 30 seconds (confirmed=${confirmed}, frames=${frames}, rejected=${rejected})`));
    }, 30_000);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [gulfBox],
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'],
      }));
    });
    socket.on('message', (bytes) => {
      frames += 1;
      const message = JSON.parse(bytes.toString()) as { MessageType?: string };
      if (message.MessageType === 'SubscriptionConfirmation') { confirmed = true; return; }
      const position = parseAisPosition(message, new Date(), inProbeBox);
      if (!position) { rejected += 1; return; }
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
  });

  const first = parseAisPosition(captured, new Date(), inProbeBox);
  const second = parseAisPosition(captured, new Date(), inProbeBox);
  if (!first || !second) throw new Error('Captured frame did not parse twice');
  await setAisConnectionStatus(db, 'connected');
  const inserted = await storeAisPosition(db, first);
  const repeated = await storeAisPosition(db, second);
  const stored = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM ais_positions');
  const current = await app.inject('/api/current/ais');
  const body = current.json();
  const publicAfter = await admin.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM public.ais_positions');
  console.log(JSON.stringify({
    schema,
    subscription: { southWest: gulfBox[0], northEast: gulfBox[1] },
    latitude: first.latitude,
    longitude: first.longitude,
    speedKnots: first.speedKnots,
    insideZoneA: inZoneA(first.latitude, first.longitude),
    inserted,
    repeatedInsert: repeated,
    storedRows: stored.rows[0].count,
    routeStatus: current.statusCode,
    coverage: body.data.status,
    recentPositions: body.data.positions.length,
    publicRowsBefore: publicBefore.rows[0].count,
    publicRowsAfter: publicAfter.rows[0].count,
  }));
} finally {
  await app.close();
  await db.end();
  if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
