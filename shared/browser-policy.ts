import { apiOrigin } from './api-origin.js';

/** Same-origin assets and one explicit public API origin; no executable inline text. */
export function browserContentSecurityPolicy(apiBase = ''): string {
  const api = apiOrigin(apiBase);
  return [
    "default-src 'self'", "script-src 'self'", "script-src-attr 'none'", "style-src 'self'",
    "img-src 'self' data: blob:", "font-src 'self'", `connect-src 'self'${api ? ` ${api}` : ''}`,
    "worker-src 'self' blob:", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'self'",
    "object-src 'none'", "form-action 'self'",
  ].join('; ');
}
