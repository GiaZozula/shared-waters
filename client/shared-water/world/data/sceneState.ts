import type {
  MarineFact,
  NowAisFact,
  RestrictionFact,
  StoryFleetFact,
  WhaleReviewFact,
} from '../facts/types'

export interface GeoPoint {
  lat: number
  lon: number
}

export type StorySpeedCategory =
  | 'through-10'
  | '10-plus'

export interface StoryVesselRecord {
  id: string

  position: GeoPoint

  speedCategory:
    StorySpeedCategory

  speedBandLabel: string

  name: string | null

  vesselType: string | null
}

export interface NowVesselRecord {
  id: string

  position: GeoPoint

  name: string | null

  speedKnots: number | null

  lastReceivedAt:
    string | null
}

export interface AcousticRecord {
  id: string

  gliderPosition:
    GeoPoint

  sourceLocalTime: string

  reviewDate?: string

  sourceLabel: string

  limitation: string
}

export interface StorySceneInput {
  mode: 'story'

  selectedTimeMs: number

  rangeStartMs: number
  rangeEndMs: number

  vessels:
    StoryVesselRecord[]

  detections:
    AcousticRecord[]

  restriction:
    RestrictionFact

  marine:
    MarineFact | null

  /*
   * Absent lets a zero-vessel hour
   * use the empty-hour note.
   */
  fleetCoverage?:
    | 'ready'
    | 'empty-hour'
    | 'not-imported'
    | 'incomplete'
    | 'unavailable'
}

export interface NowSceneInput {
  mode: 'now'

  ais: {
    connection?: NowAisFact['connection']

    state:
      NowAisFact['state']

    lastReceivedAt:
      string | null

    vessels:
      NowVesselRecord[]
  }

  restriction:
    RestrictionFact

  whaleReview:
    WhaleReviewFact | null

  marine:
    MarineFact | null
}

export interface SceneVesselMark {
  id: string

  lastReceivedAt?: string | null

  source:
    'gfw' | 'ais'

  worldX: number
  worldZ: number

  name: string | null

  speedKnots:
    number | null

  speedBandLabel:
    string | null

  vesselType:
    string | null

  /*
   * Deliberately absent.
   * The current data does not establish it.
   */
  headingDegrees: null
}

export interface SceneDetectionMark {
  id: string

  worldX: number
  worldZ: number

  sourceLocalTime: string

  reviewDate: string

  sourceLabel: string

  limitation: string
}

export interface StorySceneState {
  mode: 'story'

  selectedTimeMs: number

  rangeStartMs: number
  rangeEndMs: number

  vessels:
    SceneVesselMark[]

  detections:
    SceneDetectionMark[]

  restriction:
    RestrictionFact

  fleet:
    StoryFleetFact

  marine:
    MarineFact | null
}

export interface NowSceneState {
  mode: 'now'

  vessels:
    SceneVesselMark[]

  restriction:
    RestrictionFact

  ais:
    NowAisFact

  whaleReview:
    WhaleReviewFact | null

  marine:
    MarineFact | null
}

export type SceneState =
  | StorySceneState
  | NowSceneState
