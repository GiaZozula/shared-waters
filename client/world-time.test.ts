import assert from 'node:assert/strict'
import test from 'node:test'
import snapshot from '../data/story/snapshot.json' with { type: 'json' }
import { buildStoryChapters } from './story-chapters.js'
import { frameAt, minuteForInstant, type ReplayData } from './replay-model.js'
import { submitSceneQuestion } from './shared-water/world/question/askScene.js'
import { createWorldTime } from './shared-water/world/time/createWorldTime.js'

test('previewing a later chapter leaves the selected scene clock unchanged', () => {
  const clock = createWorldTime({ start: '2026-09-13T00:00:00Z', end: '2026-09-17T00:00:00Z', initialProgress: 0 })
  const selected = clock.selectedTimeMs
  assert.equal(clock.timeAtProgress(0.5), Date.parse('2026-09-15T00:00:00Z'))
  assert.equal(clock.progress, 0)
  assert.equal(clock.selectedTimeMs, selected)
  assert.equal(clock.motionTime, 0)
  clock.setProgress(0.5)
  assert.equal(clock.selectedTimeMs, clock.timeAtProgress(0.5))
})

test('seven-day chapter landings retain exact milliseconds and the matching evidence hour', () => {
  const data = snapshot.data as ReplayData
  const clock = createWorldTime({ start: data.start, end: data.end, initialProgress: 0 })
  const expected = [
    '2026-09-13T00:00:00Z', '2026-09-13T09:00:00Z', '2026-09-14T03:00:00Z',
    '2026-09-14T15:23:53Z', '2026-09-15T10:40:00Z', '2026-09-15T12:30:00Z',
    '2026-09-16T13:00:00Z', '2026-09-18T17:00:00Z', '2026-09-19T20:00:00Z',
  ]
  const chapters = buildStoryChapters(data)
  assert.equal(chapters.length, expected.length)
  chapters.forEach((chapter, index) => {
    const instant = expected[index]
    assert.equal(clock.timeAtProgress(chapter.progress), Date.parse(instant))
    clock.setProgress(chapter.progress)
    assert.equal(clock.selectedTimeMs, Date.parse(instant))
    const frame = frameAt(data, minuteForInstant(new Date(clock.selectedTimeMs).toISOString()))
    assert.equal(frame.hour, instant.slice(0, 13) + ':00:00.000Z')
    if (chapter.id.endsWith('-effective')) {
      assert.equal(frame.notice?.effectiveAt, new Date(clock.selectedTimeMs).toISOString())
    }
  })
})

test('End keeps the frame and outgoing question inside the exclusive Story window', async () => {
  const data = snapshot.data as ReplayData
  const clock = createWorldTime({ start: data.start, end: data.end, initialProgress: 0 })
  clock.setProgress(1)
  assert.equal(clock.progress, 1)
  assert.equal(clock.selectedTimeMs, Date.parse(data.end) - 1)
  assert.equal(clock.timeAtProgress(1), clock.selectedTimeMs)
  const selected = new Date(clock.selectedTimeMs).toISOString()
  assert.equal(selected, '2026-09-19T23:59:59.999Z')
  const frame = frameAt(data, minuteForInstant(selected))
  assert.equal(frame.hour, '2026-09-19T23:00:00.000Z')
  assert.ok(frame.presence.length > 0)
  assert.ok(frame.presence.every(row => row.eventAt === frame.hour))
  assert.equal(frame.notice?.id, 'navwarn:NW-C-4025-26')
  let sentTime: string | undefined
  const result = await submitSceneQuestion({
    question: 'compare the records for this selected moment', mode: 'story',
    selectedTimeMs: clock.selectedTimeMs, previousEvidenceIds: [],
  }, async (_input, init) => {
    sentTime = JSON.parse(String(init?.body)).selectedTime
    return new Response(JSON.stringify({ answer: 'Stubbed stored-record answer.', evidenceIds: [] }), { status: 200 })
  })
  assert.equal(result.notice, null)
  assert.equal(sentTime, '2026-09-19T23:59:59Z')
  assert.ok(Date.parse(sentTime!) < Date.parse(data.end))
  clock.setProgress(0)
  assert.equal(clock.selectedTimeMs, Date.parse(data.start))
})
