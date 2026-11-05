import { htmlRows, htmlText } from './source-html.js';

export const NAVWARN_SOURCE = 'canadian_coast_guard_navwarn';
export const NAVWARN_SEARCH_URL = new URL('https://nis.ccg-gcc.gc.ca/public/rest/messages/en/search');
NAVWARN_SEARCH_URL.searchParams.set('q', 'North Atlantic Right Whale');
NAVWARN_SEARCH_URL.searchParams.set('status', 'PUBLISHED');
NAVWARN_SEARCH_URL.searchParams.set('sortBy', 'DATE');
NAVWARN_SEARCH_URL.searchParams.set('maxHits', '40');

export type ZoneANotice = {
  id: string;
  sourceRecordId: string;
  publishedAt: string;
  effectiveAt: string;
  zoneAState: 'restricted_10_knots' | 'no_restriction_stated';
  appliesTo: 'vessels_over_13_m';
  cancels: string | null;
  sourceUrl: string;
  rawText: string;
};

function effectiveTime(text: string): string {
  const match = text.match(/Effective\s+(\d{2})(\d{2})(\d{2})\s+UTC\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (!match) throw new Error('NAVWARN: missing effective time');
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[4].toLowerCase()) + 1;
  const iso = `${match[5]}-${String(month).padStart(2, '0')}-${match[1]}T${match[2]}:${match[3]}:00Z`;
  if (new Date(iso).toISOString().replace('.000Z', 'Z') !== iso) throw new Error('NAVWARN: invalid effective time');
  return iso;
}

function parseRow(row: string): ZoneANotice | null {
  const text = htmlText(row);
  if (!/North Atlantic Right Whale/i.test(text)) return null;
  const id = text.match(/NW-C-\d{4}-\d{2}/)?.[0];
  const published = text.match(/(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC/);
  if (!id || !published) return null;
  // The search page repeats a title-only row alongside the detailed notice row.
  if (!/Effective\s+\d{6}\s+UTC/i.test(text)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => htmlText(match[1]));
    const titleOnly = cells.length === 4 && cells[0] === id &&
      cells[1] === `${published[1]} ${published[2]} UTC` &&
      cells[3] === 'Routeing Change - North Atlantic Right Whale';
    if (titleOnly) return null;
    throw new Error('NAVWARN: detailed notice has an unrecognized effective time');
  }
  const publishedAt = `${published[1]}T${published[2]}:00Z`;
  if (new Date(publishedAt).toISOString().replace('.000Z', 'Z') !== publishedAt) {
    throw new Error('NAVWARN: invalid publication time');
  }
  const matches = [...text.matchAll(/Dynamic Shipping Zones?\s+([^:]+):\s*(Vessels must not exceed 10 knots over ground|No restriction in effect)/gi)];
  const zoneA = matches.find((m) => /(?:^|[^A-Z])A(?:[^A-Z]|$)/i.test(m[1]));
  if (!zoneA) throw new Error('NAVWARN: Zone A statement missing');
  if (!/greater than 13 meters in length overall/i.test(text)) throw new Error('NAVWARN: applicability changed');
  const href = [...row.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => new URL(m[1].replace(/&amp;/g, '&'), NAVWARN_SEARCH_URL))
    .find((url) => url.origin === NAVWARN_SEARCH_URL.origin && url.pathname.includes('/message/'));
  return {
    id: `navwarn:${id}`, sourceRecordId: id, publishedAt, effectiveAt: effectiveTime(text),
    zoneAState: /Vessels must not exceed/i.test(zoneA[2]) ? 'restricted_10_knots' : 'no_restriction_stated',
    appliesTo: 'vessels_over_13_m', cancels: text.match(/Cancels\s+(NW-C-\d{4}-\d{2})/i)?.[1] ?? null,
    sourceUrl: href?.toString() ?? NAVWARN_SEARCH_URL.toString(),
    rawText: text,
  };
}

export function parseNavwarnSearch(html: string): ZoneANotice[] {
  if (!/Search for NAVWARNs/i.test(html) || !/Navigational Warnings/i.test(html)) {
    throw new Error('NAVWARN: unexpected search page');
  }
  const notices = new Map<string, ZoneANotice>();
  for (const row of htmlRows(html)) {
    const notice = parseRow(row);
    if (notice) notices.set(notice.sourceRecordId, notice);
  }
  if (notices.size === 0) throw new Error('NAVWARN: no parseable right-whale notices in search result');
  return [...notices.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
