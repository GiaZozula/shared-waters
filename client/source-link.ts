/** Stored source strings are provenance, never executable navigation instructions. */
export function sourceLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function setSourceLink(link: HTMLAnchorElement, value: unknown): void {
  const url = sourceLinkUrl(value);
  if (url) link.href = url;
  else link.removeAttribute('href');
  link.rel = 'noopener noreferrer';
}
