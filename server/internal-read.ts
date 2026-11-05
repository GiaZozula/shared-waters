import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

const internalRead = new AsyncLocalStorage<boolean>();
const paths = new Set(['/api/query/restriction', '/api/query/latest-detection', '/api/query/detections',
  '/api/query/presence-comparison', '/api/query/current-state', '/api/query/evidence',
  '/api/query/explanation', '/api/current/ais', '/api/current/marine', '/api/current/whoi', '/api/story/replay']);

export function supportsInternalRead(url: string): boolean { return paths.has(url.split('?')[0]); }

export function isInternalRead(): boolean { return internalRead.getStore() === true; }

// An admitted request owns the public lease through its bounded tool reads.
// No HTTP header can set this server-only context. Methods and routes are fixed.
export function injectInternalRead(server: FastifyInstance, url: string) {
  if (!supportsInternalRead(url)) throw new Error('Unsupported internal read');
  return internalRead.run(true, async () => await server.inject({ method: 'GET', url }));
}
