import { apiOrigin } from '../shared/api-origin.js';

type FetchLike = typeof fetch;

export function createApiFetch(base: string, fetchImpl: FetchLike = fetch): FetchLike {
  const origin = apiOrigin(base);
  return (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/') || input.includes('\\') ||
      new URL(input, 'https://local.invalid').pathname.startsWith('/api/') === false) {
      throw new Error('API requests must use a local /api/ path.');
    }
    return fetchImpl(`${origin}${input}`, { ...init, credentials: 'include' });
  };
}

export const apiFetch = createApiFetch(import.meta.env?.VITE_API_BASE ?? '');
