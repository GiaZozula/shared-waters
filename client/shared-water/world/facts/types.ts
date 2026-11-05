export type SceneMode =
  | 'story'
  | 'now'

export type DataState =
  | 'fresh'
  | 'stale'
  | 'missing'
  | 'unknown'
  | 'quiet'
  | 'unconfigured'

export type RestrictionStatus =
  | 'unknown'
  | 'record-shows-none'
  | 'active'
  | 'unverified'
  | 'pending'

export interface RestrictionFact {
  refreshUnavailable?: boolean

  status:
    RestrictionStatus

  effectiveAt:
    string | null

  publishedAt:
    string | null

  speedKnots:
    number | null

  minimumLengthMetres:
    number | null

  exceptionsApply:
    boolean

  cancellationReference:
    string | null
}

export interface StoryFleetFact {
  state:
    'available' |
    'unknown'

  note:
    string | null

  throughTenKnots:
    number

  tenAndAbove:
    number

  total:
    number

  selectedHour:
    string

  coverage:
    | 'ready'
    | 'empty-hour'
    | 'not-imported'
    | 'incomplete'
    | 'unavailable'
}

export interface NowAisFact {
  connection?: 'connecting' | 'connected' | 'disconnected' | 'unconfigured' | 'unverified' | 'unavailable'

  state:
    DataState

  vesselCount:
    number | null

  lastReceivedAt:
    string | null
}

export interface WhaleReviewFact {
  refreshUnavailable?: boolean

  state:
    'recent' |
    'stale' |
    'missing'

  reviewDate:
    string | null

  rightWhaleRows:
    number | null
}

import type { LiveWeather } from '../../../../shared/live-weather.js'

export interface MarineFact {
  refreshUnavailable?: boolean

  weather?: LiveWeather | null

  state:
    'fresh' |
    'stale' |
    'missing'

  waveHeightMetres:
    number | null

  seaSurfaceTemperatureC:
    number | null

  currentSpeedMs:
    number | null

  validAt:
    string | null

  fetchedAt:
    string | null
}

export interface AcousticFact {
  sourceLocalTime:
    string

  sourceLabel:
    string

  limitation:
    string
}

export interface StorySceneFacts {
  selectedTimeMs?: number
  mode: 'story'

  restriction:
    RestrictionFact

  storyFleet: StoryFleetFact

  marine:
    MarineFact | null
}

export interface NowSceneFacts {
  mode: 'now'

  restriction: RestrictionFact

  nowAis: NowAisFact

  whaleReview: WhaleReviewFact | null

  marine: MarineFact | null
}

export type SceneFacts =
  | StorySceneFacts
  | NowSceneFacts
