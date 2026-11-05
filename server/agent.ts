import { describeWeather } from '../shared/weather-description.js';
import { injectInternalRead } from './internal-read.js';
import { STORY_START, STORY_END, matchesReviewedStory } from '../shared/story-scope.js';
import { requestLifetimeSignal } from './request-lifetime.js';
import { calendarDate, questionDates, requestsCurrent, STORY_FIRST_DATE, STORY_LAST_DATE, type QuestionMode } from '../shared/question-scope.js';
import { explanationTopic, explanationSentence, localExplanationTopic } from '../shared/explanations.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { parseInstant, parsePresenceWindow, PRESENCE_START, ZONE_ID } from './domain-queries.js';
import { aiPolicy, BudgetFailure, publishedAiLimits, reserveAiCall, visitorIdentity } from './ai-budget.js';

type ResponseItem = { type: string; name?: string; arguments?: string; call_id?: string };
type ModelResponse = { id: string; output: ResponseItem[]; status: string };
type ModelRequest = (body: Record<string, unknown>, signal: AbortSignal) => Promise<ModelResponse>;
type ToolName = 'get_detections_on_date' | 'get_restriction_at' | 'get_latest_detection' | 'compare_presence_bands' | 'get_current_state' | 'get_evidence_by_id' |
  'explain_records' | 'get_marine_conditions' | 'get_acoustic_review' | 'get_story_snapshot';
type AskBody = { question: string; mode?: QuestionMode; zoneId?: string; selectedTime?: string | null; previousEvidenceIds?: string[] };

class AgentFailure extends Error {
  constructor(readonly reason: 'missing_model_key' | 'provider_unavailable' | 'model_timeout' | 'evidence_unavailable') {
    super(reason);
  }
}

const instructions = `You answer questions about Dynamic Shipping Zone A using only the supplied read-only tools.
The request declares its Story or Live context. Story defaults to its reviewed calendar dates, not current feeds. Use get_detections_on_date for detections on an explicit requested date or the selected Story day. get_latest_detection in Story is automatically bounded to Story review dates through the selected calendar date; this does not establish whether source-local detections preceded a selected UTC instant. An explicit now/current request uses current reads and is labelled separately. Do not answer a dated detection question with aggregate story counts or a global latest/current review. get_marine_conditions, get_acoustic_review and get_current_state are current-only; historical marine conditions are unavailable through these tools. Explain that limit rather than substituting current conditions. Definitions use explain_records alone, without attaching unrelated prior evidence.
Choose only the tools needed, at most one call per tool. Use compare_presence_bands for historical GFW speed-category comparisons within ${STORY_START} inclusive to ${STORY_END} exclusive, get_restriction_at for a notice at a UTC instant, get_latest_detection for the latest indexed WHOI detection, get_current_state for current restriction and AIS freshness, and get_evidence_by_id only for one ID in Previous evidence IDs. Use get_marine_conditions for stored wave, temperature, and current model values, get_acoustic_review for the latest WHOI review day, and get_story_snapshot for what the 13–19 September story contains. Use explain_records for what the records cannot show, what Shared Waters is, or why the picture is not a navigation or compliance tool. For cause, legal compliance, exact speed from GFW, whale position, or whale absence, call explain_records and do not invent a measurement. For the 15 September notice comparison use before 2026-09-15T00:00:00Z–2026-09-15T12:00:00Z and after 2026-09-15T13:00:00Z–2026-09-16T00:00:00Z; the partial 12:00 hour cannot be classified. If a selected UTC time is provided, use exactly that instant for get_restriction_at. For a question about the current restriction, copy the Current UTC time exactly as the get_restriction_at instant; it has canonical second precision. Do not invent a UTC conversion for WHOI source-local times. If no measurement tool fits, call explain_records instead of guessing arguments. The application, not the model, will compose the answer from the query results.`;

const object = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object', properties, required, additionalProperties: false });
export const agentTools = [
  { type: 'function', name: 'get_restriction_at', description: 'Read the stored Zone A notice state at one UTC instant. Current state uses the latest verified search.',
    strict: true, parameters: object({ at: { type: 'string', description: 'Canonical UTC instant, YYYY-MM-DDTHH:mm:ssZ' } }, ['at']) },
  { type: 'function', name: 'get_latest_detection', description: 'Read the latest indexed WHOI right-whale acoustic detection. Source time is local with unresolved timezone.',
    strict: true, parameters: object({}, []) },
  { type: 'function', name: 'get_detections_on_date', description: 'Read bounded indexed WHOI rows for one source-local review calendar date. Use the Requested detection date or Selected Story calendar date from context, never invent a UTC conversion.',
    strict: true, parameters: object({ date: { type: 'string', description: 'YYYY-MM-DD source-local review date' } }, ['date']) },
  { type: 'function', name: 'compare_presence_bands', description: 'Compare two non-overlapping whole-hour windows of delayed GFW vessel-presence speed categories.',
    strict: true, parameters: object({ beforeStart: { type: 'string' }, beforeEnd: { type: 'string' },
      afterStart: { type: 'string' }, afterEnd: { type: 'string' } },
    ['beforeStart', 'beforeEnd', 'afterStart', 'afterEnd']) },
  { type: 'function', name: 'get_current_state', description: 'Read current Zone A notice verification and AIS connection/data freshness together.',
    strict: true, parameters: object({}, []) },
  { type: 'function', name: 'get_evidence_by_id', description: 'Read exactly one stored record whose ID was supplied in Previous evidence IDs.',
    strict: true, parameters: object({ id: { type: 'string' } }, ['id']) },
  { type: 'function', name: 'explain_records', description: 'Explain what Zone A records cannot show, what Shared Waters is, what a vessel-hour means, and which source limits apply. Use topic vessel_hours for a definition of GFW vessel-hours; use topic all unless the question is only about limits, the project, or the sources. Does not read a measurement.',
    strict: true, parameters: object({ topic: { type: 'string', enum: ['limits', 'project', 'sources', 'vessel_hours', 'detection', 'all'] } }, ['topic']) },
  { type: 'function', name: 'get_marine_conditions', description: 'Read the stored Open-Meteo marine model for Zone A: wave height, sea surface temperature, and ocean current, with freshness.',
    strict: true, parameters: object({}, []) },
  { type: 'function', name: 'get_acoustic_review', description: 'Read the latest indexed WHOI review day and up to ten indexed right-whale rows. Times are source-local. Coordinates locate the glider.',
    strict: true, parameters: object({}, []) },
  { type: 'function', name: 'get_story_snapshot', description: 'Summarize the stored 13–19 September 2026 Zone A story: vessel-presence hours, notices, and indexed detections.',
    strict: true, parameters: object({}, []) },
] as const;

const askMessages = {
  question_scope_mismatch: 'That reading does not match the requested date or Story/Live context. Ask for detections on one date, choose a precise Story time, or explicitly ask for current readings.',
  invalid_tool_arguments: 'That question could not be matched to a stored reading. Ask about a notice, a detection, vessel presence, current conditions, or what these records cannot show.',
  evidence_not_in_previous_answer: 'That record was not part of the previous answer, so it was not opened.',
  selected_time_mismatch: 'The notice time did not match the moment selected in the scene, so no reading was used.',
  invalid_selected_time: 'The selected time is not a UTC instant this scene can use.',
  ask_rate_limit: 'Too many questions were asked in the last minute. Wait a moment and try again.',
  ai_disabled: 'Paid questions are paused. You can still explore the scene and ask what the records mean.',
  ai_budget_unavailable: 'Paid questions are temporarily unavailable because their usage allowance could not be checked.',
  ai_budget_exhausted: 'The site’s paid-question allowance has been used up. Free explanations and browsing remain available.',
  ai_frequency_limit: 'The paid-question limit was reached. Please wait before trying again.',
  ai_busy: 'Another paid question is being answered. Please try again shortly.',
  missing_model_key: 'Questions are not configured on this server yet.',
  provider_unavailable: 'The question service did not respond.',
  model_timeout: 'The question took too long and was stopped.',
  evidence_unavailable: 'A cited record could not be found in storage.',
  unexpected_error: 'The question could not be answered from the stored records.',
  domain_data_unavailable: 'The stored records could not be read just now.',
  presence_window_exceeds_checked_snapshot_limit: 'That comparison window is larger than the checked snapshot, so it was not read.',
  story_snapshot_exceeds_reviewed_limit: 'The stored story is larger than the reviewed snapshot, so it was not summarized.',
  marine_data_unavailable: 'Marine model values could not be read just now.',
  whoi_data_unavailable: 'The acoustic review could not be read just now.',
  story_data_unavailable: 'The September story could not be read just now.',
  ais_data_unavailable: 'Current vessel reports could not be read just now.',
  unexpected_domain_error: 'That reading could not be completed from the stored records.',
} as const;


function askFailure(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, status: number,
  error: string, extra: Record<string, unknown> = {}) {
  const domainError = typeof extra.domainError === 'string' ? extra.domainError : null;
  const reason = typeof extra.reason === 'string' ? extra.reason : null;
  const message = askMessages[domainError as keyof typeof askMessages] ??
    askMessages[reason as keyof typeof askMessages] ??
    askMessages[error as keyof typeof askMessages] ?? askMessages.unexpected_error;
  return reply.code(status).send({ error, message, ...extra });
}

export async function deepseekModelRequest(body: Record<string, unknown>, signal: AbortSignal): Promise<ModelResponse> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new AgentFailure('missing_model_key');
  const response = await fetch('https://api.deepseek.com/responses', {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new AgentFailure('provider_unavailable');
  return await response.json() as ModelResponse;
}

function evidenceIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.evidenceIds)) return record.evidenceIds.filter((id): id is string => typeof id === 'string');
  return [...evidenceIds(record.before), ...evidenceIds(record.after)];
}

async function resolveEvidence(db: pg.Pool, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const result = await db.query<{ id: string }>(`SELECT id FROM historical_presence WHERE id = ANY($1::text[])
    UNION SELECT id FROM whoi_detections WHERE id = ANY($1::text[])
    UNION SELECT id FROM navwarn_notices WHERE id = ANY($1::text[])
    UNION SELECT id FROM ais_positions WHERE id = ANY($1::text[])`, [ids]);
  return new Set(result.rows.map((row) => row.id)).size === new Set(ids).size;
}

export function toolUrl(name: ToolName, args: Record<string, unknown>, storyDate?: string | null): string | null {
  if (name === 'explain_records') {
    if (Object.keys(args).some((key) => key !== 'topic')) return null;
    return `/api/query/explanation?topic=${explanationTopic(args.topic)}`;
  }
  if (name === 'get_marine_conditions') return Object.keys(args).length === 0 ? '/api/current/marine' : null;
  if (name === 'get_acoustic_review') return Object.keys(args).length === 0 ? '/api/current/whoi' : null;
  if (name === 'get_story_snapshot') return Object.keys(args).length === 0 ? '/api/story/replay' : null;
  if (name === 'get_current_state') return Object.keys(args).length === 0 ? '/api/query/current-state' : null;
  if (name === 'get_evidence_by_id') return Object.keys(args).length === 1 && typeof args.id === 'string' &&
    /^[A-Za-z0-9:_./-]{1,200}$/.test(args.id) ? `/api/query/evidence?id=${encodeURIComponent(args.id)}` : null;
  if (name === 'get_latest_detection') return Object.keys(args).length === 0 ? '/api/query/latest-detection' +
    (storyDate !== undefined ? `?scope=story${storyDate ? `&throughDate=${storyDate}` : ''}` : '') : null;
  if (name === 'get_detections_on_date') return Object.keys(args).length === 1 && calendarDate(args.date) &&
    String(args.date) >= STORY_FIRST_DATE && String(args.date) <= new Date().toISOString().slice(0, 10)
    ? `/api/query/detections?date=${args.date}` : null;
  if (name === 'get_restriction_at') {
    const at = parseInstant(args.at);
    return Object.keys(args).length === 1 && at && at >= PRESENCE_START && Date.parse(at) <= Date.now() ?
      `/api/query/restriction?at=${encodeURIComponent(at)}` : null;
  }
  const keys = ['beforeStart', 'beforeEnd', 'afterStart', 'afterEnd'];
  if (Object.keys(args).length !== 4 || !keys.every((key) => key in args)) return null;
  const before = parsePresenceWindow(args.beforeStart, args.beforeEnd);
  const after = parsePresenceWindow(args.afterStart, args.afterEnd);
  if (!before || !after || before.end > after.start) return null;
  const params = new URLSearchParams(keys.map((key) => [key, String(args[key])]));
  return `/api/query/presence-comparison?${params}`;
}

function field(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid domain result');
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid domain result');
  return value;
}

function numberField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid domain result');
  return value;
}

function nullableNumberField(value: unknown): number | null {
  return value === null ? null : numberField(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readableUtc(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(parsed)) + ' UTC';
}

function speedCategory(value: string): string {
  return value === 'bands_below_or_up_to_10' ? 'speed categories through 10 knots' :
    value === 'bands_from_10_up' ? 'speed categories from 10 knots upward' : 'an unclassified speed category';
}

function measurement(label: string, value: unknown, unit: string): string {
  if (value === null || value === undefined) return `${label} is not in this model row`;
  return typeof value === 'number' && Number.isFinite(value) ? `${label} is ${value} ${unit}` : `${label} could not be read`;
}

function aisCoverageSentence(status: string, connectionStatus: string, count: number | null, windowMinutes: number | null, lastObserved: unknown): string {
  const windowText = windowMinutes == null ? 'the recent window' : `the last ${windowMinutes} minutes`;
  if (status === 'recent_messages' && count != null) {
    return `${count} distinct MMSI positions were received within ${windowText}; AIS coverage is still incomplete.`;
  }
  const connection = connectionStatus === 'unconfigured' ? 'AIS is not configured for this deployment.' :
    connectionStatus === 'connecting' ? 'AIS is still connecting.' :
    connectionStatus === 'disconnected' ? 'AIS is disconnected.' :
    connectionStatus === 'unverified' ? 'The last AIS connection check is too old to treat the stream as live.' :
    connectionStatus === 'connected' ? 'AIS is connected, but no recent Zone A positions are stored.' :
    'AIS connection state is not a known live state.';
  const recent = status === 'recent_messages' ? 'AIS reported recent messages, but the position list could not be read.' :
    'Recent Zone A vessel coverage is unknown, not zero ships.';
  return `${connection} ${recent} Last stored position: ${typeof lastObserved === 'string' ? lastObserved : 'none'}.`;
}

function summarize(name: ToolName, result: Record<string, unknown>): { sentence: string; facts: Record<string, unknown> } {
  if (name === 'explain_records') {
    const topic = explanationTopic(result.topic);
    return { facts: { topic }, sentence: explanationSentence(topic) };
  }
  if (name === 'get_marine_conditions') {
    const weather = describeWeather(result.weather);
    const fetchState = field(result.fetch);
    const data = field(result.data);
    const fetchStatus = typeof fetchState.status === 'string' ? fetchState.status : 'unknown';
    const dataStatus = typeof data.status === 'string' ? data.status : 'unknown';
    const observation = data.observation == null ? null : field(data.observation);
    const fetchSentence = fetchStatus === 'never' ? 'Marine conditions have not been fetched.' :
      fetchStatus === 'error' ? 'The latest marine fetch failed.' :
      fetchStatus === 'success' ? 'The latest marine fetch succeeded.' :
      'The marine fetch state is not recognized.';
    const facts = { fetchStatus, dataStatus, weather: {code: weather.code, validAt: weather.validAt, state: weather.state}, validAt: observation?.validAt ?? null,
      gridLatitude: finiteNumber(observation?.gridLatitude), gridLongitude: finiteNumber(observation?.gridLongitude),
      waveHeightM: observation ? observation.waveHeightM ?? null : null,
      seaSurfaceTemperatureC: observation ? observation.seaSurfaceTemperatureC ?? null : null,
      oceanCurrentVelocityKmh: observation ? observation.oceanCurrentVelocityKmh ?? null : null };
    if (!observation || dataStatus === 'missing') {
      return { facts, sentence: `${fetchSentence} No model values are stored for Zone A. That is missing data, not a calm sea. Model issue time is not supplied. ${weather.sentence}` };
    }
    const freshness = dataStatus === 'fresh' ? 'The model valid time is inside the fresh window.' :
      dataStatus === 'stale' ? 'The model valid time is outside the fresh window, so these values are stale.' :
      'The model freshness is not a known state, so these values are not stated as current.';
    return { facts, sentence: `${fetchSentence} At model time ${String(observation.validAt)}, ${measurement('wave height', observation.waveHeightM, 'm')}; ${measurement('sea surface temperature', observation.seaSurfaceTemperatureC, '°C')}; ${measurement('ocean current', observation.oceanCurrentVelocityKmh, 'km/h')}. ${freshness} These are model values at a grid point, not measurements of whales or vessels, and a value of zero is a model value rather than missing data. ${weather.sentence}` };
  }
  if (name === 'get_acoustic_review') {
    const fetchState = field(result.fetch);
    const data = field(result.data);
    const fetchStatus = typeof fetchState.status === 'string' ? fetchState.status : 'unknown';
    const dataStatus = typeof data.status === 'string' ? data.status : 'unknown';
    const review = data.latestReview == null ? null : field(data.latestReview);
    const detections = Array.isArray(data.indexedDetections) && review ? data.indexedDetections.filter(row =>
      row && typeof row === 'object' && row.reviewDate === review.reviewDate) : [];
    const evidenceIds = detections.flatMap((row) => {
      const record = row && typeof row === 'object' ? row as Record<string, unknown> : null;
      return typeof record?.id === 'string' ? [record.id] : [];
    });
    const detectionCount = finiteNumber(review?.detectionCount);
    const facts = { fetchStatus, dataStatus, ageDays: finiteNumber(data.ageDays),
      reviewDate: review?.reviewDate ?? null, detectionCount, indexedCount: evidenceIds.length,
      sourceUrl: review?.sourceUrl ?? null, evidenceIds };
    const fetchSentence = fetchStatus === 'never' ? 'No acoustic review has been fetched.' :
      fetchStatus === 'error' ? 'The latest acoustic-review fetch failed.' :
      fetchStatus === 'success' ? '' :
      'The acoustic-review fetch state is not recognized.';
    if (dataStatus === 'missing' || !review) {
      return { facts, sentence: `${fetchSentence} No WHOI review day is indexed. That does not establish that whales were absent.`.trim() };
    }
    const when = dataStatus === 'recent_review' ? 'That day is inside the recent window: the current UTC date or one of the previous two dates.' :
      dataStatus === 'stale_review' ? 'That day is older than the recent window, so this is not a current review.' :
      'The review freshness is not a known state.';
    const onDay = detectionCount == null ? 'an unreadable number of' : String(detectionCount);
    const empty = detectionCount === 0 ? ' A reviewed day with no right-whale rows does not prove absence.' : '';
    return { facts, sentence: `${fetchSentence} The latest indexed WHOI review day is ${String(review.reviewDate)}, with ${onDay} right-whale rows on that day. ${evidenceIds.length} indexed rows are included here. ${when}${empty} Times are source-local, coordinates locate the glider rather than a whale, and the index is a bounded sample rather than the full archive.`.replace(/\s+/g, ' ').trim() };
  }
  if (name === 'get_story_snapshot') {
    const status = typeof result.status === 'string' ? result.status : 'unknown';
    const presence = Array.isArray(result.presence) ? result.presence.length : null;
    const notices = Array.isArray(result.notices) ? result.notices.length : null;
    const detections = Array.isArray(result.detections) ? result.detections.length : null;
    const facts = { status, presenceHours: presence, notices, detections, start: result.start ?? null, end: result.end ?? null };
    if (presence == null || notices == null || detections == null) {
      return { facts, sentence: 'The September story could not be summarized from the stored fields.' };
    }
    if (status === 'not_imported' || presence === 0) {
      return { facts, sentence: `No Global Fishing Watch vessel-hours are imported for 13–19 September 2026. Missing rows are not proof of an empty sea. Notices in that window: ${notices}. Indexed detections in that window: ${detections}.` };
    }
    if (status === 'ready' && matchesReviewedStory(result)) {
      return { facts, sentence: `The 13–19 September 2026 story is the checked snapshot: ${presence} vessel-presence hours, ${notices} notices, and ${detections} indexed detections. Vessel-hours are speed categories, not tracks or exact speeds. Notice times are UTC. Detection times are source-local and are not converted.` };
    }
    if (status === 'incomplete' || status === 'ready') {
      return { facts, sentence: `The story window has ${presence} vessel-presence hours, ${notices} notices, and ${detections} indexed detections. That is not the checked snapshot, so the picture is incomplete. Missing hours are unknown coverage, not proof of no vessels.` };
    }
    return { facts, sentence: `The story status is not a known state. Stored rows in the window: ${presence} vessel-presence hours, ${notices} notices, and ${detections} indexed detections.` };
  }
  if (name === 'get_current_state') {
    const restriction = field(result.restriction);
    const ais = field(result.ais);
    const data = field(ais.data);
    const connection = field(ais.connection);
    const restrictionSummary = summarize('get_restriction_at', restriction);
    const lastStored = data.lastStored == null ? null : field(data.lastStored);
    const status = typeof data.status === 'string' ? data.status : 'unknown';
    const connectionStatus = typeof connection.status === 'string' ? connection.status : 'unknown';
    const positions = status === 'recent_messages' && Array.isArray(data.positions) ? data.positions : null;
    const recentWindowMinutes = finiteNumber(data.recentWindowMinutes);
    const knownCoverage = status === 'recent_messages' || status === 'unknown';
    const facts = { at: stringField(result.at), restriction: restrictionSummary.facts,
      ais: { status: knownCoverage ? status : 'unknown', connectionStatus, recentWindowMinutes,
        recentPositionCount: positions?.length ?? null, lastStoredObservedAt: lastStored?.observedAt ?? null,
        lastStoredReceivedAt: lastStored?.receivedAt ?? null } };
    const aisSentence = aisCoverageSentence(status, connectionStatus, positions?.length ?? null, recentWindowMinutes, lastStored?.observedAt);
    return { facts, sentence: `${restrictionSummary.sentence} ${aisSentence}` };
  }
  if (name === 'get_evidence_by_id') {
    const record = field(result.record);
    const id = stringField(record.id);
    const kind = stringField(record.kind);
    const sourceUrl = stringField(record.sourceUrl);
    if (kind === 'whoi_detection') return { facts: { id, kind, sourceUrl,
      sourceLocalTime: stringField(record.sourceLocalTime), occurrence: stringField(record.occurrence),
      platformLatitude: numberField(record.platformLatitude), platformLongitude: numberField(record.platformLongitude) },
      sentence: `Evidence ${id} is a WHOI ${stringField(record.occurrence).replaceAll('_', ' ')} row at ${stringField(record.sourceLocalTime)} source-local time. Its coordinates locate the glider, not a whale.` };
    if (kind === 'gfw_presence') return { facts: { id, kind, sourceUrl, eventAt: stringField(record.eventAt),
      speedBandGroup: stringField(record.speedBandGroup), latitude: numberField(record.latitude), longitude: numberField(record.longitude) },
      sentence: `One Global Fishing Watch vessel-presence hour at ${readableUtc(stringField(record.eventAt))} was in ${speedCategory(stringField(record.speedBandGroup))}. This is a category, not an exact speed or compliance finding.` };
    if (kind === 'navwarn_notice') return { facts: { id, kind, sourceUrl, publishedAt: stringField(record.publishedAt),
      effectiveAt: stringField(record.effectiveAt), zoneAState: stringField(record.zoneAState), appliesTo: stringField(record.appliesTo) },
      sentence: `Evidence ${id} is a stored Coast Guard notice published ${stringField(record.publishedAt)} and effective ${stringField(record.effectiveAt)}; its Zone A statement is ${stringField(record.zoneAState)} for ${stringField(record.appliesTo)}. This does not verify current status or legal compliance.` };
    if (kind === 'ais_position') return { facts: { id, kind, sourceUrl, observedAt: stringField(record.observedAt),
      receivedAt: stringField(record.receivedAt), speedKnots: nullableNumberField(record.speedKnots),
      latitude: numberField(record.latitude), longitude: numberField(record.longitude) },
      sentence: `Evidence ${id} is a reported AIS position observed ${stringField(record.observedAt)} and received ${stringField(record.receivedAt)}; reported speed is ${record.speedKnots === null ? 'unknown' : `${numberField(record.speedKnots)} knots`}. It is not a compliance finding.` };
    return { facts: { id, kind, sourceUrl },
      sentence: `Evidence ${id} is stored as ${kind.replaceAll('_', ' ')}, a kind this answer does not describe field by field. It is not a compliance finding.` };
  }
  if (name === 'get_restriction_at') {
    const at = stringField(result.at);
    const status = stringField(result.status);
    const notice = result.notice == null ? null : field(result.notice);
    const statement = result.statement === null || typeof result.statement === 'string' ? result.statement : null;
    const knownStatement = statement === null || statement === 'restricted_10_knots' || statement === 'no_restriction_stated';
    const facts = { at, status, statement: knownStatement ? statement : result.statement, noticeId: notice?.id ?? null,
      publishedAt: notice?.publishedAt ?? null, effectiveAt: notice?.effectiveAt ?? null,
      appliesTo: notice?.appliesTo ?? null, cancels: notice?.cancels ?? null,
      sourceUrl: notice?.sourceUrl ?? null };
    const verified = status === 'current_notice_verified';
    const noticeSource = verified ? 'The indexed Coast Guard notice verified in the latest successful search' :
      'A stored Coast Guard notice';
    const caveat = verified ? '' : ' This notice is not verified as current; later or missing notices may change the state.';
    const nonOperational = ' This is a notice summary, not a navigation or compliance determination.';
    if (!knownStatement) return { facts, sentence: `The stored notice at ${at} has a Zone A statement this reading does not map, so the restriction is not established.${nonOperational}` };
    const sentence = !notice ? `No indexed notice establishes Zone A state at ${at}.` :
      statement === null ? `${status === 'pending_effective_time' ? 'The Coast Guard notice verified in the latest successful search' : 'The selected notice'} has not taken effect at ${at}; Zone A state is not established.${status === 'documented_notice_unverified' ? caveat : ''}${nonOperational}` :
      statement === 'restricted_10_knots' ? `${noticeSource} states a 10-knot limit for vessels over 13 m in Zone A at ${at}.${caveat}${nonOperational}` :
      `${noticeSource} states no Zone A restriction at ${at}.${caveat}${nonOperational}`;
    return { sentence, facts };
  }
  if (name === 'get_detections_on_date') {
    const reviewDate = stringField(result.reviewDate);
    if (!Array.isArray(result.detections)) throw new Error('Invalid dated detections');
    const detections = result.detections.map(value => {
      const row = field(value);
      return { id: stringField(row.id), sourceLocalTime: stringField(row.sourceLocalTime),
        occurrence: stringField(row.occurrence), sourceUrl: stringField(row.sourceUrl) };
    });
    return { facts: { reviewDate, indexedCount: detections.length, detections }, sentence: detections.length ?
      `For the WHOI review date ${reviewDate}, ${detections.length} indexed right-whale rows are stored: ${detections.map(row => `${row.sourceLocalTime} (${row.occurrence.replaceAll('_', ' ')})`).join('; ')}. These are source-local times with unresolved UTC offset; coordinates locate the glider, not whales.` :
      `No indexed WHOI right-whale rows are stored for review date ${reviewDate}. This does not establish whale absence or a reviewed zero-detection day.` };
  }
  if (name === 'get_latest_detection') {
    const status = stringField(result.status);
    const detection = result.detection == null ? null : field(result.detection);
    const facts = { status, detectionId: detection?.id ?? null,
      sourceLocalTime: detection?.sourceLocalTime ?? null, occurrence: detection?.occurrence ?? null,
      platformLatitude: detection?.platformLatitude ?? null,
      platformLongitude: detection?.platformLongitude ?? null,
      sourceUrl: detection ? stringField(detection.sourceUrl) : null };
    const scope = result.scope === 'story'
      ? `Within Story review dates ${STORY_FIRST_DATE} through ${stringField(result.reviewDateThrough)}, ` : '';
    return { facts: { ...facts, ...(scope ? { scope: 'story', reviewDateThrough: result.reviewDateThrough } : {}) }, sentence: detection ?
      `${scope}The latest indexed WHOI right-whale row is ${stringField(detection.occurrence).replaceAll('_', ' ')} at ${stringField(detection.sourceLocalTime)} source-local time; its coordinates locate the glider, not the whale.` :
      `${scope}No indexed WHOI right-whale detection is available; this does not establish whale absence.` };
  }
  const status = stringField(result.status);
  const before = field(result.before);
  const after = field(result.after);
  const beforeWindow = field(before.window);
  const afterWindow = field(after.window);
  const facts = { status, before: {
    window: { start: stringField(beforeWindow.start), end: stringField(beforeWindow.end) },
    vesselPresenceHours: numberField(before.vesselPresenceHours),
    atOrBelow10CategoryHours: numberField(before.atOrBelow10CategoryHours),
    from10UpCategoryHours: numberField(before.from10UpCategoryHours),
    from10UpCategoryShare: nullableNumberField(before.from10UpCategoryShare),
  }, after: {
    window: { start: stringField(afterWindow.start), end: stringField(afterWindow.end) },
    vesselPresenceHours: numberField(after.vesselPresenceHours),
    atOrBelow10CategoryHours: numberField(after.atOrBelow10CategoryHours),
    from10UpCategoryHours: numberField(after.from10UpCategoryHours),
    from10UpCategoryShare: nullableNumberField(after.from10UpCategoryShare),
  } };
  if (status !== 'descriptive_comparison') return { facts,
    sentence: 'One or both windows lack indexed vessel-presence hours, so a speed-category comparison is not supported.' };
  return { facts, sentence: `From ${readableUtc(facts.before.window.start)} to ${readableUtc(facts.before.window.end)}, ${facts.before.from10UpCategoryHours} of ${facts.before.vesselPresenceHours} vessel-hours were in speed categories from 10 knots upward. From ${readableUtc(facts.after.window.start)} to ${readableUtc(facts.after.window.end)}, ${facts.after.from10UpCategoryHours} of ${facts.after.vesselPresenceHours} were. These are source categories, not exact speeds or a compliance finding.` };
}

async function chooseTools(modelRequest: ModelRequest, body: Record<string, unknown>, requestSignal?: AbortSignal): Promise<ModelResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try { return await modelRequest(body, requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal); }
  catch (error) {
    if (controller.signal.aborted || requestSignal?.aborted) throw new AgentFailure('model_timeout');
    if (error instanceof AgentFailure) throw error;
    throw new AgentFailure('provider_unavailable');
  } finally { clearTimeout(timer); }
}

const domainErrors = new Set(['invalid_detection_date', 'detection_date_exceeds_reviewed_limit', 'presence_window_exceeds_checked_snapshot_limit', 'domain_data_unavailable',
  'story_snapshot_exceeds_reviewed_limit', 'marine_data_unavailable', 'whoi_data_unavailable',
  'story_data_unavailable', 'ais_data_unavailable']);

export function registerAgentRoutes(server: FastifyInstance, db: pg.Pool,
  modelRequest: ModelRequest = deepseekModelRequest,
  admitOverride?: (address: string) => ReturnType<typeof reserveAiCall>): void {
  // Tests must explicitly supply admission; replacing the model never changes policy.
  const admitUsesProductionPolicy = admitOverride === undefined;
  const admit = admitOverride ?? (async (address: string) => reserveAiCall(db, address, aiPolicy()));
  server.get<{ Querystring: { topic?: string } }>('/api/query/explanation', async (request) => ({
    topic: explanationTopic(request.query.topic),
  }));
  server.get('/api/ask/status', async () => ({
    implemented: true,
    configured: Boolean(process.env.DEEPSEEK_API_KEY) && (() => { try { aiPolicy(); return true; } catch { return false; } })(),
    limits: publishedAiLimits(),
    note: 'Configuration does not prove provider reachability or an end-to-end answer. Use POST /api/ask to verify those.',
  }));
  const recent = new Map<string, number[]>();
  server.post<{ Body: AskBody }>('/api/ask', { bodyLimit: 24_000, schema: { body: object({
    question: { type: 'string', minLength: 3, maxLength: 500 },
    mode: { type: 'string', enum: ['story', 'live'] },
    zoneId: { type: 'string', enum: [ZONE_ID] },
    selectedTime: { type: 'string', nullable: true, maxLength: 30 },
    previousEvidenceIds: { type: 'array', maxItems: 100, uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9:_./-]+$' } },
  }, ['question']) } }, async (request, reply) => {
    const { question, mode, selectedTime, previousEvidenceIds = [] } = request.body;
    if (selectedTime != null && !parseInstant(selectedTime)) return askFailure(reply, 400, 'invalid_selected_time');
    if (mode === 'live' && selectedTime != null || mode === 'story' && selectedTime != null &&
      (selectedTime < `${STORY_FIRST_DATE}T00:00:00Z` || selectedTime >= '2026-09-20T00:00:00Z')) {
      return askFailure(reply, 400, 'question_scope_mismatch');
    }
    const dates = questionDates(question);
    const requestedDate = dates.length === 1 ? calendarDate(dates[0]) : null;
    const scopeMode = mode === 'story' && requestsCurrent(question) && dates.length === 0 ? 'live' : mode;
    const storyDate = scopeMode === 'story' ? selectedTime?.slice(0, 10) ?? null : undefined;
    const datedDetection = dates.length > 0 && /\b(detection|detections|whale|whales|acoustic)\b/i.test(question);
    const ip = request.ip;
    const now = Date.now();
    if (recent.size >= 1000) for (const [address, times] of recent) {
      if (times.every((time) => now - time >= 60_000)) recent.delete(address);
    }
    const attempts = (recent.get(ip) ?? []).filter((time) => now - time < 60_000);
    if (attempts.length >= 10 || (!recent.has(ip) && recent.size >= 1000)) {
      request.questionTelemetry = { kind: 'paid', reason: 'ask_rate_limit' };
      return askFailure(reply, 429, 'ask_rate_limit');
    }
    attempts.push(now);
    recent.set(ip, attempts);
    try {
      const localTopic = localExplanationTopic(question);
      if (localTopic) {
        request.questionTelemetry = { kind: 'free' };
        const summary = summarize('explain_records', { topic: localTopic });
        return { answer: summary.sentence, facts: { explain_records: summary.facts }, evidenceIds: [],
          selectedTime: selectedTime ?? null, timeScope: { explain_records: { topic: localTopic } },
          viewAction: 'explain_records', warnings: [] };
      }
      const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
      const currentTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const userInput = `Mode: ${scopeMode ?? 'legacy'}\nSelected Story calendar date: ${storyDate ?? 'none'}\nRequested detection date: ${requestedDate ?? 'none'}\nQuestion: ${question}\nZone: ${ZONE_ID}\nSelected UTC time: ${selectedTime ?? 'none'}\nCurrent UTC time: ${currentTime}\nPrevious evidence IDs: ${JSON.stringify(previousEvidenceIds)}`;
      const modelBody = { model, instructions, reasoning: { effort: 'none' },
        input: userInput, tools: agentTools, tool_choice: 'auto', max_output_tokens: 650 };
      // Cap the complete UTF-8 payload, including instructions and tool schemas.
      if (Buffer.byteLength(JSON.stringify(modelBody), 'utf8') > 16_000)
        return askFailure(reply, 400, 'invalid_tool_arguments');
      if (modelRequest === deepseekModelRequest && !process.env.DEEPSEEK_API_KEY) throw new AgentFailure('missing_model_key');
      // Signed anonymous browser identity; no unverified forwarded-IP header is trusted.
      // Site-wide admission remains the spend boundary even if a visitor clears cookies.
      let identity = request.ip;
      if (admitUsesProductionPolicy) {
        const visitor = visitorIdentity(request.headers.cookie, aiPolicy().identitySecret);
        identity = visitor.id;
        if (visitor.cookie) reply.header('Set-Cookie', visitor.cookie);
      }
      const reservation = await admit(identity);
      request.questionTelemetry = { kind: 'paid', admitted: true, remainingCalls: reservation.remaining };
      reply.header('X-AI-Remaining-Calls', reservation.remaining);
      let first: ModelResponse;
      try { first = await chooseTools(modelRequest, modelBody, requestLifetimeSignal(request, reply)); }
      finally { await reservation.finish(); }
      if (first.status !== 'completed') throw new AgentFailure('provider_unavailable');
      const calls = first.output.filter((item) => item.type === 'function_call');
      if (!calls.length) return { answer: `${explanationSentence('all')} Ask about a stored notice, the latest indexed detection, vessel-presence categories, marine model values, or the September story.`,
        facts: { explain_records: { topic: 'all' } }, evidenceIds: [], selectedTime: selectedTime ?? null, timeScope: {},
        viewAction: null, warnings: ['unsupported_question'] };
      if (calls.length > agentTools.length || new Set(calls.map((call) => call.name)).size !== calls.length ||
        new Set(calls.map((call) => call.call_id)).size !== calls.length)
        return askFailure(reply, 400, 'invalid_tool_arguments');
      if (mode && calls.some(call => call.name === 'explain_records') && calls.length > 1 && !/\b(and|also)\b/i.test(question)) {
        return askFailure(reply, 409, 'question_scope_mismatch');
      }
      const validated: { name: ToolName; args: Record<string, unknown>; url: string }[] = [];
      for (const call of calls) {
        const name = call.name as ToolName;
        if (!agentTools.some((tool) => tool.name === name) || !call.call_id)
          return askFailure(reply, 400, 'invalid_tool_arguments');
        let args: unknown;
        try { args = JSON.parse(call.arguments ?? ''); }
        catch { return askFailure(reply, 400, 'invalid_tool_arguments'); }
        if (!args || typeof args !== 'object' || Array.isArray(args))
          return askFailure(reply, 400, 'invalid_tool_arguments');
        const parsedArgs = args as Record<string, unknown>;
        if (name === 'get_evidence_by_id' && !previousEvidenceIds.includes(String(parsedArgs.id)))
          return askFailure(reply, 400, 'evidence_not_in_previous_answer');
        const currentOnlyInStory = scopeMode === 'story' &&
          ['get_marine_conditions', 'get_current_state', 'get_acoustic_review'].includes(name);
        const datedQuestionWithWrongTool = datedDetection &&
          ['get_latest_detection', 'get_story_snapshot', 'get_acoustic_review'].includes(name);
        const wrongDetectionDate = name === 'get_detections_on_date' && (dates.length > 1 ||
          parsedArgs.date !== (requestedDate ?? (dates.length ? null : storyDate)));
        const wrongRestrictionContext = name === 'get_restriction_at' &&
          (scopeMode === 'story' && !selectedTime || scopeMode === 'live' && dates.length === 0 && parsedArgs.at !== currentTime);
        if (mode && (currentOnlyInStory || datedQuestionWithWrongTool || wrongDetectionDate || wrongRestrictionContext)) {
          return askFailure(reply, 409, 'question_scope_mismatch');
        }
        const url = toolUrl(name, parsedArgs, storyDate);
        if (!url) return askFailure(reply, 400, 'invalid_tool_arguments');
        if (name === 'get_restriction_at' && selectedTime && scopeMode !== 'live' && parsedArgs.at !== selectedTime)
          return askFailure(reply, 409, 'selected_time_mismatch', { selectedTime, toolAt: parsedArgs.at });
        validated.push({ name, args: parsedArgs, url });
      }
      const allowed: string[] = [];
      const used: ToolName[] = [];
      const warnings: string[] = mode === 'story' && scopeMode === 'live' ? ['This answer uses current indexed records, not the selected Story time.'] : [];
      const scopes: Record<string, unknown> = {};
      const facts: Record<string, unknown> = {};
      const sentences: string[] = [];
      for (const { name, args, url } of validated) {
        if (requestLifetimeSignal(request, reply).aborted) throw new AgentFailure('model_timeout');
        const toolResponse = await injectInternalRead(server, url);
        if (toolResponse.statusCode !== 200) {
          const domainError = (toolResponse.json() as Record<string, unknown>).error;
          const safeError = typeof domainError === 'string' && domainErrors.has(domainError) ? domainError : 'unexpected_domain_error';
          return askFailure(reply, toolResponse.statusCode, 'domain_query_failed', { domainError: safeError });
        }
        const result = toolResponse.json() as Record<string, unknown>;
        const summary = summarize(name, result);
        allowed.push(...evidenceIds(result), ...evidenceIds(summary.facts));
        if (typeof result.warning === 'string' &&
          !(name === 'get_restriction_at' && result.notice == null && result.warning === 'No indexed notice establishes Zone A state at this time.')) {
          warnings.push(result.warning);
        }
        used.push(name);
        scopes[name] = args;
        facts[name] = summary.facts;
        sentences.push(summary.sentence);
      }
      if (!await resolveEvidence(db, allowed)) throw new AgentFailure('evidence_unavailable');
      request.log.info({ tools: used, evidenceIds: allowed }, 'Agent tools completed');
      const composedSentences = used.includes('compare_presence_bands')
        ? sentences.filter((sentence) => !sentence.startsWith('No indexed notice establishes Zone A state at '))
        : sentences;
      return { answer: composedSentences.join(' '), facts, evidenceIds: [...new Set(allowed)],
        selectedTime: selectedTime ?? null, timeScope: scopes,
        viewAction: used[0], warnings };
    } catch (error) {
      if (error instanceof BudgetFailure) {
        request.questionTelemetry = { ...request.questionTelemetry, kind: 'paid', reason: error.reason };
        if (error.retryAfterSeconds) reply.header('Retry-After', error.retryAfterSeconds);
        return askFailure(reply, error.reason === 'ai_frequency_limit' || error.reason === 'ai_busy' ? 429 : 503,
          error.reason, { retryAfterSeconds: error.retryAfterSeconds ?? null,
            message: askMessages[error.reason] + (error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} seconds.` : '') });
      }
      request.log.error(error, 'Agent request failed');
      request.questionTelemetry = { ...request.questionTelemetry, kind: 'paid',
        reason: error instanceof AgentFailure ? error.reason : 'unexpected_error' };
      return askFailure(reply, 503, 'agent_unavailable', {
        reason: error instanceof AgentFailure ? error.reason : 'unexpected_error' });
    }
  });
}
