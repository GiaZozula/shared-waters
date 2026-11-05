import { describeWeather } from '../../../../shared/weather-description.js'
import { sourceLinkUrl } from '../../../source-link'
import type { NowSceneState } from '../data/sceneState.js'
import type { ReplayData } from '../../../replay-model.js'
import { apiFetch } from '../../../api-fetch.js';
import { explanationSentence, localExplanationTopic } from '../../../../shared/explanations.js'
import type {
  EvidenceRecord,
} from '../evidence/evidenceFixtures.js'

export interface SceneAskInput {
  question: string

  mode:
    'story' |
    'live'

  selectedTimeMs: number

  previousEvidenceIds: string[]

  liveState?: NowSceneState | null
  storyReplay?: ReplayData | null

  network?: 'local-only'
}

const TOOL_NAMES = [
  'get_restriction_at',
  'get_latest_detection',
  'get_detections_on_date',
  'compare_presence_bands',
  'get_current_state',
  'get_evidence_by_id',
  'explain_records',
  'get_marine_conditions',
  'get_acoustic_review',
  'get_story_snapshot',
] as const

const FAILURE_SENTENCES: Record<string, string> = {
  invalid_tool_arguments: 'That question could not be matched to a stored reading. Ask about a notice, a detection, vessel presence, current conditions, or what these records cannot show.',
  evidence_not_in_previous_answer: 'That record was not part of the previous answer, so it was not opened.',
  invalid_detection_date: 'Choose a valid review date from 13 September 2026 through today.',
  detection_date_exceeds_reviewed_limit: 'That date contains more indexed detections than this bounded reading can show.',
  question_scope_mismatch: 'That reading does not match the requested date or Story/Live context. Ask for detections on one date, choose a precise Story time, or explicitly ask for current readings.',
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
  agent_unavailable: 'The question could not be answered from the stored records.',
  domain_query_failed: 'That reading could not be completed from the stored records.',
  domain_data_unavailable: 'The stored records could not be read just now.',
  presence_window_exceeds_checked_snapshot_limit: 'That comparison window is larger than the checked snapshot, so it was not read.',
  story_snapshot_exceeds_reviewed_limit: 'The stored story is larger than the reviewed snapshot, so it was not summarized.',
  marine_data_unavailable: 'Marine model values could not be read just now.',
  whoi_data_unavailable: 'The acoustic review could not be read just now.',
  story_data_unavailable: 'The September story could not be read just now.',
  ais_data_unavailable: 'Current vessel reports could not be read just now.',
  unexpected_domain_error: 'That reading could not be completed from the stored records.',
  'Bad Request': 'That question needs to be a short plain-language question about this water.',
}

const WARNING_SENTENCES: Record<string, string> = {
  unsupported_question: 'This question asks for something these records do not establish.',
}

const EVIDENCE_KINDS = [
  'gfw_presence',
  'whoi_detection',
  'navwarn_notice',
  'ais_position',
] as const

type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

const SOURCE_NAME: Record<EvidenceKind, string> = {
  gfw_presence: 'Global Fishing Watch',
  whoi_detection: 'WHOI / Robots4Whales',
  navwarn_notice: 'Canadian Coast Guard NAVWARN',
  ais_position: 'AISStream',
}

const KIND_LIMITATION: Record<EvidenceKind, string> = {
  gfw_presence: 'A GFW row is one vessel-hour, not a track or an exact speed.',
  whoi_detection: 'Coordinates locate the glider, not a whale. The time is source-local.',
  navwarn_notice: 'A notice is not a compliance determination.',
  ais_position: 'An AIS speed is not a compliance finding.',
}

const TIME_FIELDS = [
  'eventAt',
  'sourceLocalTime',
  'effectiveAt',
  'observedAt',
  'receivedAt',
] as const

export type AnswerBasis = 'explanation' | 'story' | 'displayed-live'

export interface SceneAskResult {
  answerBasis?: AnswerBasis

  answer: string | null

  notice: string | null

  warnings: string[]

  evidence: EvidenceRecord[]

  evidenceIds: string[]

  previousEvidenceIds: string[]

  viewAction: string | null

  siteRemainingCalls?: number | null
}

const EVIDENCE_ID =
  /^[A-Za-z0-9:_./-]{1,200}$/

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function text(
  value: unknown,
): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : null
}

export function canonicalSelectedTime(
  timestampMs: number,
): string | null {
  if (!Number.isFinite(timestampMs)) return null

  const value = new Date(timestampMs)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')

  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    ? value
    : null
}

export function boundEvidenceIds(
  ids: string[],
): string[] {
  const unique: string[] = []

  for (const id of ids) {
    if (!EVIDENCE_ID.test(id) || unique.includes(id)) continue

    unique.push(id)

    if (unique.length === 100) break
  }

  return unique
}

export function askRequestBody(
  input: SceneAskInput,
) {
  return {
    question: input.question,
    mode: input.mode,
    zoneId: 'zone_a' as const,
    ...(input.mode === 'story'
      ? { selectedTime: canonicalSelectedTime(input.selectedTimeMs) }
      : {}),
    previousEvidenceIds: boundEvidenceIds(input.previousEvidenceIds),
  }
}

export function evidenceQueryUrl(
  id: string,
): string {
  return `/api/query/evidence?id=${encodeURIComponent(id)}`
}

function evidenceKind(
  value: string | null,
): EvidenceKind | null {
  return EVIDENCE_KINDS.find((kind) => kind === value) ?? null
}

export function adaptEvidenceRecord(
  payload: unknown,
): EvidenceRecord | null {
  const body = asRecord(payload)
  const record = asRecord(body?.record)
  const id = text(record?.id)
  const kind = evidenceKind(text(record?.kind))

  if (!record || !id || !kind) return null

  const evidence: EvidenceRecord = {
    id,
    source: SOURCE_NAME[kind],
    limitation: KIND_LIMITATION[kind],
  }
  const sourceUrl = sourceLinkUrl(record.sourceUrl)

  if (sourceUrl) evidence.sourceUrl = sourceUrl

  for (const field of TIME_FIELDS) {
    const value = text(record[field])

    if (value) evidence[field] = value
  }

  return evidence
}

export function focusableEvidenceId(
  viewAction: string | null,
  evidenceIds: string[],
  loadedIds: ReadonlySet<string>,
): string | null {
  if (!viewAction || !TOOL_NAMES.some((name) => name === viewAction)) return null

  return evidenceIds.find((id) => loadedIds.has(id)) ?? null
}

function isMachineCode(
  value: string,
): boolean {
  return /^[A-Za-z0-9_]+$/.test(value)
}

function readableSentence(
  value: string | null,
): string | null {
  if (!value || isMachineCode(value)) return null

  if (/must |body\/|FST_/.test(value)) return null

  return value
}

export function askFailureNotice(
  payload: unknown,
  status = 0,
): string {
  const body = asRecord(payload)
  const message = readableSentence(text(body?.message))

  if (message) return message

  const reason = text(body?.reason)
  const error = text(body?.error)
  const domainError = text(body?.domainError)

  return FAILURE_SENTENCES[domainError ?? ''] ??
    FAILURE_SENTENCES[reason ?? ''] ??
    FAILURE_SENTENCES[error ?? ''] ??
    readableSentence(reason) ??
    readableSentence(error) ??
    (status >= 500 ? 'The question service is unavailable. Try again later. Saved Story presets and free explanations still work.' : 'The server could not read this question response. Try a Story preset or ask what a vessel-hour means.')
}

export function askWarningLines(
  payload: unknown,
): string[] {
  const warnings = asRecord(payload)?.warnings

  if (!Array.isArray(warnings)) return []

  return warnings.flatMap((warning) => {
    if (typeof warning !== 'string' || warning.length === 0) return []

    const sentence = WARNING_SENTENCES[warning] ?? (isMachineCode(warning) ? null : warning)

    return sentence ? [sentence] : ['A stored limit applies to this answer.']
  })
}

export function answerLead(
  answer: string,
): string {
  const trimmed = answer.trim()

  if (trimmed.length <= 320) return trimmed

  const first = trimmed.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? trimmed

  if (first.length <= 320) return first

  return `${trimmed.slice(0, 317).trimEnd()}…`
}

function viewActionName(
  payload: unknown,
): string | null {
  const name = text(asRecord(payload)?.viewAction)

  return name && TOOL_NAMES.some((tool) => tool === name)
    ? name
    : null
}

export function savedStoryAnswer(input: SceneAskInput): SceneAskResult | null {
  if (input.mode !== 'story' || !input.storyReplay) return null
  const data = input.storyReplay
  const question = input.question.trim().toLowerCase().replace(/[?!.]+$/, '')
  let answer: string
  let raw: Array<Record<string, unknown>> = []
  if (question === 'what restriction applied') {
    if (!Number.isFinite(input.selectedTimeMs)) return {
      answer: null, notice: 'This chapter uses an approximate whale clock. Choose a time on the timeline to check the notice at a precise UTC time.',
      warnings: [], evidence: [], evidenceIds: [], previousEvidenceIds: [], viewAction: null,
    }
    const notice = data.notices.filter(row => Date.parse(row.publishedAt) <= input.selectedTimeMs && Date.parse(row.effectiveAt) <= input.selectedTimeMs)
      .sort((a,b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0]
    answer = notice
      ? notice.zoneAState === 'restricted_10_knots'
        ? `The saved notice lists a 10-knot Zone A limit for vessels over 13 metres. It takes effect at ${notice.effectiveAt}.`
        : `The saved notice records ${notice.zoneAState.replaceAll('_', ' ')} for Zone A from ${notice.effectiveAt}. Its recorded scope is ${notice.appliesTo === 'vessels_over_13_m' ? 'vessels over 13 metres' : 'the scope stated in the notice'}.`
      : 'No published and effective notice is stored for the selected time. This does not establish that the water was unrestricted.'
    if (notice) raw = [{...notice, kind: 'navwarn_notice'}]
  } else if (question === 'latest whale detection') {
    const latest = [...data.detections].sort((a,b) => b.sourceLocalTime.localeCompare(a.sourceLocalTime))[0]
    answer = latest ? `The latest whale detection in the saved Story is ${latest.sourceLocalTime}, on the source’s local clock. The mark locates the listening glider. This is the latest record in this archive, not a current detection.` : 'There are no whale detections in this saved Story.'
    if (latest) raw = [{...latest, kind: 'whoi_detection'}]
  } else if (question === 'notices and detections in story') {
    answer = `The saved Story contains ${data.notices.length} protection ${data.notices.length === 1 ? 'notice' : 'notices'} and ${data.detections.length} reviewed whale detections. Open the records below for their times and sources. Notice times use UTC. Whale times keep the source’s local clock.`
    raw = [...data.notices.map(row => ({...row, kind: 'navwarn_notice'})), ...data.detections.map(row => ({...row, kind: 'whoi_detection'}))]
  } else return null
  const evidence = raw.map(record => adaptEvidenceRecord({record})).filter((record): record is EvidenceRecord => record !== null)
  const evidenceIds = evidence.map(record => record.id)
  return {answerBasis: 'story', answer, notice: null, warnings: [], evidence, evidenceIds, previousEvidenceIds: evidenceIds, viewAction: null}
}

export function displayedLiveAnswer(input: SceneAskInput): SceneAskResult | null {
  if (input.mode !== 'live' || !input.liveState) return null
  const state = input.liveState
  const question = input.question.trim().toLowerCase().replace(/[?!.]+$/, '')
  let answer: string
  if (question === 'what restriction is listed') {
    const r = state.restriction
    answer = r.status === 'unknown' ? 'No notice reading is available in this view. The service may be unavailable or the source may not have returned a record. This does not mean there is no restriction.'
      : r.status === 'record-shows-none' ? `The displayed notice explicitly states no restriction for Zone A.${r.effectiveAt ? ` Its recorded effective time is ${r.effectiveAt}.` : ''} This is a stored reading, not a check of current legal requirements.`
      : `The displayed notice is ${r.status.replaceAll('-', ' ')}. ${r.speedKnots === null ? 'Its speed limit is unavailable.' : `It lists ${r.speedKnots} knots for vessels over ${r.minimumLengthMetres ?? 'an unspecified number of'} metres.`} ${r.effectiveAt ? `Its recorded start time is ${r.effectiveAt}.` : ''} This is a stored reading, not a check of current legal requirements.`
  } else if (question === 'latest ais reports') {
    answer = state.ais.vesselCount === null ? 'No verified recent vessel count is available. A connected AIS feed can still have no recent positions. Coverage remains unknown.'
      : `This view has ${state.ais.vesselCount} received vessel positions from the recent window. ${state.ais.lastReceivedAt ? `The latest receipt is ${state.ais.lastReceivedAt}.` : ''} These are reports, not continuous tracks or a complete ship count.`
  } else if (question === 'latest whale review') {
    const w = state.whaleReview
    answer = !w || w.rightWhaleRows === null ? 'No whale review is available in this view. The service may be unavailable or the review may be missing. This does not establish that whales are absent.'
      : `The displayed review for ${w.reviewDate} contains ${w.rightWhaleRows} right-whale detection rows. Its status is ${w.state}. Rows are reviewed sounds, not individual whales.`
  } else if (question === 'what marine values are stored') {
    const m = state.marine
    answer = !m || m.state === 'missing' ? 'No marine model reading is available in this view. Try again when the service is reachable.'
      : `The displayed model has ${m.waveHeightMetres === null ? 'unknown wave height' : `${m.waveHeightMetres} metre waves`}, ${m.seaSurfaceTemperatureC === null ? 'unknown water temperature' : `${m.seaSurfaceTemperatureC}°C water`} and ${m.currentSpeedMs === null ? 'unknown current speed' : `${m.currentSpeedMs} metres per second current`}. Its valid time is ${m.validAt ?? 'unavailable'} and its status is ${m.state}. These are model estimates.`
    answer += ` ${describeWeather(m?.weather).sentence}`
  } else return null
  const retained = question === 'what restriction is listed' ? state.restriction.refreshUnavailable :
    question === 'latest whale review' ? state.whaleReview?.refreshUnavailable :
    question === 'what marine values are stored' ? state.marine?.refreshUnavailable : false
  if (retained) answer += ' The latest refresh failed; these are the last known stored values; current conditions unverified.'
  return {answerBasis: 'displayed-live', answer, notice: null, warnings: [], evidence: [], evidenceIds: [], previousEvidenceIds: [], viewAction: null}
}

export async function submitSceneQuestion(
  input: SceneAskInput,
  fetchImpl: FetchLike = apiFetch,
): Promise<SceneAskResult> {
  const previousEvidenceIds = boundEvidenceIds(input.previousEvidenceIds)
  const topic = localExplanationTopic(input.question)
  if (topic) return {
    answerBasis: 'explanation', answer: explanationSentence(topic), notice: null, warnings: [], evidence: [],
    evidenceIds: [], previousEvidenceIds: [], viewAction: 'explain_records',
  }
  const displayed = displayedLiveAnswer(input)
  if (displayed) return displayed
  const saved = savedStoryAnswer(input)
  if (saved) return saved
  if (input.network === 'local-only') return {
    answer: null,
    notice: 'This question needs the model. Offline keeps the local explanations and the Story or Live presets.',
    warnings: [],
    evidence: [],
    evidenceIds: [],
    previousEvidenceIds,
    viewAction: null,
  }
  const body = askRequestBody(input)

  let response: Response

  try {
    response = await fetchImpl('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return {
      answer: null,
      notice: 'Model questions are unavailable. Story browsing and free explanations still work.',
      warnings: [],
      evidence: [],
      evidenceIds: [],
      previousEvidenceIds,
      viewAction: null,
    }
  }

  let payload: unknown = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  const remaining = response.headers.get('x-ai-remaining-calls')
  const siteRemainingCalls = remaining !== null && /^\d+$/.test(remaining) ? Number(remaining) : null
  if (!response.ok) {
    return {
      answer: null,
      notice: askFailureNotice(payload, response.status),
      warnings: [],
      evidence: [],
      evidenceIds: [],
      previousEvidenceIds,
      viewAction: null,
      siteRemainingCalls,
    }
  }

  const returned = asRecord(payload)
  if (!text(returned?.answer)) return {
    answer: null, notice: 'The service returned no answer text. Try a preset question or try again later.',
    warnings: [], evidence: [], evidenceIds: [], previousEvidenceIds, viewAction: null, siteRemainingCalls,
  }
  const evidenceIds = boundEvidenceIds(
    Array.isArray(returned?.evidenceIds)
      ? returned.evidenceIds.filter((id): id is string => typeof id === 'string')
      : [],
  )
  const evidence: EvidenceRecord[] = []

  await Promise.all(evidenceIds.map(async (id) => {
    try {
      const evidenceResponse = await fetchImpl(evidenceQueryUrl(id))

      if (!evidenceResponse.ok) return

      const record = adaptEvidenceRecord(await evidenceResponse.json())

      if (record) evidence.push(record)
    } catch {
      return
    }
  }))

  evidence.sort((left, right) =>
    evidenceIds.indexOf(left.id) - evidenceIds.indexOf(right.id))

  const warnings = askWarningLines(payload)
  const missed = evidenceIds.length - evidence.length

  if (missed > 0) {
    warnings.push(missed === evidenceIds.length
      ? 'The cited records could not be opened, so only the answer text is shown.'
      : 'Some cited records could not be opened.')
  }

  return {
    answer: text(returned?.answer),
    notice: null,
    warnings,
    evidence,
    evidenceIds,
    previousEvidenceIds: evidenceIds,
    viewAction: viewActionName(payload),
    siteRemainingCalls,
  }
}
