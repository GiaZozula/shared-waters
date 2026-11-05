import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createAmbientClock } from './shared-water/world/time/createAmbientClock.js'
import { createWorldTime } from './shared-water/world/time/createWorldTime.js'
import { updateWorld } from './shared-water/world/updateWorld.js'
import { getOceanHeight } from './shared-water/world/oceanHeight.js'
import { sampleArtAtmosphere } from './shared-water/world/weather/sampleArtAtmosphere.js'
import { createRain } from './shared-water/world/weather/createRain.js'
import { getSolarState } from './shared-water/world/time/getSolarState.js'
import { animateSceneText } from './shared-water/world/ui/animateSceneText.js'

test('reduced motion freezes camera, water and storm rain, then resumes without paused-time jumps', () => {
  const clock = createAmbientClock()
  const camera = new THREE.PerspectiveCamera()
  const rain = createRain()
  const selected = Date.parse('2026-09-14T03:00:00Z')
  const solar = getSolarState({ timestampMs: selected, latitude: 49.358, longitude: -64.687 })
  function frame(now: number, reduced: boolean) {
    const elapsed = clock.sample(now, reduced)
    const atmosphere = sampleArtAtmosphere({ mode: 'story', storyTimeMs: selected, ambientTime: elapsed })
    updateWorld(camera, elapsed)
    rain.update(camera, elapsed, atmosphere, solar)
    return { elapsed, camera: camera.position.toArray(), rotation: camera.quaternion.toArray(),
      height: getOceanHeight(2, -3, elapsed, atmosphere), rain: Array.from(rain.rain.geometry.getAttribute('position').array) }
  }
  try {
    const normal = frame(5, false)
    assert.deepEqual(frame(6, true), normal)
    assert.deepEqual(frame(600, true), normal)
    assert.deepEqual(frame(601, false), normal)
    const resumed = frame(602, false)
    assert.equal(resumed.elapsed, 6)
    assert.notDeepEqual(resumed.camera, normal.camera)
    assert.notEqual(resumed.height, normal.height)
    assert.notDeepEqual(resumed.rain, normal.rain)
  } finally { rain.rain.geometry.dispose(); rain.rain.material.dispose() }
})

test('initial reduced preference stays still while explicit Story controls retain their evidence clock', () => {
  const ambient = createAmbientClock()
  const story = createWorldTime({ start: '2026-09-13T00:00:00Z', end: '2026-09-20T00:00:00Z', initialProgress: 0 })
  assert.equal(ambient.sample(3, true), 0)
  story.setProgress(0.5)
  assert.equal(ambient.sample(50, true), 0)
  assert.equal(story.progress, 0.5)
  assert.equal(story.selectedTimeMs, Date.parse('2026-09-16T12:00:00Z'))
  story.setProgress(1)
  assert.equal(story.selectedTimeMs, Date.parse('2026-09-20T00:00:00Z') - 1)
  assert.equal(ambient.sample(51, false), 0)
  assert.equal(ambient.sample(52, false), 1)
})

test('text effects skip delays initially and finish an active effect on a preference change', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  class Preference extends EventTarget { matches = false; removed = 0
    override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) { this.removed++; super.removeEventListener(...args) }
  }
  const preference = new Preference()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => preference } })
  const timings: KeyframeAnimationOptions[] = []
  let finishes = 0
  const frames = [{ opacity: 0 }, { opacity: 1 }]
  try {
    function target() {
      let resolve!: () => void
      const finished = new Promise<void>(done => { resolve = done })
      return { animate(received: Keyframe[], options: KeyframeAnimationOptions) {
        assert.equal(received, frames); timings.push(options)
        return { finished, finish() { finishes++; resolve() } }
      } } as unknown as HTMLElement
    }
    const active = animateSceneText(target(), frames, { duration: 1000, delay: 200, fill: 'forwards' })
    assert.equal(timings[0].duration, 1000)
    preference.matches = true
    preference.dispatchEvent(new Event('change'))
    await active.finished
    assert.equal(finishes, 1)
    assert.equal(preference.removed, 1)
    const immediate = animateSceneText(target(), frames, { duration: 1000, delay: 200, fill: 'forwards' })
    assert.deepEqual(timings[1], { duration: 0, delay: 0, fill: 'forwards' })
    immediate.finish(); await immediate.finished
    assert.equal(preference.removed, 2)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
