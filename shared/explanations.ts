export type ExplanationTopic = 'limits' | 'project' | 'sources' | 'vessel_hours' | 'detection' | 'all';

const LIMITS_TEXT = 'These records do not show why a vessel changed speed, whether a ship complied with the notice, an exact speed, where a whale was, or that whales were absent.';
const PROJECT_TEXT = 'Shared Waters is a public picture of Dynamic Shipping Zone A in the Gulf of St. Lawrence. It asks what can be observed about vessel presence and a protection response. It is not a navigation, compliance, or enforcement tool, and the September scene is stored evidence rather than a live view of the water.';
const SOURCES_TEXT = 'Global Fishing Watch rows are vessel-hours in speed categories, not tracks. A Coast Guard notice is a statement for vessels over 13 m, not a legal finding, and a missing notice does not mean the water is unrestricted. WHOI coordinates locate the glider at a source-local time, not a whale, and no indexed row does not prove absence. AIS coverage can be unknown rather than zero ships. Marine values are a weather model at a grid point, not measurements from the water. Distance, weather, and the stretched map in the picture are composed, not instrument readings.';
const VESSEL_HOURS_TEXT = 'A vessel-hour is one hour of vessel presence represented by Global Fishing Watch in a speed category. It is a time-binned presence record, not a continuous track, a unique-vessel count, or an exact speed. In this story, the categories describe reported speed ranges. They do not establish compliance with a notice.';

export function explanationTopic(value: unknown): ExplanationTopic {
  return value === 'limits' || value === 'project' || value === 'sources' || value === 'vessel_hours' || value === 'detection' || value === 'all' ? value : 'all';
}

export function explanationSentence(topic: ExplanationTopic): string {
  if (topic === 'limits') return LIMITS_TEXT;
  if (topic === 'project') return `${PROJECT_TEXT} ${LIMITS_TEXT}`;
  if (topic === 'sources') return SOURCES_TEXT;
  if (topic === 'vessel_hours') return VESSEL_HOURS_TEXT;
  if (topic === 'detection') return 'A WHOI acoustic detection is an analyst-reviewed record of a classified call at a source-local time. The recorded coordinates locate the observing glider, not a whale. A detection does not establish the number or precise positions of whales, and no indexed detection does not prove absence. The unresolved UTC offset prevents exact alignment with the Story clock.';
  return `${PROJECT_TEXT} ${LIMITS_TEXT} ${SOURCES_TEXT}`;
}

function explanationOnly(question: string): boolean {
  const aboutMeaning = /\b(not tell|cannot tell|can't tell|do not tell|doesn't tell|does not tell|what is this|what is shared waters?|about this project|behind this|why (?:this|the scene|the picture|the project))\b/i.test(question);
  const asksForReading = /\b(restrict|notice|detect|speed|vessel|ships?|ais|wave|temperature|current|marine|september|compare|presence|fresh(?:ness)?|latest)\b/i.test(question);
  return aboutMeaning && !asksForReading;
}

export function localExplanationTopic(question: string): ExplanationTopic | null {
  if (/\bwhat (?:are|is) (?:(?:a|the) )?(?:(?:global fishing watch|gfw) )?vessel[- ]hours?\b/i.test(question)) return 'vessel_hours';
  if (/\b(what (?:does|do) .*(?:detection|detections).*(?:mean|tell)|what is (?:an? )?(?:whale |acoustic )?detection)\b/i.test(question) && !/\b(latest|when|where|today|now|current|compare|September|Sep)\b|\d/i.test(question)) return 'detection';
  return explanationOnly(question) ? 'all' : null;
}
