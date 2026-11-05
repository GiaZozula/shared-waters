import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import { createSceneClock } from './shared-water/world/time/createSceneClock.js'
import { updateArtMoonDirection } from './shared-water/world/time/artMoonDirection.js'

test('decorative moon direction follows selected time continuously and reversibly', () => {
  const start = Date.parse('2026-09-15T01:00:00Z')
  const sample = (at: number) => updateArtMoonDirection(at, -64.687, new Vector3())
  const early = sample(start)
  const later = sample(start + 4 * 3_600_000)
  assert.ok(early.distanceTo(later) > .1)
  assert.ok(Math.abs(later.length() - 1) < 1e-12)
  assert.ok(later.y > 0)
  assert.deepEqual(sample(start), early)
  assert.ok(sample(start + 86_400_000).distanceTo(early) < 1e-10)
  const midnight = Date.parse('2026-09-15T00:00:00Z') + 64.687 / 360 * 86_400_000
  assert.ok(sample(midnight - 1).distanceTo(sample(midnight + 1)) < 1e-6)
})

test('mode switching uses the destination clock rather than the previous moonlight position', t => {
  const selected = Date.parse('2026-09-15T01:00:00Z')
  const current = Date.parse('2026-11-02T10:00:00Z')
  t.mock.method(Date, 'now', () => current)
  const clock = createSceneClock({ mode: 'story', getStoryTimeMs: () => selected })
  const direction = () => updateArtMoonDirection(clock.timestampMs, -64.687, new Vector3())
  const story = direction()
  clock.setMode('live')
  assert.equal(clock.timestampMs, current)
  assert.ok(direction().distanceTo(story) > .1)
  clock.setMode('story')
  assert.deepEqual(direction(), story)
})
