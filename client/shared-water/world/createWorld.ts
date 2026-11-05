import { createStoryPlayback } from '../../story-playback.js'
import { retainReading } from '../../retained-reading.js';
import { freshWeather } from '../../../shared/live-weather.js'
import type { AisPreview } from '../../ais-preview'
import type { ApiReadiness } from '../../api-readiness'
import { apiFetch } from '../../api-fetch.js';
import { createAmbientClock } from './time/createAmbientClock'
import { updateArtMoonDirection } from './time/artMoonDirection'
import { timelineEvents } from './time/timelineEvents'
import { frameAt, minuteForInstant } from '../../replay-model'
import storySnapshotUrl from '../../../data/story/snapshot.json?url'
import { adaptEvidenceRecord } from './question/askScene'
import * as THREE from 'three'
import { createLiveRefresh } from '../../live-refresh'

import {
  createAtmosphere,
} from './createAtmosphere'

import {
  createOcean,
  MAX_VESSELS,
} from './createOcean'

import {
  createPostProcessing,
} from './createPostProcessing'

import {
  createStars,
  updateStars,
} from './createStars'

import {
  updateWorld,
} from './updateWorld'

import {
  createVesselField,
} from './vessels/createVesselField'

import {
  updateVessels,
} from './vessels/updateVessels'

import {
  createDetectionField,
} from './acoustic/createDetectionField'

import {
  updateDetections,
} from './acoustic/updateDetections'

import {
  createGhostText,
} from './interaction/createGhostText'

import {
  createInteraction,
} from './interaction/createInteraction'

import {
  createWorldTime,
} from './time/createWorldTime'

import {
  createTimeInstrument,
} from './time/createTimeInstrument'

import {
  sampleArtAtmosphere,
  createLiveAtmosphere,
} from './weather/sampleArtAtmosphere'

import {
  createClouds,
} from './weather/createClouds'

import {
  createRain,
} from './weather/createRain'

import {
  createQuestionOrb,
} from './question/createQuestionOrb'

import {
  focusableEvidenceId,
  submitSceneQuestion,
} from './question/askScene'

import {
  createEvidenceMembrane,
} from './evidence/createEvidenceMembrane'

import {
  createAboutMembrane,
} from './about/createAboutMembrane'

import {
  createSceneClock,
} from './time/createSceneClock'

import {
  detectionRevealMs,
} from './acoustic/detectionReveal'

import type {
  SceneTimeMode,
} from './time/createSceneClock'

import {
  createModeControl,
} from './createModeControl'

import {
  getSolarState,
} from './time/getSolarState'

import {
  sceneLocation,
} from './time/sceneLocation'

import {
  createSunLight,
} from './createSunLight'

import {
  createFactRail,
} from './facts/createFactRail'

import {
  buildSceneState,
} from './data/buildSceneState'

import type {
  SceneState,
} from './data/sceneState'

import {
  adaptStoryReplay,
  storySceneBeforeReplay,
} from '../../adapt-story-replay'

import type {
  ReplayData,
} from '../../replay-model'

import {
  adaptNowReads,
} from '../../adapt-now-reads'

import {
  geoToWorld,
} from './geo/zoneProjection'

import type {
  VesselWakeInput,
} from './vessels/createVesselWakes'

import {
  createZoneA,
} from './zone/createZoneA'

import {
  createDetectionLabels,
} from './acoustic/createDetectionLabels'

export function createWorld(
  root: HTMLElement,
  options: {
    mode?: SceneTimeMode
    readiness?: ApiReadiness
    aisPreview?: AisPreview

    onModeChange?: (
      mode: SceneTimeMode,
    ) => void
  } = {},
): void {
  const scene =
    new THREE.Scene()

  scene.background =
    new THREE.Color(
      '#010305',
    )

  scene.fog =
    new THREE.FogExp2(
      '#010305',
      0.014,
    )

  const camera =
    new THREE.PerspectiveCamera(
      42,
      1,
      0.1,
      500,
    )

  camera.position.set(
    0,
    4.5,
    15,
  )

  camera.lookAt(
    0,
    -1.5,
    -8,
  )

  const renderer =
    new THREE.WebGLRenderer({
      antialias: true,
      powerPreference:
        'high-performance',
    })

  const pixelRatio =
    Math.min(
      window.devicePixelRatio,
      2,
    )

  renderer.setPixelRatio(
    pixelRatio,
  )

  renderer.outputColorSpace =
    THREE.SRGBColorSpace

  renderer.toneMapping =
    THREE.ACESFilmicToneMapping

  renderer.toneMappingExposure =
    0.69

  root.appendChild(
    renderer.domElement,
  )

  const canvas =
    renderer.domElement

  const ghostText =
    createGhostText()

  const atmosphere =
    createAtmosphere()

  const stars =
    createStars()
  stars.userData.waterReflection = false

  // Development-only A/B preview; production always uses the reflective water.
  const oceanPreview = import.meta.env.DEV ? new URLSearchParams(location.search) : null
  const ocean = createOcean(oceanPreview?.get('water') !== 'legacy')

  const vesselField =
    createVesselField()

  const detectionField =
    createDetectionField()

  const cloudSystem =
    createClouds()

  const rainSystem =
    createRain()

  const sun =
    createSunLight()

  scene.add(
    atmosphere,
    stars,
    cloudSystem.group,
    ocean,
    vesselField.group,
    detectionField.group,
    rainSystem.rain,
    sun.light,
    sun.light.target,
    sun.ambient,
  )

  const interaction =
    createInteraction({
      canvas,
      camera,

      targets: [],

      onSelect(entity) {
        ghostText.show(
          entity,
        )
      },

      onClear() {
        ghostText.hide()
      },
    })

  const postProcessing =
    createPostProcessing(
      renderer,
      scene,
      camera,
    )

  const worldTime =
    createWorldTime({
      start:
        '2026-09-13T00:00:00Z',

      end:
        '2026-09-20T00:00:00Z',

      initialProgress:
        0,
    })

  let approximateStoryTime = false
  let storyPlaybackTimer = 0

  const sceneClock =
    createSceneClock({
      mode:
        options.mode ??
        'story',

      getStoryTimeMs() {
        return (
          worldTime
            .selectedTimeMs
        )
      },
    })

  Object.assign(
    globalThis,
    { sceneClock },
  )

  function formatTime(progress: number) {
    const value = new Date(worldTime.timeAtProgress(progress))
        .toISOString()
        .slice(
          0,
          16,
        )
        .replace(
          'T',
          ' ',
        )
    const sourceLocal = timelineEvents.some(event => event.timeBasis === 'source-local' && Math.abs(event.progress - progress) < 1e-9)
    return sourceLocal
      ? `~ ${value} local`
      : `${value} UTC`
  }

  const factRail =
    createFactRail({
      onSelectVessel: entity => interaction.select(entity),
      onOpenNotice: () => { showStoryEvidence(); evidenceMembrane.openArchive() },
    })

  const zoneA =
    createZoneA(
      camera,
    )

  scene.add(
    zoneA.group,
  )

  const detectionLabels =
    createDetectionLabels(
      camera,
      (anchor, times) => {
        ghostText.showAt(
          anchor,
          ['WHALES DETECTED'],
          times.join(' · '),
        )
      },
    )

  let sceneState:
    SceneState

  let storyReplay:
    ReplayData | null =
    null

  let nowAis:
    unknown =
    null

  let nowWhoi:
    unknown =
    null

  let nowNavwarn:
    unknown =
    null

  let nowMarine:
    unknown =
    null

  let nowReadGeneration =
    0

  let previousEvidenceIds:
    string[] =
    []

  let questionGeneration = 0

  const reportedMismatches =
    new Set<string>()

  function reportMismatches(
    messages:
      string[],
  ) {
    for (
      const message
      of messages
    ) {
      if (
        reportedMismatches.has(
          message,
        )
      ) {
        continue
      }

      reportedMismatches.add(
        message,
      )

      console.warn(
        message,
      )
    }
  }

  function updateInteractionTargets() {
    factRail.setVessels(vesselField.vessels)
    interaction.setTargets(
      [
        ...vesselField.vessels.map(
          vessel =>
            vessel.hitArea,
        ),

        ...detectionField.detections.map(
          detection =>
            detection.hitArea,
        ),
      ],
    )
  }

  function buildWakeInputs(
    vessels:
      SceneState['vessels'],

    adapted:
      ReturnType<
        typeof adaptStoryReplay
      > | null,
  ): VesselWakeInput[] {
    const wakeById =
      new Map(
        (adapted?.wakes ?? []).map(
          wake => [
            wake.id,
            wake,
          ] as const,
        ),
      )

    return vessels.map(
      vessel => {
        const wake =
          wakeById.get(
            vessel.id,
          )
        const toward =
          wake
            ? geoToWorld(
                wake.toward.lat,
                wake.toward.lon,
              )
            : null

        return {
          id: vessel.id,
          sceneX: vessel.worldX,
          sceneZ: vessel.worldZ,
          towardX: toward?.x ?? null,
          towardZ: toward?.z ?? null,
        }
      },
    )
  }

  function applySceneState(
    next:
      SceneState,

    wakeInputs:
      VesselWakeInput[] =
      [],
  ) {
    sceneState = next

    zoneA.setMode(next.mode)

    vesselField.sync(
      next.vessels,
      wakeInputs,
    )

    zoneA.setRestriction(
      next.restriction,
    )

    if (
      next.mode ===
      'story'
    ) {
      detectionField.sync(
        next.detections,
      )

      factRail.render({
        mode: 'story',
        selectedTimeMs: worldTime.selectedTimeMs,

        restriction:
          next.restriction,

        storyFleet:
          next.fleet,

        marine:
          next.marine,
      })
    } else {
      detectionField.sync(
        [],
      )

      factRail.render({
        mode: 'now',

        restriction:
          next.restriction,

        nowAis:
          next.ais,

        whaleReview:
          next.whaleReview,

        marine:
          next.marine,
      })
    }

    detectionLabels.sync(
      detectionField.detections,
    )

    updateInteractionTargets()
  }

  function reloadSceneState() {
    if (
      sceneClock.mode ===
      'live'
    ) {
      const nextState =
        buildSceneState(
          adaptNowReads({
            ais:
              nowAis,

            whoi:
              nowWhoi,

            navwarn:
              nowNavwarn,

            marine:
              nowMarine,
          }),
        )

      applySceneState(
        nextState,
        buildWakeInputs(
          nextState.vessels,
          null,
        ),
      )

      return
    }

    const adapted =
      storyReplay
        ? adaptStoryReplay(
            storyReplay,
            worldTime
              .selectedTimeMs,
          )
        : null

    if (adapted) {
      reportMismatches(
        adapted.mismatches,
      )
    }

    const nextState =
      buildSceneState(
        adapted
          ? adapted.input
          : storySceneBeforeReplay(
              worldTime
                .selectedTimeMs,
            ),
      )

    const wakeInputs =
      buildWakeInputs(
        nextState.vessels,
        adapted,
      )

    applySceneState(
      nextState,
      wakeInputs,
    )
  }

  async function readCurrent(
    path:
      string,
  ) {
    try {
      const response =
        await apiFetch(
          path,
          { signal: AbortSignal.timeout(12_000), cache: 'no-store' },
        )

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        )
      }

      return await response.json() as unknown
    } catch (error) {
      console.warn(
        `${path} unavailable`,
        error,
      )

      return null
    }
  }

  async function loadNowReads() {
    const generation =
      ++nowReadGeneration

    const [
      whoi,
      navwarn,
      marine,
    ] =
      await Promise.all([
        readCurrent(
          '/api/current/whoi',
        ),

        readCurrent(
          '/api/current/navwarn',
        ),

        readCurrent(
          '/api/current/marine',
        ),
      ])

    if (
      generation !==
      nowReadGeneration
    ) {
      return
    }

    nowWhoi =
      retainReading(nowWhoi, whoi)

    nowNavwarn =
      retainReading(nowNavwarn, navwarn)

    nowMarine =
      retainReading(nowMarine, marine)

    if (
      sceneClock.mode ===
      'live'
    ) {
      reloadSceneState()
    }
  }

  async function loadStoryReplay() {
    try {
      const response =
        await fetch(
          storySnapshotUrl,
          { signal: AbortSignal.timeout(12_000) },
        )

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        )
      }

      const snapshot = await response.json() as { schemaVersion: number; data: ReplayData }
      if (snapshot.schemaVersion !== 1 || snapshot.data.status !== 'ready') {
        throw new Error('Unsupported or incomplete Story snapshot')
      }
      storyReplay = snapshot.data
    } catch (error) {
      console.warn(
        'Story replay unavailable',
        error,
      )

      storyReplay =
        null
    }

    if (
      sceneClock.mode !==
      'live'
    ) {
      reloadSceneState()
      showStoryEvidence()
    }
  }

  function getSolarTimestamp(
    state:
      SceneState,
  ) {
    if (
      state.mode ===
      'story'
    ) {
      return (
        state
          .selectedTimeMs
      )
    }

    /*
     * Used only for current
     * environmental lighting.
     *
     * NOT the timestamp of
     * all Now data.
     */
    return Date.now()
  }

  const applySceneMode =
    sceneClock.setMode.bind(
      sceneClock,
    )

  let syncModeChrome:
    (
      mode: SceneTimeMode,
    ) => void =
    () => {}

  reloadSceneState()

  void loadStoryReplay()

  const liveRefresh = createLiveRefresh({
    load: loadNowReads,
    active: () => sceneClock.mode === 'live' && !document.hidden && (!options.aisPreview || options.aisPreview.isFollowing()) && (!options.readiness || options.readiness.snapshot().state === 'ready'),
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) liveRefresh.pause()
    else liveRefresh.resume()
  })
  window.addEventListener('pagehide', () => liveRefresh.pause())
  window.addEventListener('pageshow', () => liveRefresh.resume())
  options.readiness?.subscribe(value => {
    if (value.state === 'ready') liveRefresh.resume()
    else liveRefresh.pause()
  })
  liveRefresh.resume()
  options.aisPreview?.subscribe(value => {
    if (options.aisPreview?.isFollowing()) liveRefresh.resume()
    else liveRefresh.pause()
    nowAis = value.data
    if (sceneClock.mode === 'live') reloadSceneState()
  })

  const timeInstrument =
    createTimeInstrument({
      initialProgress:
        worldTime.progress,

      visible:
        sceneClock.mode ===
        'story',

      getLabel(progress) {
        return formatTime(progress)
      },

      onChange(progress) {
        approximateStoryTime = timelineEvents.some(event => event.timeBasis === 'source-local' && Math.abs(event.progress - progress) < 1e-9)
        worldTime.setProgress(
          progress,
        )

        reloadSceneState()
        showStoryEvidence()
      },

      onPlayChange(playing) {
        window.clearInterval(storyPlaybackTimer)
        if (!playing) return
        const advance = createStoryPlayback(timelineEvents.map(event => event.progress))
        storyPlaybackTimer = window.setInterval(() => {
          if (sceneClock.mode !== 'story') {
            window.clearInterval(storyPlaybackTimer)
            timeInstrument.setPlaying(false)
            return
          }
          worldTime.setProgress(advance(worldTime.progress))
          approximateStoryTime = timelineEvents.some(event => event.timeBasis === 'source-local' && Math.abs(event.progress - worldTime.progress) < 1e-9)
          timeInstrument.setProgress(worldTime.progress)
          reloadSceneState()
          if (Math.floor(worldTime.selectedTimeMs / 3_600_000) !== storyEvidenceHour) showStoryEvidence()
        }, 100)
      },
    })

  const modeControl =
    createModeControl({
      mode:
        sceneClock.mode,

      onSwitch() {
        sceneClock.setMode(
          sceneClock.mode ===
          'story'
            ? 'live'
            : 'story',
        )
      },
    })


  const evidenceMembrane =
    createEvidenceMembrane(
      [],
    )

  // Recompute displayed freshness from source timestamps even when polling is paused.
  window.setInterval(() => { if (sceneClock.mode === 'live') reloadSceneState() }, 1000)

  let storyEvidenceHour: number | null = null

  function showStoryEvidence() {
    if (!storyReplay || sceneClock.mode !== 'story') return
    storyEvidenceHour = Math.floor(worldTime.selectedTimeMs / 3_600_000)
    const records = [
      ...storyReplay.notices.map(record => ({ ...record, kind: 'navwarn_notice' })),
      ...storyReplay.detections.map(record => ({ ...record, kind: 'whoi_detection' })),
      ...frameAt(storyReplay, minuteForInstant(new Date(worldTime.selectedTimeMs).toISOString())).presence
        .map(record => ({ ...record, kind: 'gfw_presence' })),
    ].map(record => adaptEvidenceRecord({ record })).filter(record => record !== null)
    evidenceMembrane.setArchive({ evidence: records, answer: 'Story archive with notices, whale reviews and ships from the selected hour. Notice times are UTC. Whale times use the source’s local clock.' })
  }

  createAboutMembrane()

  const questionOrb = createQuestionOrb({
    getSubmitContext() {
      return {
        mode: sceneClock.mode,
        generation: questionGeneration,
      }
    },

    getExamples() {
      return sceneClock.mode === 'live'
        ? [
            'what restriction is listed?',
            'latest AIS reports?',
            'latest whale review?',
            'what marine values are stored?',
          ]
        : [
            'what restriction applied?',
            'what is a vessel-hour?',
            'latest whale detection?',
            'notices and detections in story?',
            'what do these records not tell us?',
          ]
        .slice(0, 4)
    },

    async onSubmit(question, requestContext) {
      const result =
        await submitSceneQuestion({
          question,

          mode: requestContext.mode,

          selectedTimeMs:
            requestContext.mode === 'live'
              ? Date.now()
              : approximateStoryTime
                ? Number.NaN
                : worldTime.selectedTimeMs,

          previousEvidenceIds,
          storyReplay,
          liveState: sceneState.mode === 'now' ? sceneState : null,
        })

      if (
        requestContext.generation !== questionGeneration ||
        requestContext.mode !== sceneClock.mode
      ) {
        return false
      }

      questionOrb.setAvailability(result.notice ?? (options.readiness?.snapshot().state === 'ready'
        ? 'The service is reachable. Model answers depend on provider availability and the site’s question allowance. Story presets, displayed Live readings and free explanations work without a model.'
        : 'Model questions need the online service, which is starting or unavailable. Story presets, displayed Live readings and free explanations work without a model.'))

      const asksDetectionMoment = requestContext.mode === 'story' &&
        /\b(when|what time|which date|date did|noticed|detected)\b/i.test(question) &&
        /\b(whale|right whale|detection|detect)\b/i.test(question)
      const detectionRecord = asksDetectionMoment
        ? result.evidence.find(record => record.source === 'WHOI / Robots4Whales' &&
            record.sourceLocalTime && /\d{4}-\d{2}-\d{2}/.test(record.sourceLocalTime))
        : undefined
      let approximateDetectionPosition = false

      if (detectionRecord?.sourceLocalTime) {
        const approximateInstant = detectionRevealMs(detectionRecord.sourceLocalTime)
        const rangeStart = Date.parse('2026-09-13T00:00:00Z')
        const rangeEnd = Date.parse('2026-09-20T00:00:00Z')
        if (
          Number.isFinite(approximateInstant) &&
          approximateInstant >= rangeStart &&
          approximateInstant <= rangeEnd
        ) {
          approximateDetectionPosition = true
          approximateStoryTime = true
          const progress = (approximateInstant - rangeStart) / (rangeEnd - rangeStart)
          worldTime.setProgress(progress)
          timeInstrument.setProgress(progress)
          reloadSceneState()
        }
      }

      previousEvidenceIds =
        result.previousEvidenceIds

      if (result.notice) {
        ghostText.hide()

        evidenceMembrane.show({
          evidence: [],
          warnings: [],
          notice:
            result.notice,
        })

        return true
      }

      const loadedIds =
        new Set([
          ...vesselField.vessels.map(
            vessel =>
              vessel.sceneBinding.id,
          ),

          ...detectionField.detections.map(
            detection =>
              detection.sceneBinding.id,
          ),
        ])

      const focusId =
        focusableEvidenceId(
          result.viewAction,
          result.evidenceIds,
          loadedIds,
        )

      const focused =
        vesselField.vessels.find(
          vessel =>
            vessel.sceneBinding.id ===
            focusId,
        ) ??
        detectionField.detections.find(
          detection =>
            detection.sceneBinding.id ===
            focusId,
        )

      if (focused) {
        interaction.select(
          focused,
        )
      }

      if (approximateDetectionPosition && detectionRecord?.sourceLocalTime) {
        ghostText.showAnswer(
          `WHOI recorded a right-whale detection at ${detectionRecord.sourceLocalTime} (source-local time). This Story position is approximate because the source does not give a UTC offset.`,
        )
      }

      evidenceMembrane.show({
        evidence:
          result.evidence,

        warnings:
          result.warnings,

        answer:
          result.answer,
        answerBasis: result.answerBasis,

        question,

        // Timeline-aligned whale “when” questions reveal the approximate
        // moment in the scene. Other answers belong in the evidence drawer.
        autoOpen: !approximateDetectionPosition,
      })

      return true
    },
  })

  options.readiness?.subscribe(value => {
    questionOrb.setAvailability(value.state === 'ready'
      ? 'The service is reachable. Model answers depend on provider availability and the site’s question allowance. Story presets, displayed Live readings and free explanations work without a model.'
      : 'Model questions need the online service, which is starting or unavailable. Story presets, displayed Live readings and free explanations work without a model.')
  })

  syncModeChrome = (mode) => {
    if (mode !== 'story') {
      window.clearInterval(storyPlaybackTimer)
      timeInstrument.setPlaying(false)
    }
    timeInstrument.setVisible(mode === 'story')
    modeControl.setMode(mode)
    document.body.classList.toggle('is-story-mode', mode === 'story')
    document.body.classList.toggle('is-live-mode', mode === 'live')
  }

  syncModeChrome(sceneClock.mode)

  sceneClock.setMode = (next) => {
    if (next === sceneClock.mode) {
      return
    }

    applySceneMode(next)

    previousEvidenceIds = []
    evidenceMembrane.setArchive(null)
    questionGeneration++
    questionOrb.cancelPending()
    questionOrb.refreshExamples()
    interaction.clear()
    ghostText.hide()

    evidenceMembrane.close()
    evidenceMembrane.show({
      evidence: [],
      warnings: [],
      notice: null,
      answer: null,
    })

    reloadSceneState()
    showStoryEvidence()
    syncModeChrome(next)
    options.onModeChange?.(next)

    if (next === 'live') {
      liveRefresh.resume()
    } else {
      liveRefresh.pause()
    }
  }

  const atmosphereMaterial =
    atmosphere.userData
      .material as
      THREE.ShaderMaterial

  const oceanMaterial =
    ocean.userData
      .material as THREE.ShaderMaterial

  const vesselPositions =
    oceanMaterial
      .uniforms
      .uVesselPositions
      .value as THREE.Vector3[]

  const vesselDirections =
    oceanMaterial
      .uniforms
      .uVesselDirections
      .value as THREE.Vector3[]

  const vesselIntensities =
    oceanMaterial
      .uniforms
      .uVesselIntensities
      .value as Float32Array

  const detectionPositions =
    oceanMaterial
      .uniforms
      .uDetectionPositions
      .value as THREE.Vector3[]

  const detectionStrengths =
    oceanMaterial
      .uniforms
      .uDetectionStrengths
      .value as Float32Array

  const resize = () => {
    const width =
      root.clientWidth

    const height =
      root.clientHeight

    camera.aspect =
      width / height

    camera.updateProjectionMatrix()

    renderer.setSize(
      width,
      height,
    )

    postProcessing.resize(
      width,
      height,
      pixelRatio,
    )
  }

  window.addEventListener(
    'resize',
    resize,
  )

  resize()

  const clock =
    new THREE.Clock()
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const ambientClock = createAmbientClock()
  const measureMotion = import.meta.env.DEV && new URLSearchParams(location.search).has('motionStats')

  const measureOcean = oceanPreview?.has('oceanStats') ?? false
  const frameSamples: number[] = []
  const renderSamples: number[] = []
  let previousFrame = 0
  let measuredFrames = 0
  if (measureOcean) {
    renderer.info.autoReset = false
    renderer.domElement.dataset.oceanStats = 'warming up'
  }

  const smoothLiveAtmosphere = createLiveAtmosphere()
  let wasLive = false
  renderer.setAnimationLoop(() => {
    const frameStart = performance.now()
    if (measureOcean) renderer.info.reset()
    const elapsed = ambientClock.sample(clock.getElapsedTime(), motionPreference.matches)

    const sampledAtmosphere =
      sampleArtAtmosphere({
        weather: sceneState.marine?.weather,
        waveHeightMetres: sceneState.marine?.state === 'fresh' ? sceneState.marine.waveHeightMetres : null,
        mode:
          sceneClock.mode,

        storyTimeMs:
          worldTime
            .selectedTimeMs,

        ambientTime:
          elapsed,
      })

    const isLive = sceneClock.mode === 'live'
    const atmosphere = isLive ? smoothLiveAtmosphere(sampledAtmosphere, elapsed, {
      hasWeather: freshWeather(sceneState.marine?.weather, Date.now()),
      entering: !wasLive,
    }) : sampledAtmosphere
    wasLive = isLive

    const lightingTimestamp = getSolarTimestamp(sceneState)
    const solar =
      getSolarState({
        timestampMs: lightingTimestamp,

        latitude:
          sceneLocation.latitude,

        longitude:
          sceneLocation.longitude,
      })

    sun.light.position
      .copy(
        solar.sunDirection,
      )
      .multiplyScalar(
        60,
      )

    sun.light.intensity =
      solar.daylightStrength *
      1.15

    sun.ambient.intensity =
      0.06 +
      solar.dayAmount *
        0.46

    renderer.toneMappingExposure =
      THREE.MathUtils.lerp(
        0.69,
        0.94,
        solar.dayAmount,
      )

    oceanMaterial.uniforms
      .uTime.value =
      elapsed

    oceanMaterial.uniforms
      .uWind
      .value.set(
        atmosphere.windX,
        -atmosphere.windZ,
      )

    oceanMaterial.uniforms
      .uWeatherEnergy
      .value =
      atmosphere.waterEnergy

    updateVessels(
      vesselField.vessels,
      elapsed,
      atmosphere,
    )

    for (
      let i = 0;
      i < MAX_VESSELS;
      i++
    ) {
      const vessel =
        vesselField.vessels[i]

      if (!vessel) {
        vesselPositions[i].set(
          999,
          999,
          999,
        )

        vesselIntensities[i] =
          0

        continue
      }

      vesselPositions[i].copy(
        vessel.root.position,
      )

      vesselDirections[i].set(
        0,
        0,
        -1,
      )

      vesselIntensities[i] =
        vessel.signalIntensity
    }

    updateDetections(
      detectionField.detections,
      elapsed,
      atmosphere,
      sceneClock.mode ===
        'story'
        ? worldTime
            .selectedTimeMs
        : undefined,
    )

    cloudSystem.update(
      elapsed,
      atmosphere,
      solar,
    )

    rainSystem.update(
      camera,
      elapsed,
      atmosphere,
      solar,
    )

    atmosphereMaterial.uniforms
      .uDayAmount.value =
      solar.dayAmount

    atmosphereMaterial
      .uniforms
      .uNightAmount
      .value =
      solar.nightAmount

    atmosphereMaterial.uniforms
      .uTwilightAmount.value =
      solar.twilightAmount

    atmosphereMaterial.uniforms
      .uSunDirection.value.copy(
        solar.sunDirection,
      )

    atmosphereMaterial.uniforms
      .uWeatherHaze.value =
      atmosphere.haze

    oceanMaterial.uniforms
      .uDayAmount.value =
      solar.dayAmount

    oceanMaterial.uniforms
      .uTwilightAmount.value =
      solar.twilightAmount

    oceanMaterial.uniforms
      .uSunDirection.value.copy(
        solar.sunDirection,
      )

    updateArtMoonDirection(lightingTimestamp, sceneLocation.longitude,
      oceanMaterial.uniforms.uMoonDirection.value)

    if (
      scene.fog instanceof
      THREE.FogExp2
    ) {
      scene.fog.color.setRGB(
        THREE.MathUtils.lerp(
          0.004,
          0.075,
          solar.dayAmount,
        ),

        THREE.MathUtils.lerp(
          0.010,
          0.115,
          solar.dayAmount,
        ),

        THREE.MathUtils.lerp(
          0.014,
          0.125,
          solar.dayAmount,
        ),
      )

      scene.fog.density =
        THREE.MathUtils.lerp(
          0.014,
          0.007,
          solar.dayAmount,
        ) +
        atmosphere.haze *
          0.007
    }

    // Clear slots when records disappear (for example Story → empty Live).
    detectionStrengths.fill(0)

    for (
      let i = 0;
      i <
      detectionField
        .detections
        .length;
      i++
    ) {
      const detection =
        detectionField
          .detections[i]

      detectionPositions[i].copy(
        detection.root.position,
      )

      detectionStrengths[i] =
        detection.pulse
          .material
          .uniforms
          .uIntensity
          .value
    }

    stars.rotation.y =
      elapsed * 0.0006

    const starVisibility =
      THREE.MathUtils.smoothstep(
        solar.nightAmount,
        0.04,
        0.42,
      )

    updateStars(
      stars,
      starVisibility,
    )

    updateWorld(camera, elapsed)
    if (measureMotion) canvas.dataset.motionStats = JSON.stringify({
      reduced: motionPreference.matches, elapsed, camera: camera.position.toArray(),
      waterTime: oceanMaterial.uniforms.uTime.value, selectedTime: sceneClock.timestampMs,
    })

    ghostText.update(
      camera,
    )

    zoneA.update(
      elapsed,
      atmosphere,
    )

    detectionLabels.update(
      detectionField.detections,
    )

    postProcessing.update(
      elapsed,
    )

    interaction.updateKeyboardTargets()
    postProcessing.render()
    if (measureOcean) {
      if (elapsed > 3 && previousFrame && !document.hidden) {
        frameSamples.push(frameStart - previousFrame)
        renderSamples.push(performance.now() - frameStart)
        if (frameSamples.length > 240) { frameSamples.shift(); renderSamples.shift() }
        if (++measuredFrames % 60 === 0) {
          const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]
          renderer.domElement.dataset.oceanStats = JSON.stringify({
            water: oceanPreview?.get('water') === 'legacy' ? 'legacy' : 'three-water',
            samples: frameSamples.length,
            frameMedianMs: percentile(frameSamples, .5), frameP95Ms: percentile(frameSamples, .95),
            cpuMedianMs: percentile(renderSamples, .5), cpuP95Ms: percentile(renderSamples, .95),
            calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            width: renderer.domElement.width, height: renderer.domElement.height,
          })
        }
      }
      previousFrame = frameStart
    }
  })
}
