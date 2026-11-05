import { createApiReadiness } from './api-readiness.js';
import { createAisPreview } from './ais-preview.js';
import { mountWarmup } from './warmup-view.js';
import { createAboutMembrane } from './shared-water/world/about/createAboutMembrane.js';
import './system-about.css';
import { mountSystemDiagrams } from './system-diagrams.js';
import { mountSystemReference } from './system-reference.js';
import { historicalReadiness } from './historical-readiness.js';
import { setSourceLink } from './source-link.js';
import { apiFetch } from './api-fetch.js';
import storySnapshotUrl from '../data/story/snapshot.json?url';
import './system-base.css';
import './readiness.css';
import {
  aisCoverageLabel,
  appliesToLabel,
  connectionStatusLabel,
  feedDataStatusLabel,
  occurrenceLabel,
  readinessLevelLabel,
  zoneAStateLabel,
} from './display-labels.js';
import { frameAt, instantForMinute, minuteForInstant, REPLAY_LAST_MINUTE, type Detection, type Notice, type ReplayData } from './replay-model.js';

type Level = 'checking' | 'ready' | 'attention' | 'unavailable' | 'note';
type Reading = { id: string; label: string; level: Level; detail: string; meta: Array<[string, string]>; body: HTMLElement | null; error: string | null; badge?: string };
const COMPLIANCE = [
  'A recent fetch is not a recent observation.',
  'A missing or unverified notice does not mean the water is unrestricted.',
  'A vessel-hour is not a track, an exact speed, or a compliance finding.',
  'No AIS position means unknown coverage, not an empty sea.',
  'Whale coordinates locate the glider, and the source clock is not UTC.',
  'This is a reading of public records, not a navigation or enforcement tool.',
];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}
function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function ageLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return 'Age unavailable';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
function utcLabel(value: string): string {
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}
function collectionText(mode: string | null, state: string | null): string {
  const modes: Record<string, string> = { 'on-demand': 'on-demand', always: 'always', disabled: 'disabled', 'daily-limit': 'daily allowance reached' };
  const states: Record<string, string> = { idle: 'idle', active: 'active', cooldown: 'cooldown', 'waiting-owner': 'waiting for an owner', disabled: 'disabled', 'daily-limit': 'daily allowance reached' };
  return `${mode ? modes[mode] ?? mode : 'unrecorded mode'}, ${state ? states[state] ?? state : 'unrecorded state'}`;
}
function reviewedWindow(replay: ReplayData): string {
  if (replay.start === '2026-09-13T00:00:00Z' && replay.end === '2026-09-20T00:00:00Z') return 'Reviewed window 13–19 September 2026.';
  return `Stored replay bounds ${replay.start} to ${replay.end}.`;
}
function linked(label: string, href: unknown) {
  const link = el('a');
    const text = el('span', undefined, label.toUpperCase());
    link.append(text);
    link.setAttribute('aria-label', label);
  setSourceLink(link, href);
  return link;
}
function paragraph(parts: Array<Node | string>) {
  const node = el('p');
  node.append(...parts);
  return node;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(path, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok && path !== '/api/health') throw new Error(`HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

function feedMeta(value: Record<string, unknown> | null, dataDate: string | null): Array<[string, string]> {
  const fetch = asRecord(value?.fetch);
  return [
    ['Last attempt', textValue(fetch?.checkedAt) ? utcLabel(textValue(fetch?.checkedAt)!) : 'Not recorded'],
    ['Last success', textValue(fetch?.lastSuccessAt) ? utcLabel(textValue(fetch?.lastSuccessAt)!) : 'Not recorded'],
    ['Record age', ageLabel(dataDate)],
  ];
}

function marineBody(value: Record<string, unknown>) {
  const observation = asRecord(asRecord(value.data)?.observation);
  if (!observation) return null;
  return paragraph([
    `Valid ${textValue(observation.validAt) ?? 'at an unrecorded time'}. Grid ${numberValue(observation.gridLatitude) ?? 'unknown'}, ${numberValue(observation.gridLongitude) ?? 'unknown'}. Wave height ${numberValue(observation.waveHeightM) ?? 'unknown'} m. Sea surface temperature ${numberValue(observation.seaSurfaceTemperatureC) ?? 'unknown'} °C. Current ${numberValue(observation.oceanCurrentVelocityKmh) ?? 'unknown'} km/h. `,
    linked('Open-Meteo Marine', value.sourceUrl),
  ]);
}

function whoiBody(value: Record<string, unknown>) {
  const data = asRecord(value.data);
  const review = asRecord(data?.latestReview);
  const detection = Array.isArray(data?.indexedDetections) ? asRecord(data.indexedDetections[0]) : null;
  if (!review && !detection) return null;
  const node = el('div');
  if (review) node.append(paragraph(['Latest review ', linked(textValue(review.reviewDate) ?? 'review', review.sourceUrl), `. Right-whale rows: ${numberValue(review.detectionCount) ?? 'unknown'}.`]));
  if (detection) node.append(paragraph(['Latest detection ', linked(textValue(detection.sourceLocalTime) ?? 'detection', detection.sourceUrl), ` (${occurrenceLabel(textValue(detection.occurrence) ?? '')}). Glider ${numberValue(detection.platformLatitude) ?? 'unknown'}, ${numberValue(detection.platformLongitude) ?? 'unknown'}.`]));
  return node;
}

function navwarnBody(value: Record<string, unknown>) {
  const notice = asRecord(asRecord(value.data)?.notice);
  if (!notice) return null;
  return paragraph([
    'Latest notice ',
    linked(textValue(notice.sourceRecordId) ?? 'notice', notice.sourceUrl),
    `. Published ${textValue(notice.publishedAt) ? utcLabel(textValue(notice.publishedAt)!) : 'unrecorded'}. Effective ${textValue(notice.effectiveAt) ? utcLabel(textValue(notice.effectiveAt)!) : 'unrecorded'}. ${zoneAStateLabel(textValue(notice.zoneAState) ?? '')}. ${appliesToLabel(textValue(notice.appliesTo) ?? '')}.`,
    textValue(notice.cancels) ? ` Cancels ${textValue(notice.cancels)}.` : '',
  ]);
}

function feedReading(id: string, label: string, value: Record<string, unknown> | null, healthy: string, body: (value: Record<string, unknown>) => HTMLElement | null): Reading {
  if (!value) return { id, label, level: 'unavailable', detail: 'Could not be loaded.', meta: [], body: null, error: null };
  const fetch = asRecord(value.fetch);
  const data = asRecord(value.data);
  const status = textValue(data?.status) ?? 'unknown';
  const dataDate = textValue(asRecord(data?.observation)?.validAt) ?? textValue(asRecord(data?.latestReview)?.reviewDate) ?? textValue(asRecord(data?.notice)?.publishedAt);
  const failed = fetch?.status === 'error' || fetch?.status === 'never';
  return {
    id, label,
    level: failed || status !== healthy ? 'attention' : 'ready',
    detail: `${feedDataStatusLabel(status)}${fetch?.status === 'error' ? '. Latest refresh failed.' : ''}`,
    meta: feedMeta(value, dataDate),
    body: body(value),
    error: textValue(fetch?.error),
  };
}

function aisReading(value: Record<string, unknown> | null): Reading {
  if (!value) return { id: 'ais', label: 'AISStream', level: 'unavailable', detail: 'Could not be loaded.', meta: [], body: null, error: null };
  const connection = asRecord(value.connection);
  const data = asRecord(value.data);
  const collection = asRecord(value.collection);
  const positions = Array.isArray(data?.positions) ? data.positions.length : null;
  const status = textValue(connection?.status) ?? 'unknown';
  const coverage = textValue(data?.status) ?? 'unknown';
  const meta: Array<[string, string]> = [
    ['Connection', connectionStatusLabel(status)],
    ['Frames received', String(numberValue(connection?.framesReceived) ?? 'Unknown')],
    ['Unparsed', String(numberValue(connection?.framesUnparsed) ?? 'Unknown')],
    ['Outside Zone A', String(numberValue(connection?.framesOutside) ?? 'Unknown')],
    ['Stored', String(numberValue(connection?.framesStored) ?? 'Unknown')],
    ['Positions in 30 minutes', String(positions ?? 'Unknown')],
    ['Coverage', aisCoverageLabel(coverage)],
    ['Last attempt', textValue(connection?.checkedAt) ? utcLabel(textValue(connection?.checkedAt)!) : 'Not recorded'],
  ];
  if (collection) {
    meta.push(
      ['Collection', collectionText(textValue(collection.mode), textValue(collection.state))],
      ['Idle bound', collection.idleSeconds === undefined ? 'Not recorded' : `${collection.idleSeconds} seconds`],
      ['Session bound', collection.maxActiveSeconds === undefined ? 'Not recorded' : `${collection.maxActiveSeconds} seconds`],
      ['Daily AIS allowance', numberValue(collection.dailyLimitSeconds) === null ? 'Not reported' : `${Number(collection.dailyLimitSeconds) / 3600} hours shared across visitors`],
    );
  }
  const ready = status === 'connected' && coverage === 'recent_messages';
  return { id: 'ais', label: 'AISStream', level: ready ? 'ready' : 'attention', detail: positions === null ? 'Position count is unknown.' : `${positions} positions in the recent window.`, meta, body: null, error: textValue(connection?.lastError) };
}

function storyReading(historical: Record<string, unknown> | null, replay: Record<string, unknown> | null): Reading {
  const readiness = historicalReadiness(historical, replay);
  return { id: 'story', label: 'Story archive · API', level: readiness.level, detail: readiness.level === 'ready' ? 'Reviewed archive available.' : readiness.detail, meta: [], body: null, error: null };
}

async function inspect(): Promise<{ readings: Reading[] }> {
  const started = performance.now();
  const paths = ['/api/health', '/api/historical/presence?limit=1', '/api/current/marine', '/api/current/whoi', '/api/current/navwarn', '/api/ask/status', '/api/current/ais', '/api/story/replay'];
  const results = await Promise.allSettled(paths.map(readJson));
  const elapsedMs = Math.round(performance.now() - started);
  const get = (index: number) => results[index].status === 'fulfilled' ? results[index].value : null;
  const health = get(0);
  const ask = get(5);
  const marine = get(2);
  const whoi = get(3);
  const navwarn = get(4);
  const ais = get(6);
  const reported = typeof health?.api === 'string' || typeof health?.database === 'string';
  const apiReady = health?.api === 'connected';
  const databaseReady = health?.database === 'connected';
  return {
    readings: [
      { id: 'browser', label: 'This browser', level: 'note', badge: 'visit', detail: 'Interface loaded.', meta: [['Status pass', `${elapsedMs} ms`]], body: null, error: null },
      { id: 'host', label: 'Frontend host', level: 'note', badge: 'loaded', detail: 'Serves the interface and saved Story.', meta: [], body: null, error: null },
      { id: 'api', label: 'API', level: apiReady ? 'ready' : 'unavailable', detail: apiReady ? 'The process answered.' : 'The process did not answer.', meta: [], body: null, error: null },
      { id: 'postgres', label: 'PostgreSQL', level: databaseReady ? 'ready' : reported ? 'attention' : 'unavailable', detail: databaseReady ? 'A database read succeeded.' : reported ? 'A database read did not succeed.' : 'Could not be loaded.', meta: [], body: null, error: null },
      storyReading(get(1), get(7)),
      { id: 'model', label: 'LLM · model questions', level: 'note', badge: ask?.configured === true ? 'enabled' : ask?.configured === false ? 'off' : 'unknown', detail: 'Configuration only. Provider health and remaining question allowance are not checked.', meta: [], body: null, error: null },
      feedReading('marine', 'Open-Meteo Marine', marine, 'fresh', marineBody),
      feedReading('whoi', 'WHOI analyst reviews', whoi, 'recent_review', whoiBody),
      feedReading('navwarn', 'Coast Guard NAVWARN', navwarn, 'latest_published_notice', navwarnBody),
      aisReading(ais),
    ],
  };
}

function replayFrom(value: unknown): ReplayData | null {
  const body = asRecord(value);
  const data = asRecord(body?.data) ?? body;
  if (!data || !Array.isArray(data.presence) || !Array.isArray(data.notices) || !Array.isArray(data.detections)) return null;
  if (data.status !== 'ready' && data.status !== 'not_imported' && data.status !== 'incomplete') return null;
  return data as ReplayData;
}

function mount(main: HTMLElement) {
  createAboutMembrane();
  const readiness = createApiReadiness();
  const live = createAisPreview({ readiness, mode: 'system', sitewide: true });
  const stopNotifications = mountWarmup(document.body, readiness, live);
  const visible = () => { live.setVisible(!document.hidden); if (!document.hidden) void readiness.start(); };
  document.addEventListener('visibilitychange', visible);
  for (const name of ['pointerdown', 'keydown', 'scroll', 'touchstart']) document.addEventListener(name, () => live.activity(), { passive: true, capture: true });
  requestAnimationFrame(() => requestAnimationFrame(visible));
  window.addEventListener('pagehide', () => { live.close(); readiness.close(); stopNotifications(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  const navigation = el('nav', 'system-navigation');
  navigation.setAttribute('aria-label', 'Explore Shared Waters');
  for (const [label, href] of [['Intro', '/'], ['Story', '/?mode=story'], ['Live', '/?mode=live'], ['System', '/system']]) {
    const link = el('a');
    const text = el('span', undefined, label.toUpperCase());
    link.append(text);
    link.setAttribute('aria-label', label);
    link.href = href;
    if (label === 'System') link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }
  main.append(navigation, el('h1', undefined, 'The systems behind Shared Waters'), el('p', 'lede', 'How the data is collected, served, and presented, with current service status and saved records.'));
  const tablist = el('div', 'page-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Explore the system');
  const panels = ['Architecture', 'Status', 'Records'].map((name) => {
    const panel = el('section', 'tab-panel');
    panel.id = name.toLowerCase();
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${panel.id}`);
    return panel;
  });
  const tabs = panels.map((panel, index) => {
    const button = el('button', undefined, ['Architecture', 'Status', 'Records'][index]);
    button.type = 'button';
    button.id = `tab-${panel.id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => showTab(index));
    button.addEventListener('keydown', (event) => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % 3;
      else if (event.key === 'ArrowLeft') next = (index + 2) % 3;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 2;
      else return;
      event.preventDefault();
      showTab(next);
      tabs[next].focus();
    });
    tablist.append(button);
    return button;
  });
  function showTab(index: number) {
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    history.replaceState(null, '', index === 0 ? `${location.pathname}${location.search}` : `#${panels[index].id}`);
  }
  main.append(tablist, ...panels);
  const [architecture, status, recordsPanel] = panels;
  architecture.append(
    el('p', 'architecture-intro', 'Shared Waters began as a 72-hour technical exercise to build a deployed demo with natural-language input, three or more real-time feeds, timeline replay, and a technology new to me.'),
    el('p', 'architecture-intro', 'I decided to give it some more polish as a fun system design exercise.'),
    el('p', 'architecture-intro', 'This page follows the data through the application and explains the decisions behind its structure. Below are five animated walkthroughs focused on specific parts of the system.'),
  );
  mountSystemDiagrams(architecture);
  mountSystemReference(architecture);
  const sourceHead = el('div', 'section-head');
  const recheck = el('button', undefined, 'Recheck');
  recheck.type = 'button';
  sourceHead.append(el('p', 'tab-description', 'Check API and database availability, source freshness and collection state. Recheck reads the latest stored state. AIS reads can also request bounded vessel collection.'), recheck);
  const checked = el('p', 'checked-at', 'Checking stored status…');
  checked.setAttribute('role', 'status');
  const grid = el('div', 'readiness-grid');
  status.append(sourceHead, checked, el('p', 'record-help', 'Availability and data freshness are separate. A successful fetch does not make an old observation current. Marine conditions are modeled. WHOI detection times use the source-local clock. These status cards update on page load and Recheck. The separate Live indicator checks vessel collection while you browse.'), grid);
  recordsPanel.append(el('p', 'tab-description', 'Explore the saved Zone A Story from 13–19 September 2026. Choose a time for vessel records and notice context, then browse acoustic reviews from the full week. These records load independently of the API.'));
  const records = el('div', 'records');
  const compliance = el('details', 'compliance');
  compliance.append(el('summary', undefined, 'Record limitations'), ...COMPLIANCE.map((line) => el('p', undefined, line)));
  recordsPanel.append(records, compliance);
  let readings: Reading[] = [];
  let replay: ReplayData | null = null;
  let minute = 0;
  function drawReadings() {
    grid.replaceChildren(...readings.filter((reading) => reading.id !== 'browser').map((reading) => {
      const card = el('article', `readiness-card ${reading.level}`);
      const head = el('div', 'readiness-card-head');
      head.append(el('h3', undefined, reading.label), el('span', `readiness-badge ${reading.level}`, reading.badge ?? readinessLevelLabel(reading.level)));
      card.append(head, el('p', undefined, reading.detail));
      if (reading.body) card.append(reading.body);
      if (reading.meta.length) {
        const meta = el('dl', 'readiness-meta');
        for (const [name, value] of reading.meta) meta.append(el('dt', undefined, name), el('dd', undefined, value));
        card.append(meta);
      }
      if (reading.error) card.append(el('p', 'readiness-error', reading.error));
      return card;
    }));
  }
  const syncTab = () => showTab(location.hash === '#records' ? 2 : location.hash === '#status' ? 1 : 0);
  window.addEventListener('hashchange', syncTab);
  syncTab();

  const frameHost = el('div');
  const timeLabel = el('label');
  timeLabel.htmlFor = 'status-time';

  function drawRecords() {
    records.replaceChildren();
    if (!replay) {
      records.append(el('p', undefined, 'The reviewed snapshot could not be loaded from this host.'));
      return;
    }
    records.append(el('p', 'record-totals', `${reviewedWindow(replay)} ${replay.presence.length} vessel-hours · ${replay.notices.length} notices · ${replay.detections.length} acoustic records`));
    if (replay.status !== 'ready') records.append(el('p', 'record-warning', replay.status === 'not_imported' ? 'Vessel records have not been imported. Counts are unavailable.' : 'This snapshot is incomplete. Treat vessel counts as partial.'));
    const selection = el('section', 'record-selection');
    selection.append(el('h2', undefined, 'Explore by time'), el('p', 'record-help', 'The time selects one hour of vessel records and the notice effective at that instant. Move the slider or jump to a notice below.'));
    const slider = el('input') as HTMLInputElement;
    slider.id = 'status-time';
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(REPLAY_LAST_MINUTE);
    slider.value = String(minute);
    slider.step = '1';
    slider.setAttribute('aria-describedby', 'record-time-help');
    slider.addEventListener('input', () => { minute = Number(slider.value); drawFrame(); });
    const jumps = el('div', 'mode-row');
    for (const [label, next] of [['Start', 0], ['End', REPLAY_LAST_MINUTE]] as const) {
      const button = el('button', undefined, label);
      button.type = 'button';
      button.addEventListener('click', () => { minute = next; slider.value = String(minute); drawFrame(); });
      jumps.append(button);
    }
    const notices = el('ul');
    for (const notice of replay.notices) notices.append(noticeItem(notice, slider));
    const detections = el('ul');
    for (const detection of replay.detections) detections.append(detectionItem(detection));
    const help = el('p', 'record-help', 'Vessel counts cover the whole selected hour. Notice changes can occur within that hour. Empty hours do not establish an absence of vessels.');
    help.id = 'record-time-help';
    const limits = el('div', 'record-time-bounds');
    limits.append(el('span', undefined, '13 Sep · 00:00 UTC'), el('span', undefined, '19 Sep · 23:59 UTC'));
    selection.append(timeLabel, slider, limits, jumps, help, frameHost);
    const noticeSection = el('section', 'record-section record-notices');
    noticeSection.append(el('h3', undefined, 'Notice timeline'), el('p', 'record-help', 'All notices in this saved week. Select a change to inspect its effective time.'), notices);
    if (!replay.notices.length) notices.append(el('li', undefined, 'No notices stored for this window. Restriction state remains unknown.'));
    const acousticSection = el('section', 'record-section');
    acousticSection.append(el('h2', undefined, 'Acoustic reviews · full week'), el('p', 'record-help', 'These records stay visible as you change the time. Their source-local clock has no verified UTC offset, so they cannot be aligned to the slider. Coordinates locate the listening glider.'), detections);
    if (!replay.detections.length) detections.append(el('li', undefined, 'No acoustic records stored for this window. This does not establish whale absence.'));
    selection.append(noticeSection);
    records.append(selection, acousticSection);
    drawFrame();
  }

  function drawFrame() {
    if (!replay) return;
    timeLabel.textContent = `Selected time: ${utcLabel(instantForMinute(minute))}`;
    const slider = records.querySelector<HTMLInputElement>('#status-time');
    slider?.setAttribute('aria-valuetext', utcLabel(instantForMinute(minute)));
    slider?.style.setProperty('--range-progress', `${minute / REPLAY_LAST_MINUTE * 100}%`);
    const frame = frameAt(replay, minute);
    const evidence = el('details');
    evidence.append(el('summary', undefined, `View ${frame.presence.length} vessel records`));
    const list = el('ul');
    for (const row of frame.presence) {
      const item = el('li');
      item.append(linked(row.shipName ?? 'Unnamed vessel', row.sourceUrl), ` · ${row.speedBandGroup === 'bands_below_or_up_to_10' ? 'Up to 10 knots' : '10 knots and above'}. Position ${row.latitude}, ${row.longitude}.`);
      list.append(item);
    }
    evidence.append(list);
    const counts = replay.status === 'not_imported' ? 'Vessel counts unavailable.' : frame.presence.length
      ? `${frame.presence.length} vessel-hours. ${frame.lowerCategory} in categories up to 10 knots and ${frame.upperCategory} in categories from 10 knots upward.`
      : 'No vessel records stored for this hour. Traffic is unknown.';
    frameHost.replaceChildren(el('h3', undefined, `Hour beginning ${utcLabel(frame.hour)}`), el('p', undefined, counts), noticeLine(frame.notice));
    if (frame.presence.length) frameHost.append(evidence);
    if (replay.notices.some(notice => Date.parse(notice.effectiveAt) > Date.parse(frame.hour) && Date.parse(notice.effectiveAt) < Date.parse(frame.hour) + 3_600_000)) {
      frameHost.append(el('p', 'record-warning', 'A notice changes during this hour. Its vessel-hours cannot be assigned wholly before or after that change.'));
    }
  }

  function noticeItem(notice: Notice, slider: HTMLInputElement) {
    const item = el('li');
    const jump = el('button', undefined, `${notice.zoneAState === 'no_restriction_stated' ? 'Restriction lifted' : notice.zoneAState === 'restricted_10_knots' ? 'Restriction begins' : zoneAStateLabel(notice.zoneAState)} · ${utcLabel(notice.effectiveAt)}`);
    jump.type = 'button';
    jump.addEventListener('click', () => { minute = minuteForInstant(notice.effectiveAt); slider.value = String(minute); drawFrame(); });
    item.append(jump, paragraph([linked(notice.sourceRecordId, notice.sourceUrl), ` · Published ${utcLabel(notice.publishedAt)}. ${appliesToLabel(notice.appliesTo)}.${notice.cancels ? ` Cancels ${notice.cancels}.` : ''}`]));
    return item;
  }

  function detectionItem(detection: Detection) {
    const item = el('li');
    const disclosure = el('details');
    const [date, time] = detection.sourceLocalTime.split(' ');
    const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    disclosure.append(el('summary', undefined, `${day} at ${time ?? 'unknown time'} (source local) · ${occurrenceLabel(detection.occurrence)}`), el('p', undefined, 'Source local time. UTC offset is unverified.'), paragraph([`Glider position ${detection.platformLatitude}, ${detection.platformLongitude}. `, linked('View acoustic record', detection.sourceUrl)]));
    item.append(disclosure);
    return item;
  }

  function noticeLine(notice: Notice | null) {
    if (!notice) return el('p', undefined, 'No stored notice is effective at this time. Restriction state is unknown.');
    return paragraph(['Notice at the selected time: ', linked(notice.sourceRecordId, notice.sourceUrl), ` (${zoneAStateLabel(notice.zoneAState)}. ${appliesToLabel(notice.appliesTo)}).`]);
  }

  async function refresh() {
    recheck.disabled = true;
    checked.textContent = 'Checking stored status…';
    const result = await inspect();
    readings = result.readings;
    drawReadings();
    checked.textContent = `Checked ${utcLabel(new Date().toISOString())}.`;
    recheck.disabled = false;
  }

  async function loadSnapshot() {
    try {
      const response = await fetch(storySnapshotUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      replay = replayFrom(payload);
    } catch {
      replay = null;
    }
    drawRecords();
  }

  recheck.addEventListener('click', () => { void refresh(); });
  void loadSnapshot();
  void refresh();
}

if (typeof document !== 'undefined') {
  const main = document.querySelector('main');
  if (main) mount(main);
}
