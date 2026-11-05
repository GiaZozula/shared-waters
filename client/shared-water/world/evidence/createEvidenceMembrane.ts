import { sourceLinkUrl } from '../../../source-link'
import type { AnswerBasis } from '../question/askScene'
import { createPanel } from '../ui/createPanel'
import { createPanelOrnament } from '../ui/createPanelOrnament'

import type {
  EvidenceRecord,
} from './evidenceFixtures'

const BACKGROUND_SOURCES = [
  { label: 'Fisheries and Oceans Canada: North Atlantic Right Whale population and conservation', url: 'https://www.dfo-mpo.gc.ca/species-especes/mammals-mammiferes/whales-baleines/narw-bnan/index-eng.html', topics: ['population', 'how many', '384', 'abundance', 'how many whales'] },
  { label: 'Fisheries and Oceans Canada: North Atlantic Right Whale science and detection methods', url: 'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/narw-science-eng.html', topics: ['whale', 'glider', 'acoustic', 'detection method', 'how detected', 'science'] },
  { label: 'Fisheries and Oceans Canada: 2026 traffic management measures', url: 'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/2026/0422-tc-eng.html', topics: ['knot', 'speed', 'zone', 'restriction', 'measure', 'traffic', 'static', 'dynamic', 'seasonal', 'government', 'canada', 'notice', 'changed', 'september'] },
  { label: 'Transport Canada: protecting right whales from vessel collisions in the Gulf', url: 'https://tc.canada.ca/en/marine-transportation/navigation-marine-conditions/protecting-north-atlantic-right-whales-collisions-vessels-gulf-st-lawrence', topics: ['whale', 'vessel', 'ship', 'boat', 'collision', 'knot', 'speed', 'zone', 'restriction', 'gulf'] },
  { label: 'Global Fishing Watch: key concepts', url: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts', topics: ['gfw', 'fishing watch', 'vessel-hour', 'vessel hour', 'presence', 'speed category', 'ais', 'fishing'] },
  { label: 'NOAA Fisheries: North Atlantic Right Whale', url: 'https://www.fisheries.noaa.gov/species/north-atlantic-right-whale', topics: ['whale', 'right whale', 'species', 'biology', 'threat'] },
  { label: 'Smithsonian Ocean: North Atlantic Right Whale', url: 'https://ocean.si.edu/ocean-life/marine-mammals/north-atlantic-right-whale', topics: ['whale', 'right whale', 'species', 'biology', 'threat'] },
  { label: 'Wikipedia: Gulf of St. Lawrence', url: 'https://en.wikipedia.org/wiki/Gulf_of_St._Lawrence', topics: ['gulf', 'st. lawrence', 'st lawrence', 'geography', 'where'] },
]

const DEFAULT_BACKGROUND_SOURCE_URLS = [
  'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/2026/0422-tc-eng.html',
  'https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts',
  'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/narw-science-eng.html',
  'https://tc.canada.ca/en/marine-transportation/navigation-marine-conditions/protecting-north-atlantic-right-whales-collisions-vessels-gulf-st-lawrence',
] as const

const DEFAULT_BACKGROUND_SOURCES = DEFAULT_BACKGROUND_SOURCE_URLS
  .map(url => BACKGROUND_SOURCES.find(source => source.url === url))
  .filter((source): source is (typeof BACKGROUND_SOURCES)[number] => source != null)

function backgroundSources(question: string) {
  const normalized = question.toLowerCase()
  const related = BACKGROUND_SOURCES.filter(source => source.topics.some(topic => normalized.includes(topic)))
  return related.length ? related : DEFAULT_BACKGROUND_SOURCES
}

export function createEvidenceMembrane(
  initialEvidence:
    EvidenceRecord[],
) {
  const trigger =
    document.createElement(
      'button',
    )

  trigger.type = 'button'

  trigger.className =
    'evidence-trigger'

  trigger.setAttribute(
    'aria-label',
    'Open evidence',
  )

  trigger.innerHTML = '<span class="panel-symbol panel-symbol--evidence" aria-hidden="true">⚲</span>'

  const membrane =
    document.createElement(
      'aside',
    )

  membrane.className =
    'evidence-membrane'

  membrane.setAttribute(
    'aria-hidden',
    'true',
  )

  const header =
    document.createElement(
      'div',
    )

  header.className =
    'evidence-header'

  const title =
    document.createElement(
      'h2',
    )

  title.className =
    'evidence-title'

  title.textContent =
    'Evidence'

  const close =
    document.createElement(
      'button',
    )

  close.type = 'button'

  close.className =
    'evidence-close'

  close.setAttribute(
    'aria-label',
    'Close evidence',
  )

  close.textContent = '×'

  header.append(
    title,
    close,
    createPanelOrnament(),
  )

  const content =
    document.createElement(
      'div',
    )

  content.className =
    'evidence-content'

  const description = document.createElement('p')
  description.className = 'evidence-intro'
  description.textContent = 'No records are selected yet. In Story, this panel follows the selected hour. Ask a question to see its answer and any cited records here.'

  membrane.append(header, description, content)

  document.body.append(
    trigger,
    membrane,
  )

  const panel = createPanel({
    element: membrane, trigger, closeButton: close, title, id: 'evidence-panel',
  })
  const setOpen = panel.setOpen
  let archive: { evidence: EvidenceRecord[]; answer: string } | null = null
  let showingQuestion = false
  const archiveButton = document.createElement('button')
  archiveButton.type = 'button'
  archiveButton.className = 'evidence-archive-button'
  archiveButton.textContent = 'See evidence for the Story'
  archiveButton.hidden = true
  archiveButton.addEventListener('click', () => {
    if (!archive) return
    showingQuestion = false
    records = archive.evidence
    answer = archive.answer
    notice = ''
    warnings = []
    question = ''
    render()
    // The clicked button is now hidden; place focus on a stable panel control.
    close.focus({ preventScroll: true })
  })
  let records =
    initialEvidence
  let warnings:
    string[] =
    []
  let notice =
    ''
  let answer =
    ''
  let question = ''
  let answerBasis: AnswerBasis | undefined

  function appendClock(
    parent: HTMLElement,
    label: string,
    value: string,
  ) {
    const occurrence =
      document.createElement(
        'div',
      )

    occurrence.className =
      'evidence-clock'

    const caption =
      document.createElement(
        'span',
      )

    caption.textContent =
      label

    occurrence.append(
      caption,
      document.createTextNode(
        value,
      ),
    )

    parent.appendChild(
      occurrence,
    )
  }

  function render() {
    const scrollTop = content.scrollTop
    const focused = content.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    const focusedRecord = focused?.closest<HTMLElement>('.evidence-record')?.dataset.evidenceId
    const expanded = new Set(Array.from(content.querySelectorAll<HTMLDetailsElement>('.evidence-record[open]'))
      .map(record => record.dataset.evidenceId))
    archiveButton.hidden = !archive || !showingQuestion
    description.textContent = showingQuestion
      ? notice ? 'The question could not be completed. The reason is shown below.'
        : answerBasis === 'explanation' ? 'Preset answer written for this project. It works without the online question service.'
        : answerBasis === 'displayed-live' ? 'Preset answer using the readings currently shown in Live. No LLM was used and the sources have not been refreshed.'
        : answerBasis === 'story' ? 'Preset answer from the saved Story records. It works without the online question service.'
        : records.length ? 'Read the answer alongside its source records. Open a record for its source and times.'
        : 'No source records were cited for this answer.'
      : archive
        ? 'The Story archive includes its notices and whale reviews, plus ship records for the selected hour. Open one to follow its source, times and limitations.'
        : 'No records are selected yet. In Story, this panel follows the selected hour. Ask a question to see its answer and any cited records here.'
    const presetNote = showingQuestion && !notice && answerBasis ? description.textContent : null
    description.hidden = Boolean(presetNote)
    content.replaceChildren()

    if (answer) {
      const answerBlock = document.createElement('section')
      answerBlock.className = 'evidence-answer-block'
      const heading = document.createElement('h2')
      heading.className = 'evidence-section-title'
      heading.textContent = showingQuestion ? 'Answer' : 'At this moment'
      answerBlock.appendChild(heading)
      // Preserve source timestamps and abbreviations without sentence parsing.
      const sentences = answer.split(/\n+/)
      for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
        const paragraph = document.createElement('p')
        paragraph.className = 'evidence-answer'
        const parts = sentence.split(/(vessel-hours?)/gi)
        for (const part of parts) {
          if (/^vessel-hours?$/i.test(part)) {
            const link = document.createElement('a')
            link.className = 'evidence-term-link'
            link.href = 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts'
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
            link.setAttribute('aria-label', 'Learn how Global Fishing Watch defines vessel-hours')
            link.append(document.createTextNode(part), document.createTextNode(' ↗'))
            paragraph.appendChild(link)
          } else paragraph.appendChild(document.createTextNode(part))
        }
        answerBlock.appendChild(paragraph)
      }
      if (presetNote) {
        const note = document.createElement('p')
        note.className = 'evidence-limitation evidence-preset-note'
        note.textContent = presetNote
        answerBlock.appendChild(note)
      }
      content.appendChild(answerBlock)
    }

    const relatedSources = backgroundSources(question)
    if (relatedSources.length) {
      const learnMore = document.createElement('details')
      learnMore.className = 'evidence-learn-more'
      const summary = document.createElement('summary')
      const heading = document.createElement('span')
      heading.className = 'disclosure-label'
      heading.textContent = 'Read further'
      summary.append(heading)
      const note = document.createElement('p')
      note.className = 'evidence-learn-more-note'
      note.textContent = 'Curated background reading. These pages explain the background. They are separate from the records cited by the answer.'
      const list = document.createElement('ul')
      for (const item of relatedSources) {
        const row = document.createElement('li')
        const link = document.createElement('a')
        link.href = item.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = `${item.label.replaceAll(":", "")} ↗`
        row.appendChild(link)
        list.appendChild(row)
      }
      learnMore.append(summary, note, list)
      content.appendChild(learnMore)
    }

    if (notice) {
      const alert =
        document.createElement(
          'p',
        )

      alert.className =
        'evidence-notice'

      alert.setAttribute(
        'role',
        'alert',
      )

      alert.textContent =
        notice

      content.appendChild(
        alert,
      )
    }

    for (
      const warning
      of warnings
    ) {
      const limitation =
        document.createElement(
          'p',
        )

      limitation.className =
        'evidence-limitation'

      limitation.textContent =
        warning

      content.appendChild(
        limitation,
      )
    }

    if (records.length) {
      const recordsHeading = document.createElement('h2')
      recordsHeading.className = 'evidence-section-title evidence-records-heading'
      recordsHeading.textContent = `Source records (${records.length})`
      content.appendChild(recordsHeading)
    }

    for (const record of records) {
      const section =
        document.createElement('details')

      section.className =
        'evidence-record'
      section.dataset.evidenceId = record.id
      section.open = expanded.has(record.id)

      const summary = document.createElement('summary')
      summary.className = 'evidence-record-summary'

      const url = sourceLinkUrl(record.sourceUrl)
      const source =
        document.createElement(
          url
            ? 'a'
            : 'div',
        )

      source.className =
        'evidence-source disclosure-label'

      source.textContent =
        record.source + (url ? ' ↗' : '')

      if (
        source instanceof
        HTMLAnchorElement
      ) {
        source.href = url!

        source.target =
          '_blank'

        source.rel =
          'noopener noreferrer'
      }

      summary.appendChild(source)
      section.appendChild(summary)

      if (
        record.observation
      ) {
        const observation =
          document.createElement(
            'div',
          )

        observation.className =
          'evidence-observation'

        observation.textContent =
          record.observation

        section.appendChild(
          observation,
        )
      }

      const id =
        document.createElement(
          'div',
        )

      id.className =
        'evidence-id'

      id.textContent =
        record.id

      const times:
        [
          string,
          string | undefined,
        ][] = [
        [
          'event',
          record.eventAt,
        ],
        [
          'source-local',
          record.sourceLocalTime,
        ],
        [
          'effective',
          record.effectiveAt,
        ],
        [
          'observed',
          record.observedAt,
        ],
        [
          'received',
          record.receivedAt,
        ],
      ]

      for (
        const [
          label,
          value,
        ] of times
      ) {
        if (!value) {
          continue
        }

        appendClock(
          section,
          label,
          value,
        )
      }

      if (record.fetchedAt) {
        appendClock(
          section,
          'fetched / ingested',
          record.fetchedAt,
        )
      }

      if (record.method) {
        const method =
          document.createElement(
            'p',
          )

        method.className =
          'evidence-method'

        method.textContent =
          record.method

        section.appendChild(
          method,
        )
      }

      if (
        record.attribution
      ) {
        const attribution =
          document.createElement(
            'p',
          )

        attribution.className =
          'evidence-attribution'

        attribution.textContent =
          record.attribution

        section.appendChild(
          attribution,
        )
      }

      section.appendChild(id)

      if (
        record.limitation
      ) {
        const limitation =
          document.createElement(
            'p',
          )

        limitation.className =
          'evidence-limitation'

        limitation.textContent =
          record.limitation

        section.appendChild(
          limitation,
        )
      }

      content.appendChild(
        section,
      )
    }
    content.appendChild(archiveButton)
    if (focused) {
      const retainedRecord = Array.from(content.querySelectorAll<HTMLElement>('.evidence-record'))
        .find(record => record.dataset.evidenceId === focusedRecord)
      const replacement = retainedRecord?.querySelector<HTMLElement>(focused.tagName === 'A' ? 'a' : 'summary')
      const nextFocus = replacement ?? close
      nextFocus.focus({ preventScroll: true })
    }
    content.scrollTop = scrollTop
  }

  render()

  return {
    setArchive(next: { evidence: EvidenceRecord[]; answer: string } | null) {
      const sameRecords = archive && next && archive.answer === next.answer &&
        archive.evidence.map(record => record.id).join('\n') === next.evidence.map(record => record.id).join('\n')
      archive = next
      if (!showingQuestion && next && !sameRecords) {
        records = next.evidence
        answer = next.answer
        notice = ''
        warnings = []
        question = ''
        render()
      } else {
        archiveButton.hidden = !archive || !showingQuestion
      }
    },

    openArchive() {
      if (!archive) return
      showingQuestion = false
      records = archive.evidence
      answer = archive.answer
      notice = ''
      warnings = []
      question = ''
      render()
      setOpen(true)
    },

    open() {
      setOpen(true)
    },

    close() {
      setOpen(false)
    },

    setEvidence(
      next:
        EvidenceRecord[],
    ) {
      records = next
      render()
    },

    show(
      next: {
        evidence:
          EvidenceRecord[]

        warnings?:
          string[]

        notice?:
          string | null

        answer?:
          string | null

        answerBasis?: AnswerBasis

        question?:
          string

        autoOpen?:
          boolean
      },
    ) {
      showingQuestion = Boolean(next.question || next.notice || next.answer || next.evidence.length || next.warnings?.length)
      records =
        next.evidence
      warnings =
        next.warnings ??
        []
      notice =
        next.notice ??
        ''
      answer =
        next.answer ??
        ''
      question = next.question ?? ''
      answerBasis = next.answerBasis
      render()

      if (
        next.autoOpen !== false && (
          records.length > 0 ||
          warnings.length > 0 ||
          Boolean(notice) ||
          Boolean(answer)
        )
      ) {
        setOpen(true)
      }
    },
  }
}
