import { htmlRows, htmlText } from './source-html.js';

export const WHOI_SOURCE = 'whoi_robots4whales';
export const WHOI_MISSION_URL = new URL('https://dcs.whoi.edu/dal2606/dal2606_sable.shtml');
const REVIEW_PATH = /dal2606_sable_manual_analysis_table_(\d{8})\.html$/i;

export type WhoiReview = {
  sourceRecordId: string;
  reviewDate: string;
  sourceUrl: string;
  detections: WhoiDetection[];
};

export type WhoiDetection = {
  id: string;
  sourceRecordId: string;
  sourceLocalTime: string;
  occurrence: 'detected' | 'possibly_detected';
  platformLatitude: number;
  platformLongitude: number;
  sourceUrl: string;
  rawText: string;
};

function canonicalDay(yyyymmdd: string): string {
  const day = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error('WHOI mission: invalid review date');
  }
  return day;
}

export function parseWhoiReviewLinks(html: string): { day: string; url: string }[] {
  if (!/Daily analyst review/i.test(html)) throw new Error('WHOI mission: review section missing');
  const links = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = new URL(match[1].replace(/&amp;/g, '&'), WHOI_MISSION_URL);
    if (url.origin !== WHOI_MISSION_URL.origin) continue;
    const datePart = url.pathname.match(REVIEW_PATH)?.[1];
    if (datePart) links.set(canonicalDay(datePart), url.toString());
  }
  if (links.size === 0) throw new Error('WHOI mission: no dated review links');
  return [...links].map(([day, url]) => ({ day, url })).sort((a, b) => b.day.localeCompare(a.day));
}

export function parseWhoiReview(html: string, day: string, url: string): WhoiReview {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/manual_analysis_table_\d{8}\.html/.test(url)) {
    throw new Error('WHOI review: invalid date or source URL');
  }
  const expected = day.replaceAll('-', '');
  if (!url.includes(`manual_analysis_table_${expected}.html`) || !/Date\/time\s*\(local\)/i.test(htmlText(html))) {
    throw new Error('WHOI review: unexpected page structure');
  }
  const lower = html.toLowerCase();
  const start = lower.indexOf('right whale:');
  if (start < 0) throw new Error('WHOI review: right-whale section missing');
  const rest = html.slice(start);
  const next = /(?:blue|humpback|fin|sei) whale:/i.exec(rest.slice('right whale:'.length));
  const section = next ? rest.slice(0, next.index + 'right whale:'.length) : rest;
  const table = section.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table || !/Date\/time\s*\(local\)/i.test(htmlText(table))) {
    throw new Error('WHOI review: right-whale table header missing or table incomplete');
  }
  const detections: WhoiDetection[] = [];
  const seen = new Set<string>();
  for (const row of htmlRows(table)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => htmlText(m[1]));
    if (/^Date\/time\s*\(local\)$/i.test(cells[0] ?? '')) continue;
    const dateMatch = cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (!dateMatch || cells.length < 4) throw new Error('WHOI review: invalid right-whale row structure');
    const rowDay = `20${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
    if (rowDay !== day) throw new Error('WHOI review: row date differs from page date');
    const occurrence = cells[1] === 'Detected' ? 'detected' : cells[1] === 'Possibly detected' ? 'possibly_detected' : null;
    const latitude = Number(cells[2]);
    const longitude = Number(cells[3]);
    if (!occurrence || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < 45 || latitude > 55 || longitude < -70 || longitude > -55) {
      throw new Error('WHOI review: invalid right-whale row');
    }
    const sourceLocalTime = `${day} ${dateMatch[4]}`;
    const sourceRecordId = `${day}/${dateMatch[4]}`;
    if (seen.has(sourceRecordId)) throw new Error('WHOI review: duplicate right-whale time');
    seen.add(sourceRecordId);
    detections.push({ id: `whoi-right-whale:${sourceRecordId}`, sourceRecordId,
      sourceLocalTime, occurrence, platformLatitude: latitude, platformLongitude: longitude,
      sourceUrl: url, rawText: cells.join(' | ') });
  }
  return { sourceRecordId: day, reviewDate: day, sourceUrl: url, detections };
}
