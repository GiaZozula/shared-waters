import snapshot from '../../../../data/story/snapshot.json'
import { buildStoryChapters } from '../../../story-chapters'
import type { ReplayData } from '../../../replay-model'

// Detection chapters align with the first source-local reveal clock, approximately.
// They are not conversions of source-local detection times into UTC.
export const timelineEvents = buildStoryChapters(snapshot.data as ReplayData)
export type TimelineEvent = typeof timelineEvents[number]
export type TimelineEventKind = TimelineEvent['kind']
