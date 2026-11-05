// Public build/server configuration accepts origins, never paths or credentials.
export function apiOrigin(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const url = new URL(raw);
  // URL parsing accepts punctuation in hostnames that would delimit CSP/header values.
  const safeHost = /^(?:[a-z\d.-]+|\[[a-f\d:]+\])$/i.test(url.hostname);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!safeHost || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && loopback)) {
    throw new Error('API configuration must be an HTTPS origin (HTTP loopback is allowed for local development).');
  }
  return url.origin;
}
