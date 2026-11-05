export type QuestionMode = 'story' | 'live'
export { STORY_FIRST_DATE, STORY_LAST_DATE } from './story-scope.js'

export function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

// A deliberately narrow date recognizer, not an inferred timezone conversion.
export function questionDates(question: string): string[] {
  const dates = [...question.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(match => match[1])
  for (const match of question.matchAll(/\b(?:Sep(?:tember)?\.?\s+(\d{1,2})|(\d{1,2})\s+Sep(?:tember)?\.?)(?:,?\s+(20\d{2}))?\b/gi)) {
    dates.push(`${match[3] ?? '2026'}-09-${(match[1] ?? match[2]).padStart(2, '0')}`)
  }
  return [...new Set(dates)]
}

export function requestsCurrent(question: string): boolean {
  return /\b(now|today|currently|live)\b|\bcurrent\s+(restriction|notice|state|conditions|weather|whale|detection|review|ais|vessels?|reports?)\b/i.test(question)
}
