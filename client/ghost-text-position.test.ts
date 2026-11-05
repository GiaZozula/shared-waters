import assert from 'node:assert/strict'
import test from 'node:test'
import { ghostTextPosition } from './shared-water/world/interaction/ghostTextPosition.js'

test('wrapped hover text stays above compact controls and inside the screen', () => {
  for (const [width, height, messageHeight, controlsTop] of [[390, 844, 150, 600], [674, 919, 180, 680], [844, 390, 120, 250]]) {
    const messageWidth = width * .86
    const result = ghostTextPosition(width, height, width, height, messageWidth, messageHeight, controlsTop)
    assert.ok(result.y <= height * .52)
    assert.ok(result.y + messageHeight / 2 <= controlsTop - 20)
    assert.ok(result.y - messageHeight / 2 >= 16)
    assert.ok(result.x + messageWidth / 2 <= width - 16)
    assert.ok(result.x - messageWidth / 2 >= 16)
  }
})

test('the date beneath whale hover text stays above the glider marker', () => {
  for (const [width, height, messageHeight, markerTop] of [[390, 844, 150, 420], [674, 919, 180, 460], [844, 390, 120, 220]]) {
    const result = ghostTextPosition(width / 2, markerTop, width, height, width * .86, messageHeight, height - 120, markerTop)
    assert.ok(result.y + messageHeight / 2 <= markerTop - 20)
    assert.ok(result.y - messageHeight / 2 >= 16)
  }
})
