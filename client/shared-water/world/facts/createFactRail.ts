import { describeWeather } from '../../../../shared/weather-description.js'
import { freshWeather, weatherKind, WEATHER_LABELS } from '../../../../shared/live-weather.js'
import type { InteractiveEntity } from '../interaction/types'
import { chapterAt } from '../../../story-chapters'
import { timelineEvents } from '../time/timelineEvents'
import { REPLAY_START, REPLAY_END } from '../../../replay-model'
import type {
  MarineFact,
  NowSceneFacts,
  SceneFacts,
  StoryFleetFact,
  StorySceneFacts,
  WhaleReviewFact,
} from './types'

import {
  restrictionSentence,
} from '../zone/restrictionLabel'

function speakInstant(
  value: string | null,
) {
  if (!value) {
    return 'N/A'
  }

  const parsed =
    Date.parse(
      value,
    )

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return value
  }

  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(parsed))} UTC`
}

function speakHour(
  selectedHour: string,
) {
  return speakInstant(
    selectedHour,
  )
}

function categoryCounts(
  fleet: StoryFleetFact,
) {
  return `${fleet.throughTenKnots} of ${fleet.total} Global Fishing Watch vessel-hours fall in speed categories up to 10 knots. ${fleet.tenAndAbove} ${fleet.tenAndAbove === 1 ? 'falls' : 'fall'} in categories starting at 10 knots`
}

function incompleteCounts(
  fleet: StoryFleetFact,
) {
  return `${fleet.throughTenKnots} of ${fleet.total} Global Fishing Watch vessel-hours fall in speed categories up to 10 knots. ${fleet.tenAndAbove} ${fleet.tenAndAbove === 1 ? 'falls' : 'fall'} in categories starting at 10 knots`
}

export function storyHourSentence(
  fleet: StoryFleetFact,
) {
  const at =
    `At ${speakHour(fleet.selectedHour)}`

  if (
    fleet.coverage ===
    'not-imported'
  ) {
    return `${at}, the Global Fishing Watch snapshot is not loaded.`
  }

  if (
    fleet.coverage ===
    'unavailable'
  ) {
    return `${at}, this hour could not be read.`
  }

  if (
    fleet.coverage ===
    'incomplete'
  ) {
    if (
      fleet.total === 0
    ) {
      return `${at}, the snapshot is incomplete, so this hour cannot be counted.`
    }

    return `${at}, an incomplete snapshot shows ${incompleteCounts(fleet)}.`
  }

  if (
    fleet.coverage ===
      'empty-hour' ||
    fleet.total === 0
  ) {
    return `${at}, this hour of the snapshot has no vessel-hours. That is missing coverage, not an empty sea.`
  }

  return `${at}, ${categoryCounts(fleet)}.`
}

export function createFactRail(options: {
  onSelectVessel: (entity: InteractiveEntity) => void
  onOpenNotice: () => void
}) {
  const root =
    document.createElement(
      'aside',
    )

  root.className =
    'fact-rail'

  root.setAttribute('aria-label', 'Scene reading')
  // Keep overflowed narration reachable with native keyboard scrolling.
  root.tabIndex = 0
  root.setAttribute(
    'aria-live',
    'polite',
  )

  document.body.appendChild(
    root,
  )

  const openReadings = new Map<string, boolean>()
  let liveMarkup = ''
  root.addEventListener('toggle', event => {
    const details = event.target
    if (details instanceof HTMLDetailsElement && details.dataset.reading && root.contains(details)) {
      openReadings.set(details.dataset.reading, details.open)
    }
  }, true)

  function renderStory(
    facts:
      StorySceneFacts,
  ) {
    const at = facts.selectedTimeMs ?? Date.parse(facts.storyFleet.selectedHour)
    const reading = storyReadingAt(facts.storyFleet, at)
    if (root.dataset.mode !== 'story') {
      root.innerHTML = `
        <p class="chapter-copy"></p>
        <p class="chapter-time"></p>
        <div class="chapter-notice" hidden>
          <button type="button" class="chapter-notice__button"></button>
          <p class="chapter-notice__scope"></p>
        </div>
        <details class="chapter-records">
          <summary><span class="chapter-records__label">At the selected hour</span></summary>
          <p></p>
        </details>`
    }
    // Scrubbing changes the hour repeatedly; keep disclosure/focus and arrival
    // animations intact instead of replacing the entire reading every frame.
    const update = (selector: string, text: string) => {
      const element = root.querySelector<HTMLElement>(selector)!
      if (element.textContent !== text) element.textContent = text
    }
    const notice = root.querySelector<HTMLElement>('.chapter-notice')!
    notice.hidden = facts.restriction.status !== 'active'
    update('.chapter-notice__button', facts.restriction.speedKnots === null
      ? 'Zone A speed limit in effect' : `${facts.restriction.speedKnots}-knot Zone A limit in effect`)
    update('.chapter-notice__scope', [facts.restriction.minimumLengthMetres === null
      ? 'Vessel size threshold not established' : `Vessels over ${facts.restriction.minimumLengthMetres} m`,
      facts.restriction.exceptionsApply ? 'exceptions apply' : ''].filter(Boolean).join(' · '))
    update('.chapter-copy', reading.text)
    update('.chapter-time', reading.timeLabel)
    update('.chapter-records p', storyHourSentence(facts.storyFleet))
  }

  function renderNow(
    facts:
      NowSceneFacts,
  ) {
    const markup = [renderAis(facts), renderRestriction(facts), renderReview(facts), renderMarine(facts.marine)].join('')
    if (root.dataset.mode === 'now' && markup === liveMarkup) return
    const active = document.activeElement
    const focusedReading = active instanceof HTMLElement && active.matches('summary')
      ? active.closest<HTMLDetailsElement>('details[data-reading]')?.dataset.reading
      : undefined
    root.querySelectorAll<HTMLDetailsElement>('details[data-reading]').forEach(details => {
      openReadings.set(details.dataset.reading!, details.open)
    })
    const scrollTop = root.scrollTop
    root.innerHTML = markup
    liveMarkup = markup
    root.querySelectorAll<HTMLDetailsElement>('details[data-reading]').forEach(details => {
      details.open = openReadings.get(details.dataset.reading!) ?? false
    })
    if (focusedReading) root.querySelector<HTMLElement>(`details[data-reading="${focusedReading}"] summary`)?.focus({ preventScroll: true })
    root.scrollTop = scrollTop
  }

  function render(
    facts:
      SceneFacts,
  ) {
    root.setAttribute('aria-live', facts.mode === 'story' ? 'polite' : 'off')
    if (
      facts.mode ===
      'story'
    ) {
      renderStory(
        facts,
      )
      root.dataset.mode = facts.mode

      return
    }

    renderNow(
      facts,
    )
    root.dataset.mode = facts.mode
  }

  root.addEventListener('click', event => {
    if ((event.target as Element).closest('.chapter-notice__button')) options.onOpenNotice()
  })
  const vesselButtons = new Map<InteractiveEntity, HTMLButtonElement>()
  const vesselList = document.createElement('ul')
  vesselList.className = 'reading-vessels'
  vesselList.setAttribute('aria-label', 'Vessel records in this view')

  function setVessels(entities: InteractiveEntity[]) {
    const host = root.querySelector('.chapter-records, .live-reading[data-reading="vessels"] .live-reading__body')
    if (!host) return
    if (vesselList.parentElement !== host) host.append(vesselList)
    for (const [entity, button] of vesselButtons) {
      if (!entities.includes(entity)) { button.parentElement?.remove(); vesselButtons.delete(entity) }
    }
    for (const entity of entities) {
      if (vesselButtons.has(entity)) continue
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = entity.ghostLines[0] ?? 'Vessel record'
      button.setAttribute('aria-label', `Inspect vessel record: ${button.textContent}`)
      button.addEventListener('click', () => options.onSelectVessel(entity))
      item.append(button)
      vesselList.append(item)
      vesselButtons.set(entity, button)
    }
    vesselList.hidden = entities.length === 0
  }

  return { render, setVessels }
}

function escapeHtml(
  value: string,
) {
  return value
    .replaceAll(
      '&',
      '&amp;',
    )
    .replaceAll(
      '<',
      '&lt;',
    )
    .replaceAll(
      '>',
      '&gt;',
    )
    .replaceAll(
      '"',
      '&quot;',
    )
}

function shortInstant(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'time unavailable'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)) + ' UTC'
}

export function storyReadingAt(fleet: StoryFleetFact, at: number) {
  const chapter = chapterAt(timelineEvents, (at - REPLAY_START) / (REPLAY_END - REPLAY_START))
  const onStep = Math.abs(at - (REPLAY_START + chapter.progress * (REPLAY_END - REPLAY_START))) < 1000
  return { text: onStep ? chapter.text : storyHourSentence(fleet),
    timeLabel: onStep ? chapter.timeLabel : speakInstant(new Date(at).toISOString()) }
}

function liveReading(id: string, title: string, value: string, meta: string, body: string) {
  return `<details class="live-reading" data-reading="${id}">
    <summary>
      <span class="live-reading__name">${escapeHtml(title)}</span>
      <span class="live-reading__value">${escapeHtml(value)}</span>
      <span class="live-reading__meta">${escapeHtml(meta)}</span>
    </summary>
    <div class="live-reading__body">${body}</div>
  </details>`
}

function renderRestriction(facts: NowSceneFacts) {
  const notice = facts.restriction
  const status = {
    active: notice.speedKnots === null ? 'Speed measure in effect' : `${notice.speedKnots}-knot measure in effect`,
    pending: 'Notice not yet in effect',
    unverified: 'Stored notice · current state unverified',
    'record-shows-none': 'Record shows no special restriction',
    unknown: 'Current state unknown',
  }[notice.status]
  const scope = notice.minimumLengthMetres === null ? 'Zone A' : `Zone A · vessels over ${notice.minimumLengthMetres} m`
  const stateMeta = notice.status === 'active'
    ? `${scope}${notice.exceptionsApply ? ' · exceptions apply' : ''}`
    : notice.status === 'pending' ? `Effective ${shortInstant(notice.effectiveAt)}` : 'Latest indexed Coast Guard notice'
  const meta = [stateMeta, notice.publishedAt ? `published ${shortInstant(notice.publishedAt)}` : '',
    notice.refreshUnavailable ? 'last known · refresh failed · current conditions unverified' : ''].filter(Boolean).join(' · ')
  return liveReading('notice', 'Speed notice', status, meta, `
    <p>${escapeHtml(restrictionSentence(notice))}</p>
    ${notice.status === 'unverified' && notice.speedKnots !== null ? `<p>Last known notice lists ${notice.speedKnots} knots · ${escapeHtml(scope)}. Current requirements unverified.</p>` : ''}
    ${notice.publishedAt ? `<p>Published ${escapeHtml(speakInstant(notice.publishedAt))}.</p>` : ''}
  `)
}

function renderAis(facts: NowSceneFacts) {
  const ais = facts.nowAis
  const connectionLabel = {
    connecting: 'AIS connecting', connected: 'AIS connected', disconnected: 'AIS disconnected',
    unconfigured: 'AIS not configured', unverified: 'AIS unverified', unavailable: 'AIS unavailable',
  }[ais.connection ?? 'unavailable']
  // A connected socket with no verified positions must remain unknown.
  const known = ais.state === 'fresh' && ais.vesselCount !== null
  const count = ais.vesselCount
  const value = known ? `${count} vessel${count === 1 ? '' : 's'} reporting` : 'Coverage unknown'
  const meta = `${connectionLabel} · ${ais.lastReceivedAt ? `last received ${shortInstant(ais.lastReceivedAt)}` : 'no verified recent positions'}`
  return liveReading('vessels', 'Vessels', value, meta, `
    <p>Latest received positions from the last 30 minutes, not continuous tracks.</p>
    ${!known ? '<p>No verified current positions. This does not mean an empty sea.</p>' : ''}
    ${ais.lastReceivedAt ? `<p>Last stored ${escapeHtml(speakInstant(ais.lastReceivedAt))}.</p>` : ''}
    <p>Collection may pause between visits.</p>
  `)
}

function renderReview(facts: NowSceneFacts) {
  const review = facts.whaleReview
  const value = !review || review.rightWhaleRows === null ? 'Detection count unavailable'
    : `${review.rightWhaleRows} detection${review.rightWhaleRows === 1 ? '' : 's'} in review`
  const freshness = review?.refreshUnavailable ? 'last known review · refresh unavailable' : review?.state === 'recent' ? 'latest review' : review?.state === 'stale' ? 'older review' : 'no review available'
  return liveReading('whales', 'Whale review', value,
    review?.reviewDate ? `${review.reviewDate} · ${freshness}` : freshness, `
      <p>Detections listed in a reviewed record, not a live listening feed. One whale may appear more than once.</p>
      <p>Review dates and detection times use the source's local clock. These records do not locate individual whales.</p>
    `)
}

function renderMarine(marine: MarineFact | null) {
  const missing = !marine || marine.state === 'missing'
  const value = missing ? 'Conditions unavailable'
    : `${formatMeasurement(marine.waveHeightMetres, 2)} m waves · ${formatMeasurement(marine.seaSurfaceTemperatureC, 1)}°C water`
  const freshness = marine?.refreshUnavailable ? 'Last known model · refresh failed · current conditions unverified ·' : marine?.state === 'stale' ? 'Older model' : 'Model'
  const meta = missing ? 'No current sea-condition record' : `${freshness} valid ${shortInstant(marine.validAt)}`
  const weather = marine?.weather
  const kind = weather && freshWeather(weather, Date.now()) ? weatherKind(weather.code) : null
  const heading = kind ? `Meteo · ${WEATHER_LABELS[kind]}` : weather ? 'Meteo · Last known weather; current conditions unverified' : 'Meteo · Weather unavailable'
  return liveReading('sea', heading, value, meta, `
    <p>Live weather effects follow the current Open-Meteo weather model; waves control water roughness. Effects are stylized.</p>
    ${weather ? `<p>${escapeHtml(describeWeather(weather).sentence)}</p><p>Weather model valid ${escapeHtml(speakInstant(weather.validAt))}${kind ? '' : ' · stale or unverified conditions'}.</p>` : ''}
    ${!missing ? `<p>Current speed ${formatMeasurement(marine.currentSpeedMs, 2)} m/s.</p>
      <p>Forecast valid ${escapeHtml(speakInstant(marine.validAt))}.</p>
      <p>Fetched ${escapeHtml(speakInstant(marine.fetchedAt))}.</p>` : ''}
    <p>Estimated conditions from a model, not measurements taken at sea.</p>
  `)
}

function formatMeasurement(value: number | null, digits: number) {
  return value === null || !Number.isFinite(value) ? 'unknown' : value.toFixed(digits)
}
