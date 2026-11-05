import { detectionRevealMs } from './shared-water/world/acoustic/detectionReveal.js'
import type { ReplayData } from './replay-model.js'

export type StoryChapter = {
  id: string; progress: number; kind: 'vessel' | 'detection' | 'restriction'
  title: string; text: string; timeLabel: string; timeBasis: 'utc' | 'source-local'
}
export function buildStoryChapters(data: ReplayData): StoryChapter[] {
  const start = Date.parse(data.start), end = Date.parse(data.end)
  const progress = (at: string) => Math.max(0, Math.min(1, (Date.parse(at) - start) / (end - start)))
  const utc = (at: string) => new Date(at).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' UTC'
  const chapters: StoryChapter[] = [{
    id: 'opening', progress: 0, kind: 'vessel', title: 'One stretch of shared water',
    text: 'This is Zone A, a small section of a shipping zone in the Gulf of St. Lawrence. It is a high traffic shipping area.',
    timeLabel: utc(data.start), timeBasis: 'utc',
  }]
  chapters.push({ id: 'first-evening', progress: progress('2026-09-13T09:00:00Z'), kind: 'vessel',
    title: 'Ships passing through',
    text: 'Here you can see several ships passing through the area. Select a ship to see its name and recorded speed category.',
    timeLabel: utc('2026-09-13T09:00:00Z'), timeBasis: 'utc' })
  chapters.push({ id: 'first-night-storm', progress: progress('2026-09-14T03:00:00Z'), kind: 'vessel',
    title: 'Shared with whales',
    text: 'Ships continue their routes. This area is also home to an endangered whale species, the North Atlantic Right Whale.',
    timeLabel: utc('2026-09-14T03:00:00Z'), timeBasis: 'utc' })
  const reviewDates = [...new Set(data.detections.map(record => record.reviewDate))].sort()
  for (const date of reviewDates) {
    const records = data.detections.filter(record => record.reviewDate === date)
      .sort((a, b) => detectionRevealMs(a.sourceLocalTime, date) - detectionRevealMs(b.sourceLocalTime, date))
    const first = records[0]
    const anchor = detectionRevealMs(first.sourceLocalTime, date)
    const localLabel = utc(new Date(anchor).toISOString()).replace(' UTC', ' local')
    chapters.push({ id: `review-${date}`, progress: progress(new Date(anchor).toISOString()), kind: 'detection',
      title: 'Whale sounds enter the record',
      text: 'The next afternoon, a listening glider records Right Whale sounds. Select the sound marker to explore the record.',
      timeLabel: localLabel, timeBasis: 'source-local' })
  }
  for (const notice of data.notices) {
    if (notice.zoneAState === 'no_restriction_stated') {
      chapters.push({ id: `${notice.id}-effective`, progress: progress(notice.effectiveAt), kind: 'restriction',
        title: 'The restriction is lifted',
        text: 'On 18 September, the Coast Guard lifts the 10-knot restriction for Zone A. Ships can travel at their regular speeds again.',
        timeLabel: utc(notice.effectiveAt), timeBasis: 'utc' })
      continue
    }
    chapters.push({ id: `${notice.id}-published`, progress: progress(notice.publishedAt), kind: 'restriction',
      title: 'A protection notice is published', text: 'The following morning, the Coast Guard publishes a speed notice for Zone A that will begin in 1 hour and 50 minutes. This notice requires vessels over 13 metres long to travel at no more than 10 knots.',
      timeLabel: utc(notice.publishedAt), timeBasis: 'utc' })
    chapters.push({ id: `${notice.id}-effective`, progress: progress(notice.effectiveAt), kind: 'restriction',
      title: 'The notice takes effect', text: 'The 10-knot measure takes effect.',
      timeLabel: utc(notice.effectiveAt), timeBasis: 'utc' })
  }
  const lastNotice = data.notices.filter(notice => notice.zoneAState === 'restricted_10_knots').sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0]
  const later = [...data.presence].sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt)).find(record => Date.parse(record.eventAt) >= Date.parse(lastNotice?.effectiveAt ?? data.start) + 24 * 60 * 60_000)
  if (later) chapters.push({ id: 'later-records', progress: progress(later.eventAt), kind: 'vessel',
    title: 'Look again, a day later', text: 'A day later, ships continue their routes in Zone A. Both ship records for this hour are in the slower speed group, up to 10 knots. The speed notice is still in effect.',
    timeLabel: utc(later.eventAt), timeBasis: 'utc' })
  const endingAt = '2026-09-19T20:00:00Z'
  if (data.presence.some(record => Date.parse(record.eventAt) === Date.parse(endingAt))) {
    chapters.push({ id: 'higher-speeds', progress: progress(endingAt), kind: 'vessel',
      title: 'Higher speeds return',
      text: 'By the evening of 19 September, ships passing through Zone A are again recorded in the higher speed group, 10 knots and above. Select a ship to explore its record.',
      timeLabel: utc(endingAt), timeBasis: 'utc' })
  }
  return chapters.filter(chapter => chapter.progress >= 0 && chapter.progress < 1).sort((a, b) => a.progress - b.progress)
}
export function chapterAt(chapters: StoryChapter[], progress: number) {
  return [...chapters].reverse().find(chapter => chapter.progress <= progress + 0.00001) ?? chapters[0]
}
