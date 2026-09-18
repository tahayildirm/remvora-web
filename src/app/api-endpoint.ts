// The deployment may set a public API origin; no credentials belong here.
export function apiOrigin(): string {
  const configured = document
    .querySelector<HTMLMetaElement>('meta[name="remvora-api-origin"]')
    ?.content.trim();
  if (!configured) return location.origin;
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('INVALID_API_ORIGIN');
  return url.origin;
}
export function signalingUrl(): string {
  const url = new URL('/ws/browser', apiOrigin());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
