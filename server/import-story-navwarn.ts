import 'dotenv/config';
import pg from 'pg';
import { databasePoolOptions } from './database.js';
import { NAVWARN_SOURCE } from './navwarn.js';
import { htmlText } from './source-html.js';

// This archived copy retains the superseded 15 September Coast Guard message.
const sourceUrl = 'https://www.sealagom.com/coastal/134/message/24552/nw-c-3975-26-nw-c-3975-26/';
const publishedAt = '2026-09-15T10:40:00Z';
const effectiveAt = '2026-09-15T12:30:00Z';
const rawText = 'NW-C-3975-26. Published 2026-09-15 10:40 UTC. Effective 151230 UTC Sep 2026. ' +
  'The following North Atlantic Right Whale restriction Zones are in effect for all vessels greater than 13 meters in length overall: ' +
  'Dynamic Shipping Zones A and D: Vessels must not exceed 10 knots over ground. Cancels NW-C-3957-26.';

const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) });
if (!response.ok) throw new Error(`Archived NAVWARN HTTP ${response.status}`);
const page = htmlText(await response.text());
for (const fragment of [
  'NW-C-3975-26', '2026-09-15 10:40 UTC', 'Effective 151230 UTC Sep 2026',
  'greater than 13 meters in length overall',
  'Dynamic Shipping Zones A and D: Vessels must not exceed 10 knots over ground',
  'Cancels NW-C-3957-26',
]) {
  if (!page.includes(fragment)) throw new Error(`Archived NAVWARN missing verified fragment: ${fragment}`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL before importing.');
const db = new pg.Pool(databasePoolOptions(databaseUrl));
try {
  const result = await db.query(
    `INSERT INTO navwarn_notices
       (id, source, source_record_id, zone_id, published_at, effective_at,
        zone_a_state, applies_to, cancels, source_url, raw_text, last_fetched_at)
     VALUES ('navwarn:NW-C-3975-26', $1, 'NW-C-3975-26', 'zone_a', $2, $3,
       'restricted_10_knots', 'vessels_over_13_m', 'NW-C-3957-26', $4, $5, now())
     ON CONFLICT (source, source_record_id) DO NOTHING`,
    [NAVWARN_SOURCE, publishedAt, effectiveAt, sourceUrl, rawText],
  );
  console.log(JSON.stringify({ id: 'navwarn:NW-C-3975-26', inserted: result.rowCount }));
} finally {
  await db.end();
}
