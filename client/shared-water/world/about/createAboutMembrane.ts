import { createPanel } from '../ui/createPanel'
import { createPanelOrnament } from '../ui/createPanelOrnament'

const GFW_URL =
  'https://globalfishingwatch.org/'

const GFW_TERMS_URL =
  'https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits'

const COAST_GUARD_URL =
  'https://nis.ccg-gcc.gc.ca/public/rest/menu/en/topics'

const WHOI_URL =
  'https://dcs.whoi.edu/dal2606/dal2606_sable.shtml'

const AISSTREAM_URL =
  'https://aisstream.io/'

const DFO_SCIENCE_URL = 'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/narw-science-eng.html'
const DFO_MEASURES_URL = 'https://www.dfo-mpo.gc.ca/fisheries-peches/commercial-commerciale/atl-arc/narw-bnan/2026/0422-tc-eng.html'
const TRANSPORT_CANADA_URL = 'https://tc.canada.ca/en/marine-transportation/navigation-marine-conditions/protecting-north-atlantic-right-whales-collisions-vessels-gulf-st-lawrence'
const GFW_CONCEPTS_URL = 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts'
const DFO_WHALE_URL = 'https://www.dfo-mpo.gc.ca/species-especes/mammals-mammiferes/whales-baleines/narw-bnan/index-eng.html'
const GULF_URL = 'https://en.wikipedia.org/wiki/Gulf_of_St._Lawrence'
const MARINE_URL = 'https://open-meteo.com/en/docs/marine-weather-api'

function externalLink(
  label: string,
  url: string,
) {
  const link =
    document.createElement(
      'a',
    )

  link.href = url
  link.textContent = `${label} ↗`
  link.target = '_blank'
  link.rel =
    'noopener noreferrer'

  return link
}

function sourceIcon(label: string, url: string) {
  const link = externalLink('', url)
  link.className = 'about-source-icon'
  link.setAttribute('aria-label', `Source ${label} (opens in a new tab)`)
  return link
}

function copy(
  ...parts: Array<
    string | Node
  >
) {
  const paragraph =
    document.createElement(
      'p',
    )

  paragraph.className =
    'about-copy'

  paragraph.append(
    ...parts,
  )

  return paragraph
}

export function createAboutMembrane() {
  const trigger =
    document.createElement(
      'button',
    )

  trigger.type = 'button'

  trigger.className =
    'evidence-trigger about-trigger'

  trigger.setAttribute(
    'aria-label',
    'Open about',
  )

  trigger.innerHTML = '<span class="panel-symbol" aria-hidden="true">ℹ︎</span>'

  const membrane =
    document.createElement(
      'aside',
    )

  membrane.className =
    'about-membrane'

  membrane.setAttribute(
    'aria-hidden',
    'true',
  )

  const header =
    document.createElement(
      'div',
    )

  header.className =
    'about-header'

  const title =
    document.createElement(
      'h2',
    )

  title.className =
    'about-title'

  title.textContent =
    'About'

  const close =
    document.createElement(
      'button',
    )

  close.type = 'button'

  close.className =
    'about-close'

  close.setAttribute(
    'aria-label',
    'Close about',
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
    'about-content'

  function section(label: string, ...paragraphs: HTMLElement[]) {
    const details = document.createElement('details')
    details.className = 'about-section'
    const summary = document.createElement('summary')
    const heading = document.createElement('span')
    heading.className = 'disclosure-label'
    heading.textContent = label
    summary.append(heading)
    details.append(summary, ...paragraphs)
    return details
  }

  const controls = document.createElement('dl')
  controls.className = 'about-controls'
  for (const [label, description] of [
    ['▶ Play and pause', 'Watch Story move through time, or pause to explore a moment.'],
    ['Timeline', 'Drag along the curve to choose a time. Point at a ⏺ node to preview its time, or select it to jump there.'],
    ['← → Chapters', 'Move to the previous or next chapter.'],
    ['.ᐟ Ships', 'Select a glowing ship to see its available name, type and recorded time.'],
    ['[!] Whale sounds', 'A reviewed whale sound was recorded at the listening glider.'],
    ['𖣐 Ask a question', 'Open the blob to ask about the project or the records. Try one of the suggested questions.'],
    ['⚲ Evidence', 'Open the panel to read source records for the selected Story hour or your answer.'],
  ]) {
    const entry = document.createElement('div')
    const term = document.createElement('dt')
    const descriptionText = document.createElement('dd')
    term.textContent = label
    descriptionText.textContent = description
    entry.append(term, descriptionText)
    controls.append(entry)
  }

  const architectureLink = document.createElement('a')
  architectureLink.href = '/system#architecture'
  architectureLink.textContent = 'System page'
  architectureLink.addEventListener('click', () => close.click())

  const lead = copy('The Gulf of St. Lawrence is both a passage for ships and a habitat for North Atlantic Right Whales. Shared Waters offers a closer look at the activity and protections in one small part of those waters.')
  lead.classList.add('panel-lead')
  content.append(
    lead,
    copy('Story follows 13 to 19 September 2026. Live shows the latest available readings.'),
    section('Controls', controls),
    section('Concept',
      copy('I wanted to explore the relationships between human and animal systems. I chose the endangered North Atlantic Right Whale in the hope of sparking curiosity about the animals and the industrial and legal systems around them.'),
      copy('Looking through shipping and whale records, I noticed slower vessel activity around a whale detection and began learning about Canada’s protection measures. That observation inspired this project.'),
    ),
    section('How it was Built',
      copy('Shared Waters began as a 72-hour technical exercise. I’ve continued developing it to practice system design through hands-on work. You can explore the architecture and the decisions behind it on the ', architectureLink, '.'),
    ),
    section('Vessel Marks',
      copy('Story uses ', externalLink('Global Fishing Watch', GFW_URL), ' to show vessel activity by hour and speed category. Select a mark to explore the available ship details.'),
      copy('Live uses ', externalLink('AISStream', AISSTREAM_URL), ' for recently received ship reports. It can be connected even when no recent positions have arrived.'),
    ),
    section('Whales in Zone A',
      copy('The acoustic records come from ', externalLink('WHOI / Robots4Whales', WHOI_URL), '. The marks locate the glider platform, not individual whales.'),
      copy('Listening gliders help monitor right whales in Zone A, a dynamic shipping zone in the Laurentian Channel. Detections support Canada’s wider effort to protect whales from vessel collisions. Learn about ', externalLink('Transport Canada’s monitoring and protection measures', TRANSPORT_CANADA_URL), '.'),
      copy('Right whales move between feeding and calving areas along the Atlantic coast. Learn about their migration and the threats they face from ', externalLink('NOAA Fisheries', 'https://www.fisheries.noaa.gov/species/north-atlantic-right-whale'), '.'),
    ),
    section('Protection Notices',
      copy('Story includes a ', externalLink('Canadian Coast Guard notice', COAST_GUARD_URL), ' that introduces a 10-knot limit for vessels over 13 metres. Its publication and start time are shown separately.'),
      copy('In dynamic shipping zones, whale detections can lead to temporary speed restrictions. Read how ', externalLink('Transport Canada’s protection measures work', TRANSPORT_CANADA_URL), '.'),
    ),
    section('Water, Weather, Motion',
      copy('With reduced motion enabled in your device or browser, ambient movement pauses and chapter changes are immediate. You can still choose a time or start and pause Story playback.'),
      copy('The water, weather and light create the atmosphere of the scene. Story includes a sunset pause and a scripted overnight storm. Story weather is illustrative, not a reconstruction of historical conditions. The spiral highlights a reviewed whale sound. Its repeating pulse is an animation of that record.'),
      copy('Live sea conditions come from the ', externalLink('Open-Meteo marine model', MARINE_URL), ', which estimates waves and water temperature. Live clouds, rain and storm effects follow a separate current Open-Meteo weather model, using broad visual presets rather than a full simulation.'),
    ),
    section('Read Further',
      copy('Follow these sources to learn more about the whales, the waters and the records used here.'),
      copy('Whales and Conservation'),
      copy(externalLink('Right whale population and conservation', DFO_WHALE_URL)),
      copy(externalLink('Whale science and acoustic detection', DFO_SCIENCE_URL)),
      copy(externalLink('NOAA right whale biology and migration', 'https://www.fisheries.noaa.gov/species/north-atlantic-right-whale')),
      copy(externalLink('Smithsonian Ocean right whale overview', 'https://ocean.si.edu/ocean-life/marine-mammals/north-atlantic-right-whale')),
      copy('Protection and Place'),
      copy(externalLink('2026 traffic management measures', DFO_MEASURES_URL)),
      copy(externalLink('Protecting whales from vessel collisions', TRANSPORT_CANADA_URL)),
      copy(externalLink('Coast Guard navigational warnings', COAST_GUARD_URL)),
      copy(externalLink('Gulf of St. Lawrence geography', GULF_URL)),
      copy('Data Sources'),
      copy(externalLink('WHOI glider records', WHOI_URL)),
      copy(externalLink('Global Fishing Watch', GFW_URL)),
      copy(externalLink('Global Fishing Watch data concepts', GFW_CONCEPTS_URL)),
      copy(externalLink('Global Fishing Watch API terms', GFW_TERMS_URL)),
      copy(externalLink('AISStream', AISSTREAM_URL)),
      copy(externalLink('Open-Meteo marine model', MARINE_URL)),
    ),
    section('Compliance and Record Limitations',
      copy('This is an exploration of public records, not a navigation or enforcement tool. A notice has exceptions. Missing or unverified information does not mean the water is unrestricted.'),
      copy('A vessel-hour is a speed category for one hour, not an exact speed or a continuous journey. Categories up to 10 knots and starting at 10 knots share a boundary. They cannot establish compliance or prove why a vessel slowed.'),
      copy('A reviewed sound does not reveal a whale’s route or count individual whales. Several rows may concern the same animal. Detection times keep the source’s local clock. Its UTC offset is unresolved, so their position on the Story timeline is approximate.'),
      copy('Each source has its own clock. A recent fetch is not a recent observation. Missing vessel marks or reports mean unknown coverage, not an empty sea.'),
      copy('The map is stretched for readability. Distance, hull size, wakes, clouds, rain and haze are composed rather than measured. Marine model values are estimates. Repeating effects do not represent new detections or notices.'),
      copy('Global Fishing Watch data is used non-commercially with attribution under its ', externalLink('API terms', GFW_TERMS_URL), '.'),
    ),
    copy('You can find me at ', externalLink('dev.giazozula.com', 'https://dev.giazozula.com/'), ' and ', externalLink('giazozula.com', 'https://www.giazozula.com/'), '.'),
  )

  membrane.append(
    header,
    content,
  )

  document.body.append(
    trigger,
    membrane,
  )

  return createPanel({
    element: membrane, trigger, closeButton: close, title, id: 'about-panel',
  })
}
