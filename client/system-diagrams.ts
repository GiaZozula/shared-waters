type Node = { id: string; x: number; y: number; title: string; sub?: string; detail: string; decision?: boolean };
type Edge = { id: string; d: string; label?: string; x?: number; y?: number; dashed?: boolean };
type Step = { node: string; edges: string[]; text: string };
type Drawing = { title: string; summary: string; height: number; nodes: Node[]; edges: Edge[]; steps: Step[]; groups?: Array<{ x: number; y: number; w: number; h: number; label: string }> };
const n = (id: string, x: number, y: number, title: string, sub: string, detail: string, decision = false): Node => ({ id, x, y, title, sub, detail, decision });
const e = (id: string, d: string, label?: string, x?: number, y?: number, dashed = false): Edge => ({ id, d, label, x, y, dashed });

export const systemDrawings: Drawing[] = [
  {
    title: 'Overview', height: 720,
    summary: 'The services that make up Shared Waters and how data moves between them.',
    groups: [{ x: 315, y: 240, w: 380, h: 310, label: 'Render · one process' }],
    nodes: [
      n('pages', 50, 60, 'Cloudflare Pages', 'Interface + Story snapshot', 'Cloudflare delivers the interface and reviewed snapshot. Story playback works without the API.'),
      n('browser', 400, 60, 'Browser', 'Story and Live', 'The browser plays the saved Story locally and requests Live records through the API.'),
      n('api', 400, 300, 'Fastify API', 'Reads + question admission', 'The API reads stored evidence and enforces question limits before contacting the LLM.'),
      n('collector', 400, 450, 'Collector', 'Feeds + demand-driven AIS', 'The collector stores source records with their provenance. AIS follows bounded reader demand.'),
      n('sources', 50, 450, 'Public sources', 'WHOI · NAVWARN · Marine · AIS', 'WHOI reviews, Coast Guard notices, Open-Meteo conditions and AISStream positions keep separate source and fetch clocks.'),
      n('db', 770, 300, 'Neon', 'PostgreSQL', 'Neon stores evidence, source status, collector coordination and durable question limits.'),
      n('llm', 50, 300, 'LLM', 'Bounded tool selection', 'One model request selects tools. The API validates them and formats the answer from stored facts.'),
      n('metrics', 770, 450, 'Grafana', 'Private metrics', 'Render pushes bounded metrics while awake. Logs stay private. Missing telemetry does not prove downtime.'),
      n('archive', 770, 610, 'Reviewed GFW files', 'Deliberate historical import', 'Reviewed vessel-hour files are imported deliberately. Story snapshots are exported separately from the database.'),
    ],
    edges: [
      e('static', 'M250 95 H400', 'interface + snapshot', 325, 78),
      e('request', 'M500 130 V300', 'HTTPS reads + questions', 610, 210),
      e('read', 'M600 335 H770', 'bounded reads', 685, 319),
      e('result', 'M770 365 H600'),
      e('response', 'M520 300 V130'),
      e('modelresult', 'M250 350 H400'),
      e('model', 'M400 335 H250', 'one model request', 325, 319),
      e('ingest', 'M250 485 H400', 'source records', 325, 469),
      e('store', 'M600 485 H730 V355 H770', 'store evidence', 680, 468),
      e('metrics', 'M600 350 H675 V570 H870 V520', 'metrics push', 785, 590, true),
      e('import', 'M970 645 H995 V335 H970', 'import', 974, 560, true),
      e('export', 'M970 320 H1015 V20 H150 V60', 'reviewed snapshot export', 810, 18, true),
    ],
    steps: [
      { node: 'sources', edges: ['ingest'], text: 'Public sources supply whale reviews, notices, marine conditions and AIS positions.' },
      { node: 'collector', edges: ['store'], text: 'The collector checks and stores those records with their source times and provenance.' },
      { node: 'archive', edges: ['import'], text: 'Reviewed historical vessel files are imported separately into the same database.' },
      { node: 'db', edges: ['export'], text: 'A deliberate export produces the reviewed snapshot used by Story.' },
      { node: 'pages', edges: ['static'], text: 'Cloudflare delivers that snapshot and the interface to the browser.' },
      { node: 'browser', edges: ['request'], text: 'Story plays locally. Live and broader questions make requests to the API.' },
      { node: 'api', edges: ['read', 'result'], text: 'The API reads stored evidence from Neon and applies admission limits to model questions.' },
      { node: 'llm', edges: ['model', 'modelresult'], text: 'For an admitted question, one LLM request selects read tools. The API validates those choices.' },
      { node: 'api', edges: ['response'], text: 'The API returns records or an answer with evidence links to the browser.' },
      { node: 'metrics', edges: ['metrics'], text: 'Alongside those requests, the awake Render process sends private operational metrics to Grafana.' },
    ],
  },
  {
    title: 'Page loading', height: 880,
    summary: 'How the interface loads and connects to the API in Story and Live.',
    nodes: [
      n('open', 400, 30, 'Open the site', 'Intro · Story · Live', 'Cloudflare serves the interface before backend readiness is known.'),
      n('static', 400, 160, 'Load static assets', 'Cloudflare Pages', 'The saved Story and interface load from the static host.'),
      n('local', 50, 300, 'Story works locally', 'Playback + archive evidence', 'Story playback, source evidence and recognized local explanations do not need the API.'),
      n('wake', 400, 300, 'Check readiness', 'API + database', 'After first paint, one bounded wake request checks the API and database without calling sources or a model.'),
      n('ready', 400, 445, 'Ready?', 'API + database', 'A valid response confirms reachability. Source freshness and model availability remain separate.', true),
      n('retry', 50, 445, 'Unavailable', 'Manual retry', 'An unsuccessful check leaves Story usable and offers a manual retry.'),
      n('mode', 400, 600, 'Visible page?', 'Bounded browser session', 'Visible pages check AIS after readiness. Checks pause after 10 minutes idle or 30 minutes total, until Resume.', true),
      n('intro', 50, 760, 'Intro / System', 'Bounded AIS checks', 'The Live indicator checks vessel collection while this page is visible and the browser session is active.'),
      n('story', 400, 760, 'Story', 'Local replay + AIS checks', 'The historical Story remains local. Its separate Live indicator uses the same bounded browser session.'),
      n('live', 770, 760, 'Live reads', 'Repeat 15 sec after completion', 'Live reads current feeds and AIS. Hidden tabs stop reads. Each AIS read can extend shared demand.'),
    ],
    edges: [e('load', 'M500 100 V160', 'static delivery', 588, 137), e('local', 'M400 195 H150 V300', 'saved snapshot', 265, 179), e('wake', 'M500 230 V300', 'after first paint', 590, 273), e('check', 'M500 370 V437'), e('no', 'M388 480 H250', 'no', 325, 465), e('yes', 'M500 523 V592', 'yes', 525, 562), e('intro', 'M388 635 H150 V760', 'Intro', 255, 618), e('story', 'M500 678 V760', 'Story', 535, 715), e('live', 'M612 635 H870 V760', 'Live', 735, 618)],
    steps: [
      { node: 'open', edges: [], text: 'A visitor opens Intro, Story, Live or System.' },
      { node: 'static', edges: ['load'], text: 'Cloudflare delivers the interface and static assets first.' },
      { node: 'local', edges: ['local'], text: 'The saved Story can play and show evidence without waiting for the API.' },
      { node: 'wake', edges: ['wake'], text: 'After first paint, the browser asks the API to check readiness.' },
      { node: 'ready', edges: ['check'], text: 'The API checks the database. A valid response lets the browser start the relevant reads.' },
      { node: 'mode', edges: ['yes'], text: 'Visible pages share bounded AIS checks. Inactivity, session expiry and hiding the page pause those checks.' },
      { node: 'live', edges: ['live'], text: 'In Live, the browser reads stored feeds and AIS, then waits 15 seconds after completion before reading again.' },
      { node: 'live', edges: [], text: 'Those records appear with their own source clocks and coverage. Hiding Live stops further reads.' },
    ],
  },
  {
    title: 'Collection', height: 1080,
    summary: 'How source records are collected, stored and kept within operating limits.',
    nodes: [
      n('owner', 400, 30, 'Collector contender', 'One combined process today', 'Production runs one API and collector process. Separate API and worker roles are also implemented.'),
      n('lock', 400, 170, 'Own the lock?', 'Direct database session', 'A PostgreSQL session advisory lock selects the owner. A heartbeat alone cannot grant ownership.', true),
      n('wait', 50, 170, 'Wait and retry', 'No collection', 'A contender without the lock does not start source collection.'),
      n('runtime', 400, 320, 'Collection owner', 'Starts bounded upstream work', 'The owner checks durable source freshness and runs the AIS session policy.'),
      n('feeds', 50, 500, 'Scheduled feeds', 'Marine 15m · WHOI 1h · NAVWARN 30m', 'Fresh source rows skip fetching. Failed retries are bounded. Fetch time remains distinct from record time.'),
      n('session', 400, 500, 'AIS session', '15m active · 5m cooldown', 'AIS follows shared demand with a 15-minute session limit, five-minute cooldown and six-hour daily reservation allowance across all readers. Unused reserved time is not refunded.'),
      n('demand', 770, 500, 'Reader demand', 'Expires after 120 sec', 'Visible site pages and other AIS readers can extend shared database demand. Hidden or paused browsers stop renewing it.'),
      n('store', 400, 710, 'Store evidence', 'Records + provenance + clocks', 'Validated records retain source times separately from fetch times.'),
      n('db', 400, 920, 'Neon', 'PostgreSQL evidence', 'Stored source records are available to the API without a new upstream fetch.'),
      n('loss', 770, 710, 'Ownership lost', 'Abort feeds + terminate AIS', 'Loss of the ownership session aborts requests and terminates AIS before collection is attempted again.'),
    ],
    edges: [e('claim', 'M500 100 V162'), e('no', 'M388 205 H250', 'no', 325, 189), e('retry', 'M150 170 V65 H400', 'retry', 260, 50, true), e('yes', 'M500 248 V320', 'yes', 530, 285), e('feeds', 'M400 355 H150 V500', 'freshness checks', 245, 420), e('ais', 'M500 390 V500', 'session bounds', 580, 450), e('demand', 'M770 535 H600', 'shared demand', 685, 518), e('feedstore', 'M150 570 V745 H400', 'validated records', 265, 728), e('aisstore', 'M500 570 V710', 'AIS positions', 575, 650), e('save', 'M500 780 V920', 'persist', 540, 855), e('loss', 'M600 355 H980 V745 H970', 'session lost', 905, 340, true), e('stop', 'M870 780 V1000 H1000 V65 H600', 'stop and re-enter contention', 800, 1025, true)],
    steps: [
      { node: 'owner', edges: [], text: 'The collector process first enters ownership contention.' },
      { node: 'lock', edges: ['claim'], text: 'It must hold the PostgreSQL session lock before collecting. Other contenders wait.' },
      { node: 'runtime', edges: ['yes'], text: 'The owner starts source collection and checks stored freshness.' },
      { node: 'feeds', edges: ['feeds'], text: 'Scheduled feeds skip fresh records and bound failed retries.' },
      { node: 'demand', edges: ['demand', 'ais'], text: 'AIS follows reader demand, with a 15-minute active limit, five-minute cooldown and six-hour shared daily allowance.' },
      { node: 'store', edges: ['feedstore', 'aisstore'], text: 'Incoming records are validated and retain source times separately from fetch times.' },
      { node: 'db', edges: ['save'], text: 'Neon persists the evidence so the API can read it without fetching the source again.' },
    ],
  },
  {
    title: 'Questions', height: 1190,
    summary: 'How a question moves through admission, tool selection and evidence checks to an answer.',
    nodes: [
      n('input', 400, 30, 'Question + context', 'Mode + selected time', 'Recognized browser-local questions are answered before this API path.'),
      n('free', 400, 160, 'Free explanation?', 'Validate input first', 'The API validates the request and time scope. Recognized explanations need neither a model nor budget storage.', true),
      n('explain', 50, 160, 'Free explanation', 'No LLM call', 'Shared deterministic wording explains the records without spending model allowance.'),
      n('budget', 400, 310, 'Admission allowed?', 'PostgreSQL budget ledger', 'Enabled settings, available storage, rate limits, concurrency and the lifetime cap must allow one admission.', true),
      n('reject', 770, 310, 'Unavailable or retry', 'No provider request', 'Disabled, exhausted, busy or unavailable admission is rejected before the LLM request.'),
      n('llm', 400, 460, 'One LLM request', 'Select read tools', 'One request selects tools. The concurrency slot is released when it settles. Admitted calls stay spent, including failures.'),
      n('valid', 400, 620, 'Valid tool calls?', 'Names + arguments + scope', 'Every proposed call is checked before any tool runs. Invalid dates, duplicate tools and scope mismatches are rejected.', true),
      n('fallback', 50, 620, 'No tool calls', 'Deterministic fallback', 'A completed response without function calls returns a deterministic explanation and an unsupported-question warning.'),
      n('error', 770, 620, 'Return an error', 'No guessed facts', 'Provider failures, invalid calls, query errors and unresolved evidence produce an error.'),
      n('reads', 400, 790, 'Read stored evidence', 'Validated tools run in sequence', 'Approved internal routes use bounded, parameterized database reads.'),
      n('evidence', 400, 940, 'Evidence resolves?', 'Verify cited record IDs', 'Every cited record must resolve in storage before the answer is returned.', true),
      n('answer', 400, 1080, 'Application answer', 'Facts + source links + warnings', 'The application formats the stored facts. Tool results are not sent back to the LLM.'),
    ],
    edges: [e('input', 'M500 100 V152'), e('free', 'M388 195 H250', 'yes', 325, 178), e('budget', 'M500 238 V302', 'no', 525, 270), e('reject', 'M612 345 H770', 'no', 685, 328), e('llm', 'M500 388 V460', 'yes', 525, 421), e('tools', 'M500 530 V612', 'proposed calls', 580, 575), e('empty', 'M388 655 H250', 'none', 325, 638), e('invalid', 'M612 655 H770', 'invalid', 685, 638), e('failure', 'M600 495 H870 V620', 'provider failure', 755, 478, true), e('execute', 'M500 698 V790', 'valid', 530, 744), e('resolve', 'M500 860 V932'), e('missing', 'M612 975 H990 V690 H870', 'read or evidence failure', 835, 1000, true), e('answer', 'M500 1018 V1080', 'yes', 525, 1045)],
    steps: [
      { node: 'input', edges: [], text: 'The browser sends a question with its mode, selected time and previous evidence references.' },
      { node: 'free', edges: ['input'], text: 'The API validates the request. Recognized explanations return immediately without a model call.' },
      { node: 'budget', edges: ['budget'], text: 'A model-assisted question must pass the durable admission limits before a call is spent.' },
      { node: 'llm', edges: ['llm'], text: 'One bounded LLM request proposes read tools. Its admission remains spent even if the provider fails.' },
      { node: 'valid', edges: ['tools'], text: 'The API checks every proposed tool, argument and time scope before any call runs.' },
      { node: 'reads', edges: ['execute'], text: 'Approved tools run sequentially and read stored evidence through bounded database queries.' },
      { node: 'evidence', edges: ['resolve'], text: 'The API verifies that the cited evidence records still resolve in storage.' },
      { node: 'answer', edges: ['answer'], text: 'The application writes the answer from those facts and returns sources and limitations. There is no second model call.' },
    ],
  },
  {
    title: 'Delivery', height: 920,
    summary: 'How code reaches the hosted application and how operations support it.',
    nodes: [
      n('change', 400, 30, 'Repository change', 'Reviewed source', 'One repository produces the separate frontend and backend artifacts.'),
      n('checks', 400, 180, 'CI checks', 'Types + builds + tests', 'Checks use stubbed providers, a disposable database and compiled artifact verification.'),
      n('container', 400, 340, 'Runtime checks', 'Container + collector failover', 'Portable container and ownership checks use fake upstreams.'),
      n('pages', 50, 340, 'Cloudflare Pages', 'Static frontend artifact', 'The frontend is delivered separately with its saved Story snapshot.'),
      n('trusted', 400, 500, 'Trusted main delivery', 'Migrations + runtime grants', 'Trusted main delivery serializes migration and verifies restricted runtime permissions.'),
      n('render', 400, 660, 'Render deployment', 'Exact commit + compiled server', 'Render runs the compiled backend. Hosted readiness and behavior are verified separately.'),
      n('verify', 400, 800, 'Hosted verification', 'Readiness + browser checks', 'A build pass is followed by hosted readiness and behavior checks. Local fixtures do not establish production health.'),
      n('metrics', 50, 660, 'Grafana', 'Private outbound metrics', 'The awake backend sends metrics without an external keepalive probe. Gaps mean unknown telemetry.'),
      n('db', 770, 500, 'PostgreSQL', 'Evidence + durable limits', 'Database recovery is a separate manual operating workflow.'),
      n('backup', 770, 660, 'Encrypted backup', 'Manual consistent snapshot', 'Backups retain a manifest, counts and hashes. They are not a background product feature.'),
      n('restore', 770, 800, 'Restore rehearsal', 'Isolated matching-major database', 'Rehearsals verify restoration in an isolated database. Offsite recovery evidence is tracked separately.'),
    ],
    edges: [e('test', 'M500 100 V180'), e('container', 'M500 250 V340'), e('pages', 'M400 215 H150 V340', 'separate static delivery', 250, 290), e('trusted', 'M500 410 V500', 'checks pass', 565, 459), e('deploy', 'M500 570 V660', 'compiled artifact', 590, 615), e('verify', 'M500 730 V800', 'hosted checks', 560, 770), e('metrics', 'M400 695 H250', 'metrics while awake', 325, 679), e('backup', 'M870 570 V660', 'manual backup', 935, 615), e('restore', 'M870 730 V800', 'verify recovery', 940, 770)],
    steps: [
      { node: 'change', edges: [], text: 'A repository change produces the frontend and backend artifacts.' },
      { node: 'checks', edges: ['test'], text: 'CI checks types, builds and behavior with stubbed providers and a disposable database.' },
      { node: 'container', edges: ['container'], text: 'Runtime checks verify the portable container and collector ownership behavior.' },
      { node: 'pages', edges: ['pages'], text: 'The static frontend artifact is delivered separately to Cloudflare Pages.' },
      { node: 'trusted', edges: ['trusted'], text: 'Trusted main delivery applies migrations deliberately and verifies runtime grants.' },
      { node: 'render', edges: ['deploy'], text: 'Render receives the compiled backend for the exact reviewed commit.' },
      { node: 'verify', edges: ['verify'], text: 'Hosted readiness and browser checks verify the running release.' },
    ],
  },
];

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Diagrams retain their topology on narrow screens with a vertical layout.
function pathEnds(path: string) {
  const tokens = path.match(/[MHV]|-?\d+(?:\.\d+)?/g)!;
  let x = 0, y = 0;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'M') { x = Number(tokens[i++]); y = Number(tokens[i++]); }
    else if (command === 'H') x = Number(tokens[i++]);
    else if (command === 'V') y = Number(tokens[i++]);
    points.push([x, y]);
  }
  return [points[0], points[points.length - 1]];
}
function nearestNode(nodes: Node[], [x, y]: number[]) {
  return [...nodes].sort((a, b) => {
    const distance = (n: Node) => Math.hypot(Math.max(n.x - x, 0, x - n.x - 200), Math.max(n.y - y, 0, y - n.y - 70)) * 100 + Math.hypot(n.x + 100 - x, n.y + 35 - y);
    return distance(a) - distance(b);
  })[0];
}

export function mountSystemDiagrams(host: HTMLElement) {
  const instructions = html('p', 'drawing-instructions', 'Select components for details or follow a walkthrough of how each part works.');
  const controls = html('div', 'drawing-tabs');
  controls.setAttribute('role', 'tablist');
  controls.setAttribute('aria-label', 'System drawings');
  const description = html('p', 'drawing-explanation');
  const toolbar = html('div', 'drawing-toolbar');
  const previous = html('button', '', 'Previous step');
  const next = html('button', '', 'Start walkthrough');
  previous.type = next.type = 'button';
  const stepPicker = html('div', 'drawing-steps');
  stepPicker.setAttribute('role', 'group');
  stepPicker.setAttribute('aria-label', 'Walkthrough steps');
  toolbar.append(previous, next, stepPicker);
  const viewport = html('div', 'drawing-viewport');
  viewport.id = 'system-drawing';
  viewport.setAttribute('role', 'tabpanel');
  const callout = html('aside', 'drawing-callout');
  callout.id = 'drawing-callout';
  callout.hidden = true;
  callout.setAttribute('aria-label', 'Diagram explanation');
  const calloutHead = html('div', 'callout-head');
  const move = html('button', 'callout-move', '⋮');
  move.type = 'button';
  move.setAttribute('aria-label', 'Move explanation. Drag or use arrow keys.');
  const close = html('button', 'callout-close', '×');
  close.type = 'button'; close.setAttribute('aria-label', 'Close explanation');
  const calloutTitle = html('h3', '');
  const calloutText = html('p', '');
  calloutText.id = 'drawing-callout-body';
  calloutHead.append(move, close);
  const calloutFooter = html('div', 'callout-footer');
  const back = html('button', '', 'Previous');
  const forward = html('button', '', 'Next');
  back.type = forward.type = 'button';
  calloutFooter.append(back, forward);
  callout.append(calloutHead, calloutTitle, calloutText, calloutFooter);
  calloutText.setAttribute('aria-live', 'polite');
  const tether = svg('svg', { class: 'callout-tether', 'aria-hidden': 'true' });
  const tetherLine = svg('path', { class: 'tether-line', 'marker-end': 'url(#callout-arrow)' });
  const defs = svg('defs');
  const arrow = svg('marker', { id: 'callout-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
  arrow.append(svg('polygon', { points: '0,0 10,5 0,10', fill: '#d2dfc4' })); defs.append(arrow); tether.append(defs, tetherLine);
  host.append(instructions, controls, description, toolbar, viewport);
  let current = 0;
  let step = -1;
  let selected: string | null = null;
  let trigger: SVGGElement | undefined;
  let canvas: SVGSVGElement;
  let calloutPosition = { x: 0, y: 0 };
  let drag: { x: number; y: number; startX: number; startY: number } | null = null;
  let layoutNodes: Node[] = [];
  const compact = matchMedia('(max-width: 1100px)');
  const buttons = systemDrawings.map((drawing, index) => {
    const button = html('button', '', drawing.title);
    button.type = 'button'; button.id = `drawing-tab-${index}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', viewport.id);
    button.addEventListener('click', () => draw(index));
    button.addEventListener('keydown', (event) => {
      const nextIndex = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (nextIndex < 0) return;
      event.preventDefault(); draw(nextIndex); buttons[nextIndex].focus();
    });
    controls.append(button); return button;
  });
  function syncSteps() {
    previous.disabled = step <= 0;
    calloutFooter.hidden = step < 0;
    back.disabled = step <= 0;
    forward.textContent = step === systemDrawings[current].steps.length - 1 ? 'Finish' : 'Next';
    next.disabled = step === systemDrawings[current].steps.length - 1;
    next.textContent = step < 0 ? 'Start walkthrough' : 'Next step';
    stepPicker.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(index === step)));
  }
  function closeCallout(restore = true) {
    callout.hidden = true; tether.style.display = 'none'; selected = null;
    canvas?.querySelectorAll('[aria-pressed]').forEach((node) => { node.setAttribute('aria-pressed', 'false'); node.setAttribute('aria-expanded', 'false'); node.removeAttribute('aria-describedby'); });
    canvas?.querySelectorAll('.active').forEach((edge) => edge.classList.remove('active'));
    step = -1; syncSteps();
    if (restore) trigger?.focus({ preventScroll: true });
  }
  function positionCallout(x: number, y: number) {
    const width = viewport.clientWidth, height = viewport.clientHeight;
    calloutPosition = { x: Math.max(8, Math.min(x, width - callout.offsetWidth - 8)), y: Math.max(8, Math.min(y, height - callout.offsetHeight - 8)) };
    callout.style.left = `${calloutPosition.x}px`; callout.style.top = `${calloutPosition.y}px`;
    const node = canvas.querySelector<SVGGElement>(`[data-node="${selected}"]`);
    if (!node) return;
    const box = node.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
    const nx = box.left - frame.left + box.width / 2, ny = box.top - frame.top + box.height / 2;
    const cx = Math.max(calloutPosition.x, Math.min(nx, calloutPosition.x + callout.offsetWidth));
    const cy = Math.max(calloutPosition.y, Math.min(ny, calloutPosition.y + callout.offsetHeight));
    tether.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const dx = nx - cx, dy = ny - cy;
    const fraction = Math.min(1, Math.abs(box.width / 2 / (dx || 1)), Math.abs(box.height / 2 / (dy || 1)));
    tetherLine.setAttribute('d', `M${cx} ${cy} L${nx - dx * fraction} ${ny - dy * fraction}`);
  }
  function selectNode(id: string, text?: string, index = -1) {
    const drawing = systemDrawings[current];
    const node = drawing.nodes.find((item) => item.id === id)!;
    selected = id; step = index;
    trigger = canvas.querySelector<SVGGElement>(`[data-node="${id}"]`)!;
    canvas.querySelectorAll<SVGGElement>('[data-node]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === trigger)); item.setAttribute('aria-expanded', String(item === trigger));
      if (item === trigger) item.setAttribute('aria-describedby', calloutText.id); else item.removeAttribute('aria-describedby');
    });
    calloutTitle.textContent = node.title; calloutText.textContent = text ?? node.detail;
    syncSteps();
    callout.hidden = false; tether.style.display = '';
    callout.classList.remove('callout-enter'); void callout.offsetWidth; callout.classList.add('callout-enter');
    const box = trigger.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
    const nx = box.left - frame.left, ny = box.top - frame.top;
    const sideSpace = frame.width - nx - box.width;
    const x = sideSpace > callout.offsetWidth + 24 ? nx + box.width + 24 : nx > callout.offsetWidth + 24 ? nx - callout.offsetWidth - 24 : (frame.width - callout.offsetWidth) / 2;
    const beside = sideSpace > callout.offsetWidth + 24 || nx > callout.offsetWidth + 24;
    const below = ny + box.height + 26;
    const y = beside ? ny : below + callout.offsetHeight < frame.height - 8 ? below : ny - callout.offsetHeight - 26;
    positionCallout(x, y);
    syncSteps();
    if (index < 0) callout.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  function showStep(index: number) {
    const drawing = systemDrawings[current];
    const item = drawing.steps[index];
    selectNode(item.node, item.text, index);
    canvas.querySelectorAll<SVGGElement>('[data-edge]').forEach((edge) => {
      edge.classList.remove('active');
      const motion = edge.querySelector<SVGAnimateMotionElement>('animateMotion');
      motion?.endElement();
      if (item.edges.includes(edge.dataset.edge!)) { edge.classList.add('active'); motion?.beginElement(); }
    });
    callout.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  back.addEventListener('click', () => { if (step > 0) showStep(step - 1); });
  forward.addEventListener('click', () => { if (step + 1 < systemDrawings[current].steps.length) showStep(step + 1); else closeCallout(); });
  previous.addEventListener('click', () => { if (step > 0) showStep(step - 1); });
  next.addEventListener('click', () => { if (step + 1 < systemDrawings[current].steps.length) showStep(step + 1); });
  close.addEventListener('click', () => closeCallout());
  viewport.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !callout.hidden) { event.preventDefault(); closeCallout(); } });
  move.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, startX: calloutPosition.x, startY: calloutPosition.y };
    move.setPointerCapture(event.pointerId); event.preventDefault();
  });
  move.addEventListener('pointermove', (event) => { if (drag) positionCallout(drag.startX + event.clientX - drag.x, drag.startY + event.clientY - drag.y); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) move.addEventListener(name, () => { drag = null; });
  move.addEventListener('keydown', (event) => {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    if (!delta[event.key]) return;
    event.preventDefault(); const [x, y] = delta[event.key]; positionCallout(calloutPosition.x + x, calloutPosition.y + y);
  });
  function draw(index: number) {
    current = index; step = -1; selected = null; callout.hidden = true; tether.style.display = 'none';
    const drawing = systemDrawings[index];
    description.textContent = drawing.summary;
    buttons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; });
    viewport.setAttribute('aria-labelledby', buttons[index].id);
    stepPicker.replaceChildren(...drawing.steps.map((item, i) => {
      const button = html('button', '', String(i + 1)); button.type = 'button';
      button.setAttribute('aria-label', `Step ${i + 1}: ${drawing.nodes.find((node) => node.id === item.node)!.title}`);
      button.addEventListener('click', () => showStep(i)); return button;
    }));
    syncSteps();
    const narrow = compact.matches;
    const width = narrow ? Math.min(400, Math.max(280, viewport.clientWidth - 2)) : 1040;
    const height = narrow ? drawing.nodes.length * 160 + 100 : drawing.height;
    const nodeOrder = Array.from(new Set([...drawing.steps.map((item) => item.node), ...drawing.nodes.map((node) => node.id)]));
    layoutNodes = drawing.nodes.map((node) => narrow ? { ...node, x: (width - 200) / 2, y: 50 + nodeOrder.indexOf(node.id) * 160 } : node);
    canvas = svg('svg', { class: narrow ? 'is-compact' : '', viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `${drawing.title} architecture diagram` });
    const defs = svg('defs');
    const marker = svg('marker', { id: 'drawing-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' });
    marker.append(svg('polygon', { points: '0,0 10,5 0,10', fill: '#b5c9ae' })); defs.append(marker); canvas.append(defs);
    for (const group of narrow ? [] : drawing.groups ?? []) {
      canvas.append(svg('rect', { x: group.x, y: group.y, width: group.w, height: group.h, rx: 8, class: 'drawing-boundary' }));
      const label = svg('text', { x: group.x + 16, y: group.y + 25, class: 'boundary-label' }); label.textContent = group.label; canvas.append(label);
    }
    drawing.edges.forEach((edge, i) => {
      let path = edge.d, lx = edge.x, ly = edge.y;
      if (narrow) {
        const [start, end] = pathEnds(edge.d);
        const from = layoutNodes.find((node) => node.id === nearestNode(drawing.nodes, start).id)!;
        const to = layoutNodes.find((node) => node.id === nearestNode(drawing.nodes, end).id)!;
        const side = i % 2 ? width - 60 + i % 3 * 10 : 60 - i % 3 * 10;
        const fromPort = i % 2 ? from.x + (from.decision ? 212 : 200) : from.x - (from.decision ? 12 : 0);
        const toPort = i % 2 ? to.x + (to.decision ? 212 : 200) : to.x - (to.decision ? 12 : 0);
        path = `M${fromPort} ${from.y + 35} H${side} V${to.y + 35} H${toPort}`;
        lx = side; ly = (from.y + to.y) / 2 + 35;
      }
      const group = svg('g', { 'data-edge': edge.id, class: 'drawing-edge' });
      group.append(svg('path', { d: path, class: edge.dashed ? 'edge-line dashed' : 'edge-line', 'marker-end': 'url(#drawing-arrow)' }));
      const dot = svg('circle', { r: 4, class: 'flow-dot' });
      const motion = svg('animateMotion', { dur: '1.1s', repeatCount: 1, begin: 'indefinite', fill: 'freeze', path });
      motion.addEventListener('beginEvent', () => { dot.style.visibility = 'visible'; });
      motion.addEventListener('endEvent', () => { dot.style.visibility = 'hidden'; });
      dot.append(motion); group.append(dot);
      if (edge.label) {
        const label = svg('text', { x: lx!, y: ly!, 'text-anchor': 'middle', class: 'edge-label' }); label.textContent = edge.label;
        const annotation = svg('g', { class: 'edge-annotation', 'data-label-transform': narrow ? `rotate(-90 ${lx} ${ly})` : '' });
        annotation.append(svg('rect', { class: 'edge-label-bg' }), label);
        group.append(annotation);
      }
      canvas.append(group);
    });
    for (const node of layoutNodes) {
      const group = svg('g', { class: 'drawing-node', role: 'button', tabindex: 0, 'data-node': node.id, 'aria-label': `${node.title}. ${node.sub}`, 'aria-pressed': 'false', 'aria-expanded': 'false', 'aria-controls': callout.id });
      if (node.decision) group.append(svg('polygon', { points: `${node.x + 14},${node.y - 8} ${node.x + 186},${node.y - 8} ${node.x + 212},${node.y + 47} ${node.x + 186},${node.y + 102} ${node.x + 14},${node.y + 102} ${node.x - 12},${node.y + 47}` }));
      else group.append(svg('rect', { x: node.x, y: node.y, width: 200, height: 106, rx: 4 }));
      const lines = (text: string) => {
        const result: string[] = [];
        for (const word of text.split(' ')) {
          const last = result.length - 1;
          if (last >= 0 && result[last].length + word.length + 1 <= 18) result[last] += ` ${word}`;
          else result.push(word);
        }
        return result;
      };
      const nameLines = lines(node.title);
      const name = svg('text', { x: node.x + 100, y: node.y + 22, 'text-anchor': 'middle', class: 'node-title' });
      nameLines.forEach((line, index) => {
        const span = svg('tspan', { x: node.x + 100, dy: index ? 19 : 0 }); span.textContent = line; name.append(span);
      });
      const subtitle = svg('text', { x: node.x + 100, y: node.y + 22 + nameLines.length * 19 + 3, 'text-anchor': 'middle', class: 'node-subtitle' });
      lines(node.sub ?? '').forEach((line, index) => {
        const span = svg('tspan', { x: node.x + 100, dy: index ? 19 : 0 }); span.textContent = line; subtitle.append(span);
      });
      group.append(name, subtitle);
      const select = () => {
        canvas.querySelectorAll<SVGGElement>('[data-edge]').forEach((edge) => edge.classList.remove('active'));
        selectNode(node.id);
      };
      group.addEventListener('click', select);
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      canvas.append(group);
    }
    // Centre the actual drawing bounds with equal margins, including long edge labels.
    viewport.replaceChildren(canvas, tether, callout);
    sizeDiagramText();
    if (!narrow) {
      const frame = canvas.getBoundingClientRect();
      const unit = frame.width / canvas.viewBox.baseVal.width;
      const boxes = Array.from(canvas.querySelectorAll<SVGGraphicsElement>('.drawing-node, .edge-line, .edge-annotation, .drawing-boundary, .boundary-label')).map((item) => {
        const bounds = item.getBoundingClientRect();
        return { x: canvas.viewBox.baseVal.x + (bounds.left - frame.left) / unit, y: canvas.viewBox.baseVal.y + (bounds.top - frame.top) / unit, width: bounds.width / unit, height: bounds.height / unit };
      });
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      const bounds = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
      canvas.setAttribute('viewBox', `${bounds.x - 28} ${bounds.y - 28} ${bounds.width + 56} ${bounds.height + 56}`);
    }
    sizeDiagramText();
  }
  function sizeDiagramText() {
    if (!canvas || !viewport.clientWidth || !canvas.getBoundingClientRect().width) return;
    const scale = Math.max(1, canvas.viewBox.baseVal.width / canvas.getBoundingClientRect().width);
    canvas.style.setProperty('--diagram-type-scale', String(scale));
    // Centre the actual text block, including wrapped lines, within each shape.
    for (const node of Array.from(canvas.querySelectorAll<SVGGElement>('.drawing-node'))) {
      const title = node.querySelector<SVGTextElement>('.node-title')!;
      const subtitle = node.querySelector<SVGTextElement>('.node-subtitle')!;
      const shape = node.querySelector<SVGGraphicsElement>('rect, polygon')!.getBBox();
      const titleBox = title.getBBox();
      const subtitleBox = subtitle.getBBox();
      const gap = 8 * scale;
      const subtitleShift = titleBox.y + titleBox.height + gap - subtitleBox.y;
      const textBottom = subtitleBox.y + subtitleBox.height + subtitleShift;
      const shift = shape.y + shape.height / 2 - (titleBox.y + textBottom) / 2;
      title.setAttribute('transform', `translate(0 ${shift})`);
      subtitle.setAttribute('transform', `translate(0 ${shift + subtitleShift})`);
    }
    // Place arrow labels using their measured bounds, clear of boxes and other labels.
    const obstacles = Array.from(canvas.querySelectorAll<SVGGraphicsElement>('.drawing-node rect, .drawing-node polygon, .boundary-label')).map(node => node.getBoundingClientRect());
    const unit = canvas.getBoundingClientRect().width / canvas.viewBox.baseVal.width;
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right + 4 && a.right > b.left - 4 && a.top < b.bottom + 4 && a.bottom > b.top - 4;
    for (const annotation of Array.from(canvas.querySelectorAll<SVGGElement>('.edge-annotation'))) {
      const label = annotation.querySelector<SVGTextElement>('text')!;
      const background = annotation.querySelector<SVGRectElement>('rect')!;
      const box = label.getBBox();
      background.setAttribute('x', String(box.x - 4 / unit));
      background.setAttribute('y', String(box.y - 2 / unit));
      background.setAttribute('width', String(box.width + 8 / unit));
      background.setAttribute('height', String(box.height + 4 / unit));
      const rotation = annotation.getAttribute('data-label-transform') ?? '';
      let positioned = false;
      for (const dy of [0, -16, 16, -32, 32, -48, 48, -64, 64, -80, 80, -96, 96]) {
        for (const dx of [0, -16, 16, -32, 32, -48, 48, -64, 64, -80, 80, -96, 96, -112, 112]) {
          annotation.setAttribute('transform', `translate(${dx / unit} ${dy / unit}) ${rotation}`);
          if (!obstacles.some(obstacle => overlaps(annotation.getBoundingClientRect(), obstacle))) { positioned = true; break; }
        }
        if (positioned) break;
      }
      obstacles.push(annotation.getBoundingClientRect());
    }
  }
  compact.addEventListener('change', () => draw(current));
  new ResizeObserver(() => { sizeDiagramText(); if (selected && !callout.hidden && viewport.clientWidth > 0) positionCallout(calloutPosition.x, calloutPosition.y); }).observe(viewport);
  draw(0);
  void document.fonts.ready.then(sizeDiagramText);
}
