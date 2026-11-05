import assert from 'node:assert/strict'
import test from 'node:test'
import snapshot from '../data/story/snapshot.json' with { type: 'json' }
import type { ReplayData } from './replay-model.js'
import { detectionIsRevealed } from './shared-water/world/acoustic/detectionReveal.js'
import { buildStoryChapters, chapterAt } from './story-chapters.js'

test('Story chapters follow reviewed evidence, retaining the detection clock boundary', () => {
  const data = snapshot.data as ReplayData
  const chapters = buildStoryChapters(data)
  assert.equal(chapters.length, 9)
  assert.equal(chapters[0].progress, 0)
  assert.equal(chapters.filter(chapter => chapter.kind === 'detection').length, 1)
  const detection = chapters.find(chapter => chapter.kind === 'detection')!
  assert.equal(detection.timeBasis, 'source-local')
  assert.match(detection.timeLabel, /14 Sept?,? 15:23 local/)
  assert.equal(detection.progress, (Date.parse('2026-09-14T15:23:53Z') - Date.parse(data.start)) / (Date.parse(data.end) - Date.parse(data.start)))
  assert.match(detection.text, /glider records Right Whale sounds/)
  const selected = Date.parse(data.start) + detection.progress * (Date.parse(data.end) - Date.parse(data.start))
  assert.equal(detectionIsRevealed(selected, data.detections[0].sourceLocalTime), true)
  assert.equal(detectionIsRevealed(selected, data.detections[1].sourceLocalTime), false)
  assert.equal(detectionIsRevealed(selected - 1, data.detections[0].sourceLocalTime), false)
  const progress = (at: string) => (Date.parse(at) - Date.parse(data.start)) / (Date.parse(data.end) - Date.parse(data.start))
  assert.match(chapterAt(chapters, progress('2026-09-15T12:29:00Z')).title, /published/)
  assert.match(chapterAt(chapters, progress('2026-09-15T12:30:00Z')).title, /takes effect/)
  const last = chapters.at(-1)!
  assert.equal(last.progress, progress('2026-09-19T20:00:00Z'))
  assert.ok(data.presence.some(record => progress(record.eventAt) === last.progress))
  assert.ok(chapters.every((chapter, i) => !i || chapter.progress > chapters[i - 1].progress))
})


test('introductory stops use the requested UTC times', () => {
  const data = snapshot.data as ReplayData
  const chapters = buildStoryChapters(data)
  const at = (progress: number) => new Date(Date.parse(data.start) + progress * (Date.parse(data.end) - Date.parse(data.start))).toISOString()
  assert.deepEqual(chapters.slice(0, 3).map(chapter => at(chapter.progress)), [
    '2026-09-13T00:00:00.000Z', '2026-09-13T09:00:00.000Z', '2026-09-14T03:00:00.000Z',
  ])
  assert.match(chapters[0].timeLabel, /13 Sept?,? 00:00 UTC/)
  const last = chapters.at(-1)!
  const rows = data.presence.filter(row => row.eventAt === '2026-09-16T13:00:00.000Z')
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.speedBandGroup === 'bands_below_or_up_to_10'))
  assert.match(chapters.find(chapter => chapter.id === 'later-records')!.text, /notice is still in effect/)
})

test('lifting step changes the restriction at exactly 17:00 and the ending has higher-speed ships', async () => {
  const { frameAt, minuteForInstant } = await import('./replay-model.js')
  const data = snapshot.data as ReplayData
  const chapters = buildStoryChapters(data)
  const lift = chapters.find(chapter => chapter.title === 'The restriction is lifted')!
  assert.equal(lift.timeLabel, '18 Sept, 17:00 UTC')
  assert.equal(frameAt(data, minuteForInstant('2026-09-18T16:59:00Z')).notice?.zoneAState, 'restricted_10_knots')
  const after = frameAt(data, minuteForInstant('2026-09-18T17:00:00Z'))
  assert.equal(after.notice?.zoneAState, 'no_restriction_stated')
  const ending = frameAt(data, minuteForInstant('2026-09-19T20:00:00Z'))
  assert.equal(ending.presence.length, 2)
  assert.equal(ending.upperCategory, 2)
  assert.equal(ending.notice?.zoneAState, 'no_restriction_stated')
})
