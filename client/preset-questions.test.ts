import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { ReplayData } from './replay-model.js'
import { submitSceneQuestion } from './shared-water/world/question/askScene.js'
import type { NowSceneState } from './shared-water/world/data/sceneState.js'
const replay = JSON.parse(readFileSync(new URL('../data/story/snapshot.json', import.meta.url), 'utf8')).data as ReplayData
const offline = async (): Promise<Response> => { throw new Error('No network or model calls allowed') }
const base = { mode: 'story' as const, selectedTimeMs: Date.parse('2026-09-15T12:30:00Z'), previousEvidenceIds: [], storyReplay: replay }

test('every visible Story preset answers from the archive without network access', async () => {
  for (const question of ['what restriction applied?', 'what is a vessel-hour?', 'latest whale detection?', 'notices and detections in story?']) {
    const result = await submitSceneQuestion({...base, question}, offline)
    assert.ok(result.answer, question)
    assert.equal(result.notice, null, question)
    assert.equal(result.answerBasis, question === 'what is a vessel-hour?' ? 'explanation' : 'story')
    for (const record of result.evidence) assert.ok(record.sourceUrl)
  }
})
test('notice answer honours the exact effective boundary and approximate clock', async () => {
  const ask = (selectedTimeMs: number) => submitSceneQuestion({...base, question: 'what restriction applied?', selectedTimeMs}, offline)
  assert.match((await ask(base.selectedTimeMs - 1)).answer!, /No published and effective notice/)
  const active = await ask(base.selectedTimeMs)
  assert.match(active.answer!, /10-knot/)
  assert.deepEqual(active.evidenceIds, replay.notices.filter(row => Date.parse(row.effectiveAt) <= base.selectedTimeMs).map(row => row.id))
  const lifted = await ask(Date.parse('2026-09-18T17:00:00Z'))
  assert.match(lifted.answer!, /no restriction/i)
  assert.deepEqual(lifted.evidenceIds, ['navwarn:NW-C-4025-26'])
  assert.match((await ask(NaN)).notice!, /approximate whale clock/)
})
test('latest detection is scoped to the archive and preserves source-local time', async () => {
  const result = await submitSceneQuestion({...base, question: 'latest whale detection?'}, offline)
  assert.match(result.answer!, /source’s local clock/)
  assert.match(result.answer!, /not a current detection/)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].sourceLocalTime, [...replay.detections].sort((a,b)=>b.sourceLocalTime.localeCompare(a.sourceLocalTime))[0].sourceLocalTime)
})
const liveState: NowSceneState = { mode: 'now', vessels: [], restriction: {status: 'unknown', effectiveAt: null, publishedAt: null, speedKnots: null, minimumLengthMetres: null, exceptionsApply: false, cancellationReference: null}, ais: {state: 'unknown', vesselCount: null, lastReceivedAt: null}, whaleReview: null, marine: null }
test('all Live presets explain missing readings without network access or invented zeroes', async () => {
  for (const question of ['what restriction is listed?', 'latest AIS reports?', 'latest whale review?', 'what marine values are stored?']) {
    const result = await submitSceneQuestion({...base, mode: 'live', liveState, question}, offline)
    assert.ok(result.answer, question)
    assert.equal(result.notice, null)
    assert.equal(result.answerBasis, 'displayed-live')
    assert.doesNotMatch(result.answer!, /0 (?:whales|ships|metre)/)
    assert.deepEqual(result.evidenceIds, [])
  }
})
test('live presets retain explicit zero, stale state and timestamps', async () => {
  const result = await submitSceneQuestion({...base, mode: 'live', liveState: {...liveState, whaleReview: {state: 'stale', rightWhaleRows: 0, reviewDate: '2026-10-31'}}, question: 'latest whale review?'}, offline)
  assert.match(result.answer!, /0 right-whale detection rows/)
  assert.match(result.answer!, /stale/)
  assert.match(result.answer!, /2026-10-31/)
})


test('empty service responses explain the failure instead of silently succeeding', async () => {
  const result = await submitSceneQuestion({...base, question: 'compare all vessel speeds'}, async () => new Response('{}', {status: 200}))
  assert.equal(result.answer, null)
  assert.match(result.notice!, /no answer text/)
})


test('Live lifting notice is explicit no restriction, not missing speed data', async () => {
  const result = await submitSceneQuestion({...base, mode: 'live', question: 'what restriction is listed?',
    liveState: {...liveState, restriction: {...liveState.restriction, status: 'record-shows-none', effectiveAt: '2026-09-18T17:00:00Z'}}}, offline)
  assert.match(result.answer!, /explicitly states no restriction/)
  assert.doesNotMatch(result.answer!, /speed limit is unavailable/)
  assert.match(result.answer!, /not a check of current legal requirements/)
})


test('displayed marine preset includes weather codes and distinguishes retained values after refresh failure', async () => {
  const marine = {state: 'fresh' as const, waveHeightMetres: 0, seaSurfaceTemperatureC: 0, currentSpeedMs: 0,
    validAt: '2026-11-04T16:00:00Z', fetchedAt: '2026-11-04T16:01:00Z',
    weather: {code: 95, validAt: '2026-11-04T16:00:00Z', cloudCover: null, windSpeedKmh: null}};
  const ask = (m: typeof marine & {refreshUnavailable?: boolean}) => submitSceneQuestion({...base, mode: 'live',
    question: 'what marine values are stored?', liveState: {...liveState, marine: m}}, offline);
  assert.match((await ask(marine)).answer!, /weather model records storm \(WMO code 95\)/);
  assert.match((await ask({...marine, refreshUnavailable: true})).answer!, /latest refresh failed/);
});
