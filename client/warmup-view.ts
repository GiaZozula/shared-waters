import './live-notification.css'
import type { ApiReadiness } from './api-readiness.js'
import type { AisPreview } from './ais-preview.js'

export function mountWarmup(parent: HTMLElement, readiness: ApiReadiness, ais: AisPreview) {
  const box = document.createElement('aside')
  box.className = 'api-warmup'
  box.setAttribute('aria-label', 'Live connection status')
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const elapsed = document.createElement('span')
  elapsed.setAttribute('aria-hidden', 'true')
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.setAttribute('aria-description', 'Try the online connection again. Story remains available while offline.')
  retry.addEventListener('click', () => {
    if (retry.getAttribute('aria-disabled') === 'true') return
    if (readiness.snapshot().state === 'unavailable') void readiness.start()
    else ais.retry()
  })
  let connected = false;
  let detailsOpen = false;
  const indicator = document.createElement('button');
  indicator.type = 'button';
  indicator.className = 'api-warmup__indicator';
  indicator.textContent = 'Live connected';
  indicator.setAttribute('aria-label', 'Show Live connection details');
  status.id = 'live-connection-detail';
  indicator.setAttribute('aria-describedby', status.id);
  indicator.addEventListener('click', () => { detailsOpen = !detailsOpen; render() });
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape' && connected) { detailsOpen = false; render(); indicator.focus(); }
  });
  box.addEventListener('focusout', event => { if (!box.contains(event.relatedTarget as Node | null)) { detailsOpen = false; render(); } });
  const render = () => {
    const api = readiness.snapshot()
    const feed = ais.snapshot()
    const rawMessage = api.state === 'ready' ? feed.message
      : api.state === 'unavailable' ? 'Service unavailable. Story still works.'
      : 'Starting the service. Story is ready to explore.'
    const message = `Live: ${rawMessage}`;
    connected = api.state === 'ready' && feed.state === 'connected';
    if (!connected) detailsOpen = false;
    box.classList.toggle('is-connected', connected);
    box.classList.toggle('is-details-open', detailsOpen);
    indicator.hidden = !connected;
    indicator.setAttribute('aria-expanded', String(detailsOpen));
    if (status.textContent !== message) status.textContent = message
    elapsed.textContent = api.state === 'loading' ? ` ${api.elapsedSeconds}s elapsed.` : ''
    retry.hidden = api.state !== 'unavailable' && !(api.state === 'ready' && ['unavailable', 'paused'].includes(feed.state)) && document.activeElement !== retry
    retry.textContent = api.state === 'unavailable' ? 'Retry' : feed.state === 'paused' ? 'Resume' : 'Check again'
    if (feed.message.includes('allowance has been reached')) retry.hidden = true
    retry.setAttribute('aria-disabled', String((api.state === 'unavailable' && api.retryAfterSeconds > 0) || ['idle', 'loading'].includes(api.state) || feed.state === 'checking'))
    box.dataset.state = api.state === 'ready' ? feed.state : api.state
  }
  retry.addEventListener('blur', render)
  const unsubscribe = readiness.subscribe(render)
  const unsubscribeAis = ais.subscribe(render)
  const timer = setInterval(render, 1000)
  const line = document.createElement('div')
  line.className = 'api-warmup__line'
  line.append(status, retry)
  box.append(indicator, line, elapsed); parent.append(box)
  return () => { clearInterval(timer); unsubscribe(); unsubscribeAis(); box.remove() }
}
