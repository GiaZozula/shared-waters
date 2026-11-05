import test from 'node:test'
import assert from 'node:assert/strict'
import snapshot from '../data/story/snapshot.json' with { type: 'json' }
import { buildStoryChapters } from './story-chapters.js'
import { createStoryPlayback } from './story-playback.js'
import { storyReadingAt } from './shared-water/world/facts/createFactRail.js'
import type { ReplayData } from './replay-model.js'
test('automatic timer progression visibly presents every authored chapter', () => {
 const data = snapshot.data as ReplayData
 const chapters = buildStoryChapters(data)
 const advance = createStoryPlayback(chapters.map(c => c.progress))
 let progress = 0
 const seen = new Map<string, number>()
 for (let tick = 0; tick < 2000 && progress < 1; tick++) {
  for (const chapter of chapters) if (Math.abs(progress - chapter.progress) < 1e-10) {
   const at = Date.parse(data.start) + progress * (Date.parse(data.end)-Date.parse(data.start))
   assert.equal(storyReadingAt({} as never, at).text, chapter.text)
   seen.set(chapter.id, (seen.get(chapter.id) ?? 0) + 1)
  }
  progress = advance(progress)
 }
 assert.equal(progress, 1)
 assert.deepEqual([...seen.keys()], chapters.map(c => c.id))
 for (const chapter of chapters.slice(1)) assert.ok(seen.get(chapter.id)! >= 30)
})
