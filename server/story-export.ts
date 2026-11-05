import { matchesReviewedStory } from '../shared/story-scope.js';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { readStoryReplay } from './replay.js';

// Sort object keys without changing arrays, source-local times, or numeric values.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}

export async function exportStory(db: Pick<pg.Pool, 'query'>, sourceCommit: string, generatedAt: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Valid source commit and generation time required');
  }
  // Normalize Dates using the same JSON serialization as Fastify's route.
  const data = JSON.parse(JSON.stringify(await readStoryReplay(db)));
  if (data.status !== 'ready' || !matchesReviewedStory(data)) {
    throw new Error('Story does not match the reviewed 358-row, two-detection, notice-boundary scope');
  }
  const contentFingerprint = createHash('sha256').update(canonical(data)).digest('hex');
  return { schemaVersion: 1, generatedAt, sourceCommit, contentFingerprint,
    provenance: { scope: 'Reviewed Zone A replay, 13–19 September 2026',
      sources: ['Global Fishing Watch', 'Canadian Coast Guard NAVWARN', 'WHOI / Robots4Whales'],
      fields: 'Public replay fields only; no raw payloads, credentials, ingestion state or visitor data.',
      clocks: 'Notice and vessel timestamps are UTC; WHOI times remain source-local with unresolved offset.' },
    data };
}
