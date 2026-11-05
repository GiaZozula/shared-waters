import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptStoryReplay } from './adapt-story-replay.js';
import { WAKE_LENGTH, vesselHeadingYaw, wakeCourse } from './shared-water/world/vessels/createVesselWakes.js';
import { storyClickText } from './shared-water/world/vessels/createVesselField.js';
import { storyHourSentence } from './shared-water/world/facts/createFactRail.js';
import { frameAt, minuteForInstant, type ReplayData } from './replay-model.js';
import { buildSceneState } from './shared-water/world/data/buildSceneState.js';
import type { StoryFleetFact } from './shared-water/world/facts/types.js';

const data: ReplayData = {
  zoneId: 'zone_a',
  start: '2026-09-13T00:00:00Z',
  end: '2026-09-20T00:00:00Z',
  status: 'ready',
  note: '',
  presence: [
    { id: 'gfw:a-14', eventAt: '2026-09-15T14:00:00Z', latitude: 49.21, longitude: -64.21,
      vesselId: 'vessel-a', speedBandGroup: 'bands_below_or_up_to_10', sourceUrl: 'https://example.com/a14',
      shipName: 'ATLANTIC  SENTINEL', vesselType: 'CARGO' },
    { id: 'gfw:c-15', eventAt: '2026-09-15T15:00:00Z', latitude: 49.22, longitude: -64.22,
      vesselId: 'vessel-c', speedBandGroup: 'bands_from_10_up', sourceUrl: 'https://example.com/c15',
      shipName: 'CAP GRACE', vesselType: 'PASSENGER' },
    { id: 'gfw:anon-earlier', eventAt: '2026-09-15T13:00:00Z', latitude: 49.23, longitude: -64.23,
      vesselId: null, speedBandGroup: 'bands_below_or_up_to_10', sourceUrl: 'https://example.com/anon-earlier',
      shipName: 'CIC OSLO', vesselType: 'INSUFFICIENT_DATA' },
    { id: 'gfw:a-16', eventAt: '2026-09-15T16:00:00Z', latitude: 49.3, longitude: -64.4,
      vesselId: 'vessel-a', speedBandGroup: 'bands_from_10_up', sourceUrl: 'https://example.com/a16',
      shipName: '  MSC   WEST V ', vesselType: 'CARGO' },
    { id: 'gfw:b-16', eventAt: '2026-09-15T16:00:00Z', latitude: 49.31, longitude: -64.41,
      vesselId: 'vessel-b', speedBandGroup: 'bands_below_or_up_to_10', sourceUrl: 'https://example.com/b16',
      shipName: '   ', vesselType: 'INSUFFICIENT_DATA' },
    { id: 'gfw:anon-16', eventAt: '2026-09-15T16:00:00Z', latitude: 49.32, longitude: -64.42,
      vesselId: '', speedBandGroup: 'bands_below_or_up_to_10', sourceUrl: 'https://example.com/anon-16',
      shipName: null, vesselType: 'FISHING' },
  ],
  notices: [
    { id: 'n-none', sourceRecordId: 'none', publishedAt: '2026-09-14T00:00:00Z',
      effectiveAt: '2026-09-14T00:00:00Z', zoneAState: 'no_restriction_stated',
      appliesTo: 'vessels_over_13_m', cancels: null, sourceUrl: 'https://example.com/none' },
    { id: 'n-ten-earlier-pub', sourceRecordId: 'earlier', publishedAt: '2026-09-15T11:00:00Z',
      effectiveAt: '2026-09-15T12:30:00Z', zoneAState: 'no_restriction_stated',
      appliesTo: 'vessels_over_13_m', cancels: null, sourceUrl: 'https://example.com/earlier' },
    { id: 'n-ten-later', sourceRecordId: 'later', publishedAt: '2026-09-15T11:30:00Z',
      effectiveAt: '2026-09-15T12:30:00Z', zoneAState: 'restricted_10_knots',
      appliesTo: 'vessels_over_13_m', cancels: 'NW-C-3957-26', sourceUrl: 'https://example.com/later' },
  ],
  detections: [
    { id: 'whoi:one', reviewDate: '2026-09-14', sourceLocalTime: '2026-09-14 15:23:53',
      occurrence: 'detected', platformLatitude: 49.358, platformLongitude: -64.687, sourceUrl: 'https://example.com/whoi' },
    { id: 'whoi:two', reviewDate: '2026-09-14', sourceLocalTime: '15:38:53',
      occurrence: 'possibly_detected', platformLatitude: 49.359, platformLongitude: -64.688, sourceUrl: 'https://example.com/whoi-2' },
  ],
};

const atSixteen = Date.parse('2026-09-15T16:40:00Z');

test('story replay uses the selected hour, the previous hour for a wake, and frameAt notice', () => {
  const scene = adaptStoryReplay(data, atSixteen);
  const frame = frameAt(data, minuteForInstant('2026-09-15T16:40:00Z'));

  assert.deepEqual(scene.input.vessels.map((vessel) => vessel.id), ['gfw:a-16', 'gfw:b-16', 'gfw:anon-16']);
  assert.deepEqual(scene.input.vessels.map((vessel) => vessel.speedCategory), ['10-plus', 'through-10', 'through-10']);
  assert.equal(scene.input.vessels[0].speedBandLabel, 'categories from 10 kn upward');
  assert.equal(scene.input.vessels[1].speedBandLabel, 'categories through 10 kn');
  assert.deepEqual(scene.input.vessels[0].position, { lat: 49.3, lon: -64.4 });
  assert.equal('headingDegrees' in scene.input.vessels[0], false);
  assert.deepEqual(scene.wakes, [{
    id: 'gfw:a-16',
    from: { lat: 49.3, lon: -64.4 },
    toward: { lat: 49.21, lon: -64.21 },
  }]);
  assert.equal(scene.input.marine, null);
  assert.equal(scene.input.fleetCoverage, 'ready');
  assert.equal(frame.notice?.id, 'n-ten-later');
  assert.equal(scene.input.restriction.status, 'active');
  assert.equal(scene.input.restriction.effectiveAt, frame.notice?.effectiveAt);
  assert.equal(scene.input.restriction.publishedAt, frame.notice?.publishedAt);
  assert.equal(scene.input.restriction.speedKnots, 10);
  assert.equal(scene.input.restriction.minimumLengthMetres, 13);
  assert.equal(scene.input.restriction.exceptionsApply, false);
  assert.equal(scene.input.restriction.cancellationReference, 'NW-C-3957-26');
  assert.deepEqual(scene.mismatches, []);

  const state = buildSceneState(scene.input);
  assert.equal(state.mode, 'story');
  if (state.mode !== 'story') return;
  assert.equal(state.fleet.state, 'available');
  assert.equal(state.fleet.note, null);
  assert.equal(state.fleet.throughTenKnots, 2);
  assert.equal(state.fleet.tenAndAbove, 1);
  assert.equal(state.vessels[0].headingDegrees, null);
  assert.equal(state.vessels[0].speedKnots, null);
  assert.equal(state.vessels[0].name, 'MSC WEST V');
  assert.equal(state.vessels[0].vesselType, 'CARGO');
  assert.equal(state.vessels[1].name, null);
  assert.equal(state.vessels[1].vesselType, 'INSUFFICIENT_DATA');
  assert.equal(state.vessels[2].name, null);
  assert.equal(state.vessels[2].vesselType, 'FISHING');
  assert.equal(scene.input.vessels[0].name, 'MSC WEST V');
  assert.equal(state.fleet.coverage, 'ready');
  assert.equal(state.marine, null);
  assert.deepEqual(state.detections.map((detection) => detection.sourceLocalTime), [
    '2026-09-14 15:23:53',
    '15:38:53',
  ]);
  assert.deepEqual(state.detections.map((detection) => detection.sourceLabel), ['detected', 'possibly detected']);
  assert.deepEqual(state.detections.map((detection) => [detection.worldX, detection.worldZ].every(Number.isFinite)), [true, true]);
});

test('a wake points toward the previous hour and stays within the short cap', () => {
  const aimed = wakeCourse('gfw:a-16', 0, 0, 10, 0);
  assert.ok(aimed.dirX > 0.99);
  assert.ok(Math.abs(aimed.dirZ) < 0.01);
  assert.equal(aimed.length, WAKE_LENGTH);
  assert.ok(Math.abs(aimed.bend) <= 0.92);

  const straightish = wakeCourse('gfw:test-58', 0, 0, 10, 0);
  const sweeping = wakeCourse('gfw:test-66', 0, 0, 10, 0);
  assert.ok(Math.abs(straightish.bend) < 0.12);
  assert.ok(Math.abs(sweeping.bend) > 0.5);
  assert.ok(Math.abs(straightish.bend) < Math.abs(sweeping.bend));

  const close = wakeCourse('gfw:near', 0, 0, 0.4, 0);
  assert.ok(Math.abs(close.length - 0.4) < 1e-9);

  const idle = wakeCourse('gfw:b-16', 0, 0, null, null);
  assert.ok(idle.length <= WAKE_LENGTH);
  assert.ok(idle.length >= 0.9);
  assert.ok(idle.dirZ > 0);
});

test('vessel heading faces away from the wake direction', () => {
  const towardPrevious = vesselHeadingYaw('gfw:a-16', 0, 0, 10, 0);
  assert.ok(Math.abs(towardPrevious - (-Math.PI / 2)) < 0.01);

  const decorative = vesselHeadingYaw('gfw:b-16', 0, 0, null, null);
  const course = wakeCourse('gfw:b-16', 0, 0, null, null);
  assert.ok(Math.abs(decorative - Math.atan2(-course.dirX, course.dirZ)) < 1e-9);
});

test('WHOI rows stay source-local and are not gated by the scrub instant', () => {
  const scene = adaptStoryReplay(data, Date.parse('2026-09-13T06:00:00Z'));
  assert.equal(scene.input.restriction.status, 'unknown');
  assert.equal(scene.input.fleetCoverage, 'empty-hour');
  assert.deepEqual(scene.input.vessels, []);
  assert.deepEqual(scene.wakes, []);
  assert.deepEqual(scene.input.detections.map((detection) => detection.sourceLocalTime), [
    '2026-09-14 15:23:53',
    '15:38:53',
  ]);
  assert.equal(scene.input.detections[0].limitation, 'These timestamps are source-local. Their UTC offset is unresolved, so they are shown as dated evidence and are not positioned at a precise UTC scrub instant. Coordinates locate the glider, not a whale.');
  assert.equal(scene.input.detections[1].limitation, scene.input.detections[0].limitation);
  const state = buildSceneState(scene.input);
  assert.equal(state.mode, 'story');
  if (state.mode === 'story') {
    assert.equal(state.fleet.state, 'unknown');
    assert.equal(state.fleet.note, 'an empty hour does not prove zero vessel traffic');
  }
});

test('a 10-knot notice stays active and does not read exceptions from raw text', () => {
  const stated = adaptStoryReplay({
    ...data,
    notices: data.notices.map((notice) => notice.id === 'n-ten-later'
      ? { ...notice, rawText: 'Exceptions apply to some government vessels.' }
      : notice),
  }, atSixteen);
  assert.equal(stated.input.restriction.status, 'active');
  assert.equal(stated.input.restriction.speedKnots, 10);
  assert.equal(stated.input.restriction.minimumLengthMetres, 13);
  assert.equal(stated.input.restriction.exceptionsApply, false);
});

test('a notice that states no restriction is record-shows-none', () => {
  const scene = adaptStoryReplay(data, Date.parse('2026-09-14T06:00:00Z'));
  assert.equal(frameAt(data, minuteForInstant('2026-09-14T06:00:00Z')).notice?.id, 'n-none');
  assert.equal(scene.input.restriction.status, 'record-shows-none');
  assert.equal(scene.input.restriction.exceptionsApply, false);
  assert.equal(scene.input.restriction.speedKnots, null);
  assert.equal(scene.input.restriction.effectiveAt, '2026-09-14T00:00:00Z');
});

test('not_imported, incomplete, an empty hour, and an unmapped zone stay unknown', () => {
  const empty = buildSceneState({
    mode: 'story',
    selectedTimeMs: Date.parse('2026-09-13T03:15:00Z'),
    rangeStartMs: Date.parse('2026-09-13T00:00:00Z'),
    rangeEndMs: Date.parse('2026-09-17T00:00:00Z'),
    vessels: [],
    detections: [],
    restriction: {
      status: 'unknown', effectiveAt: null, publishedAt: null, speedKnots: null,
      minimumLengthMetres: null, exceptionsApply: false, cancellationReference: null,
    },
    marine: null,
  });
  assert.equal(empty.mode, 'story');
  if (empty.mode === 'story') {
    assert.equal(empty.fleet.state, 'unknown');
    assert.equal(empty.fleet.note, 'an empty hour does not prove zero vessel traffic');
  }

  const notImported = adaptStoryReplay({ ...data, status: 'not_imported', presence: [] }, atSixteen);
  assert.equal(notImported.input.fleetCoverage, 'not-imported');
  assert.deepEqual(notImported.input.vessels, []);
  const notImportedState = buildSceneState(notImported.input);
  assert.equal(notImportedState.mode, 'story');
  if (notImportedState.mode === 'story') {
    assert.equal(notImportedState.fleet.state, 'unknown');
    assert.equal(notImportedState.fleet.note, 'GFW historical snapshot has not been imported. Vessel-hour counts are unavailable.');
  }

  const incomplete = adaptStoryReplay({ ...data, status: 'incomplete' }, atSixteen);
  assert.equal(incomplete.input.vessels.length, 3);
  assert.equal(incomplete.input.fleetCoverage, 'incomplete');
  assert.deepEqual(incomplete.wakes.map((wake) => wake.id), ['gfw:a-16']);
  const incompleteState = buildSceneState(incomplete.input);
  assert.equal(incompleteState.mode, 'story');
  if (incompleteState.mode === 'story') {
    assert.equal(incompleteState.fleet.state, 'unknown');
    assert.equal(incompleteState.fleet.note, 'GFW replay has fewer or more than the 358 checked rows for these seven days. Treat displayed counts as incomplete.');
  }

  const other = adaptStoryReplay({
    ...data,
    notices: [{
      id: 'n-other', sourceRecordId: 'other', publishedAt: '2026-09-13T00:00:00Z',
      effectiveAt: '2026-09-13T00:00:00Z', zoneAState: 'seasonal_closure',
      appliesTo: 'all_vessels', cancels: null, sourceUrl: 'https://example.com/other',
    }],
  }, Date.parse('2026-09-15T16:40:00Z'));
  assert.equal(other.input.restriction.status, 'unknown');
  assert.deepEqual(other.mismatches, ['unmapped zoneAState: seasonal_closure']);
});

test('a story click shows the stored name, omits an insufficient type, and keeps the speed band', () => {
  const named = storyClickText({
    name: '  MSC   WEST V ',
    vesselType: 'CARGO',
    speedBandLabel: 'categories from 10 kn upward',
  });
  assert.deepEqual(named.lines, ['MSC WEST V', 'CARGO']);
  assert.equal(named.meta, 'Recorded speed group: 10 knots and above');

  const insufficient = storyClickText({
    name: 'CIC OSLO',
    vesselType: 'INSUFFICIENT_DATA',
    speedBandLabel: 'categories through 10 kn',
  });
  assert.deepEqual(insufficient.lines, ['CIC OSLO']);
  assert.equal(insufficient.meta, 'Recorded speed group: up to 10 knots');

  const blank = storyClickText({
    name: '   ',
    vesselType: '  ',
    speedBandLabel: null,
  });
  assert.deepEqual(blank.lines, ['unknown ship']);
  assert.equal(blank.meta, 'the speed was not in the record');

  const fishing = storyClickText({
    name: null,
    vesselType: 'FISHING',
    speedBandLabel: 'categories through 10 kn',
  });
  assert.deepEqual(fishing.lines, ['unknown ship', 'FISHING']);

  const other = storyClickText({
    name: 'HURON',
    vesselType: 'OTHER_NON_FISHING',
    speedBandLabel: 'categories through 10 kn',
  });
  assert.deepEqual(other.lines, ['HURON', 'other vessel']);

  const coded = storyClickText({
    name: 'EXAMPLE',
    vesselType: 'SUPPORT_VESSEL',
    speedBandLabel: 'categories from 10 kn upward',
  });
  assert.deepEqual(coded.lines, ['EXAMPLE', 'support vessel']);
});

function hourFleet(
  coverage: StoryFleetFact['coverage'],
  counts: { throughTenKnots: number, tenAndAbove: number, total: number },
): StoryFleetFact {
  return {
    state: coverage === 'ready' && counts.total > 0 ? 'available' : 'unknown',
    note: 'do not print this note',
    selectedHour: '2026-09-15T16:00Z',
    coverage,
    ...counts,
  };
}

test('every story hour keeps its concise reading and does not print the fleet note', () => {
  const ready = storyHourSentence(hourFleet('ready', { throughTenKnots: 2, tenAndAbove: 1, total: 3 }));
  assert.equal(ready, 'At 15 September 2026 at 16:00 UTC, 2 of 3 Global Fishing Watch vessel-hours fall in speed categories up to 10 knots. 1 falls in categories starting at 10 knots.');
  assert.equal(ready.includes('do not print this note'), false);
  assert.equal(ready.includes('vessel-hours'), true);

  assert.equal(
    storyHourSentence(hourFleet('empty-hour', { throughTenKnots: 0, tenAndAbove: 0, total: 0 })),
    'At 15 September 2026 at 16:00 UTC, this hour of the snapshot has no vessel-hours. That is missing coverage, not an empty sea.',
  );
  assert.equal(
    storyHourSentence(hourFleet('not-imported', { throughTenKnots: 0, tenAndAbove: 0, total: 0 })),
    'At 15 September 2026 at 16:00 UTC, the Global Fishing Watch snapshot is not loaded.',
  );
  assert.equal(
    storyHourSentence(hourFleet('unavailable', { throughTenKnots: 1, tenAndAbove: 0, total: 1 })),
    'At 15 September 2026 at 16:00 UTC, this hour could not be read.',
  );
  assert.equal(
    storyHourSentence(hourFleet('incomplete', { throughTenKnots: 2, tenAndAbove: 1, total: 3 })),
    'At 15 September 2026 at 16:00 UTC, an incomplete snapshot shows 2 of 3 Global Fishing Watch vessel-hours fall in speed categories up to 10 knots. 1 falls in categories starting at 10 knots.',
  );
  assert.equal(
    storyHourSentence(hourFleet('incomplete', { throughTenKnots: 0, tenAndAbove: 0, total: 0 })),
    'At 15 September 2026 at 16:00 UTC, the snapshot is incomplete, so this hour cannot be counted.',
  );
});


test('between Story steps the main reading uses the selected hour, including explicit empty coverage', async () => {
  const {storyReadingAt} = await import('./shared-water/world/facts/createFactRail.js');
  const fleet = {state: 'available' as const, note: null, throughTenKnots: 0, tenAndAbove: 0,
    total: 0, selectedHour: '2026-09-13T12:00:00Z', coverage: 'empty-hour' as const};
  const reading = storyReadingAt(fleet, Date.parse('2026-09-13T12:30:00Z'));
  assert.match(reading.text, /no vessel-hours|no indexed|no GFW|No vessel-hour/);
  assert.match(reading.timeLabel, /12:30/);
  assert.doesNotMatch(reading.text, /several ships passing/);
});
