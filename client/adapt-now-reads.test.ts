import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptNowReads as adaptAt, type NowCurrentReads } from './adapt-now-reads.js';
const adaptNowReads = (reads: NowCurrentReads) => adaptAt(reads, Date.parse('2026-09-25T19:05:00Z'));
import { buildSceneState } from './shared-water/world/data/buildSceneState.js';
import { restrictionSentence, restrictionValue } from './shared-water/world/zone/restrictionLabel.js';

const reads: NowCurrentReads = {
  ais: {
    source: 'aisstream',
    connection: {
      status: 'connected',
      lastMessageAt: '2026-09-25T19:41:12Z',
    },
    data: {
      status: 'recent_messages',
      recentWindowMinutes: 30,
      lastStored: { observedAt: '2026-09-25T19:41:12Z', receivedAt: '2026-09-25T19:41:12Z' },
      positions: [
        {
          id: 'ais:vessel-01', mmsi: '316000001', observedAt: '2026-09-25T19:41:00Z',
          receivedAt: '2026-09-25T19:41:12Z', latitude: 49.31, longitude: -64.55,
          speedKnots: 8.4, shipName: 'ATLANTIC SENTINEL', course: 90,
          pastPositions: [{ latitude: 49.3, longitude: -64.5 }],
        },
        {
          id: 'ais:vessel-03', mmsi: '316000003', observedAt: '2026-09-25T19:39:44Z',
          receivedAt: '2026-09-25T19:39:44Z', latitude: 49.33, longitude: -64.42,
          speedKnots: null, shipName: null,
        },
      ],
    },
  },
  whoi: {
    fetch: { status: 'success', lastSuccessAt: '2026-09-25T18:00:00Z' },
    data: {
      status: 'recent_review',
      ageDays: 1,
      latestReview: {
        reviewDate: '2026-09-24',
        detectionCount: 2,
        sourceUrl: 'https://example.com/whoi',
      },
      indexedDetections: [
        {
          id: 'whoi:should-not-mark',
          sourceLocalTime: '2026-09-24 15:23:53',
          occurrence: 'detected',
          platformLatitude: 49.358,
          platformLongitude: -64.687,
        },
      ],
    },
  },
  navwarn: {
    fetch: { status: 'success', lastSuccessAt: '2026-09-25T18:10:00Z' },
    data: {
      status: 'latest_published_notice',
      notice: {
        id: 'navwarn:NW-C-3975-26',
        sourceRecordId: 'NW-C-3975-26',
        publishedAt: '2026-09-15T11:45:00Z',
        effectiveAt: '2026-09-15T12:30:00Z',
        zoneAState: 'restricted_10_knots',
        appliesTo: 'vessels_over_13_m',
        cancels: 'NW-C-3957-26',
      },
      notices: [
        { zoneAState: 'no_restriction_stated', publishedAt: '2026-09-16T00:00:00Z' },
      ],
    },
  },
  marine: {
    fetch: { status: 'success', checkedAt: '2026-09-25T19:06:00Z', lastSuccessAt: '2026-09-25T19:05:00Z', error: null },
    data: {
      status: 'fresh',
      ageMinutes: 5,
      observation: {
        validAt: '2026-09-25T19:00:00Z',
        waveHeightM: 1.6,
        seaSurfaceTemperatureC: 14.8,
        oceanCurrentVelocityKmh: 3.6,
      },
    },
  },
};

const restrictedNotice = {
  id: 'navwarn:current',
  publishedAt: '2026-09-15T11:45:00Z',
  effectiveAt: '2026-09-15T12:30:00Z',
  zoneAState: 'restricted_10_knots',
  appliesTo: 'vessels_over_13_m',
  cancels: 'NW-C-3957-26',
};

test('current reads keep each source freshness and only the returned AIS positions', () => {
  const scene = adaptNowReads(reads);

  assert.equal(scene.mode, 'now');
  assert.equal(scene.ais.state, 'fresh');
  assert.equal(scene.ais.lastReceivedAt, '2026-09-25T19:41:12Z');
  assert.deepEqual(scene.ais.vessels.map((vessel) => vessel.id), ['ais:vessel-01', 'ais:vessel-03']);
  assert.deepEqual(scene.ais.vessels[0].position, { lat: 49.31, lon: -64.55 });
  assert.equal(scene.ais.vessels[0].name, 'ATLANTIC SENTINEL');
  assert.equal(scene.ais.vessels[0].speedKnots, 8.4);
  assert.equal(scene.ais.vessels[1].name, null);
  assert.equal(scene.ais.vessels[1].speedKnots, null);
  assert.equal('headingDegrees' in scene.ais.vessels[0], false);
  assert.equal('course' in scene.ais.vessels[0], false);
  assert.equal('pastPositions' in scene.ais.vessels[0], false);
  assert.deepEqual(Object.keys(scene.ais.vessels[0]).sort(), [
    'id', 'lastReceivedAt', 'name', 'position', 'speedKnots',
  ]);

  assert.equal(scene.whaleReview?.state, 'recent');
  assert.equal(scene.whaleReview?.reviewDate, '2026-09-24');
  assert.equal(scene.whaleReview?.rightWhaleRows, 2);
  assert.equal(JSON.stringify(scene).includes('whoi:should-not-mark'), false);
  assert.equal('detections' in scene, false);

  assert.equal(scene.restriction.status, 'active');
  assert.equal(scene.restriction.effectiveAt, '2026-09-15T12:30:00Z');
  assert.equal(scene.restriction.publishedAt, '2026-09-15T11:45:00Z');
  assert.equal(scene.restriction.speedKnots, 10);
  assert.equal(scene.restriction.minimumLengthMetres, 13);
  assert.equal(scene.restriction.exceptionsApply, false);
  assert.equal(scene.restriction.cancellationReference, 'NW-C-3957-26');

  assert.equal(scene.marine?.state, 'fresh');
  assert.equal(scene.marine?.waveHeightMetres, 1.6);
  assert.equal(scene.marine?.seaSurfaceTemperatureC, 14.8);
  assert.equal(scene.marine?.currentSpeedMs, 1);
  assert.equal(scene.marine?.validAt, '2026-09-25T19:00:00Z');
  assert.equal(scene.marine?.fetchedAt, '2026-09-25T19:05:00Z');

  const state = buildSceneState(scene);
  assert.equal(state.mode, 'now');
  if (state.mode !== 'now') return;
  assert.equal(state.ais.state, 'fresh');
  assert.equal(state.ais.vesselCount, 2);
  assert.equal(state.ais.connection, 'connected');
  assert.deepEqual(state.vessels.map(vessel => vessel.id), ['ais:vessel-01', 'ais:vessel-03']);
  assert.equal(state.vessels[0].source, 'ais');
  assert.equal(state.vessels[0].speedKnots, 8.4);
  assert.equal(state.vessels[0].headingDegrees, null);
  assert.equal('detections' in state, false);
});

test('unconfigured and unknown AIS stay a null count, including an empty position list', () => {
  const unconfigured = adaptNowReads({
    ...reads,
    ais: {
      connection: { status: 'unconfigured' },
      data: {
        status: 'recent_messages',
        positions: [
          { id: 'ais:ignored', latitude: 49.31, longitude: -64.55, speedKnots: 8, shipName: 'IGNORED', receivedAt: '2026-09-25T19:41:12Z' },
        ],
      },
    },
  });
  assert.equal(unconfigured.ais.state, 'unconfigured');
  assert.deepEqual(unconfigured.ais.vessels, []);
  const unconfiguredState = buildSceneState(unconfigured);
  assert.equal(unconfiguredState.mode, 'now');
  if (unconfiguredState.mode === 'now') {
    assert.equal(unconfiguredState.ais.vesselCount, null);
    assert.deepEqual(unconfiguredState.vessels, []);
  }

  const empty = adaptNowReads({
    ...reads,
    ais: {
      connection: { status: 'connected' },
      data: { status: 'unknown', positions: [] },
    },
  });
  assert.equal(empty.ais.state, 'unknown');
  assert.notEqual(empty.ais.state, 'quiet');
  assert.deepEqual(empty.ais.vessels, []);
  const emptyState = buildSceneState(empty);
  assert.equal(emptyState.mode, 'now');
  if (emptyState.mode === 'now') assert.equal(emptyState.ais.vesselCount, null);

  const leftover = adaptNowReads({
    ...reads,
    ais: {
      connection: { status: 'unverified' },
      data: {
        status: 'unknown',
        positions: [
          { id: 'ais:leftover', latitude: 49.31, longitude: -64.55, speedKnots: 4, shipName: 'LEFTOVER', receivedAt: '2026-09-25T19:20:00Z' },
        ],
      },
    },
  });
  assert.equal(leftover.ais.state, 'unknown');
  assert.deepEqual(leftover.ais.vessels, []);
  const leftoverState = buildSceneState(leftover);
  assert.equal(leftoverState.mode, 'now');
  if (leftoverState.mode === 'now') {
    assert.equal(leftoverState.ais.vesselCount, null);
    assert.deepEqual(leftoverState.vessels, []);
  }

  const quietWindow = adaptNowReads({
    ...reads,
    ais: {
      connection: { status: 'connected' },
      data: { status: 'recent_messages', positions: [] },
    },
  });
  assert.equal(quietWindow.ais.state, 'unknown');
  const quietState = buildSceneState(quietWindow);
  assert.equal(quietState.mode, 'now');
  if (quietState.mode === 'now') {
    assert.equal(quietState.ais.state, 'unknown');
    assert.equal(quietState.ais.vesselCount, null);
  }
});

test('unverified and pending notices stay visible, and a notice that states none is record-shows-none', () => {
  const missing = adaptNowReads({
    ...reads,
    navwarn: { data: { status: 'missing', notice: null } },
  });
  assert.equal(missing.restriction.status, 'unknown');
  assert.equal(restrictionValue(missing.restriction.status), 'restriction state unknown');
  assert.equal(
    restrictionSentence(missing.restriction),
    'No current vessel notice is available for Zone A.',
  );

  const unverified = adaptNowReads({
    ...reads,
    navwarn: {
      data: {
        status: 'unverified',
        notice: {
          ...restrictedNotice,
          rawText: 'Vessels must not exceed 10 knots. Exceptions apply.',
        },
      },
    },
  });
  assert.equal(unverified.restriction.status, 'unverified');
  assert.equal(restrictionValue(unverified.restriction.status), 'a notice exists but is unverified');
  assert.equal(
    restrictionSentence(unverified.restriction),
    'A notice is stored, but the latest search did not confirm it as current. Zone A state is unverified.',
  );
  assert.equal(unverified.restriction.speedKnots, 10);
  assert.equal(unverified.restriction.exceptionsApply, false);
  assert.equal(unverified.restriction.publishedAt, restrictedNotice.publishedAt);

  const pending = adaptNowReads({
    ...reads,
    navwarn: { data: { status: 'pending_effective_time', notice: restrictedNotice } },
  });
  assert.equal(pending.restriction.status, 'pending');
  assert.equal(restrictionValue(pending.restriction.status), 'a notice exists but has not taken effect');
  assert.equal(
    restrictionSentence(pending.restriction),
    'The latest search confirmed a notice, but it has not taken effect. It does not establish Zone A state.',
  );
  assert.equal(pending.restriction.speedKnots, 10);
  assert.notEqual(pending.restriction.status, 'active');

  const stated = adaptNowReads({
    ...reads,
    navwarn: {
      data: {
        status: 'latest_published_notice',
        notice: {
          ...restrictedNotice,
          rawText: 'The 10-knot limit has exceptions for some vessels.',
        },
      },
    },
  });
  assert.equal(stated.restriction.status, 'active');
  assert.equal(stated.restriction.speedKnots, 10);
  assert.equal(stated.restriction.minimumLengthMetres, 13);
  assert.equal(stated.restriction.exceptionsApply, false);
  assert.equal(
    restrictionSentence(stated.restriction),
    'The notice lists a 10-knot limit for vessels over 13 m. Effective 2026-09-15 12:30 UTC. This is not a clearance to navigate.',
  );

  const none = adaptNowReads({
    ...reads,
    navwarn: {
      data: {
        status: 'latest_published_notice',
        notice: {
          publishedAt: '2026-09-14T00:00:00Z',
          effectiveAt: '2026-09-14T00:00:00Z',
          zoneAState: 'no_restriction_stated',
          appliesTo: 'vessels_over_13_m',
          cancels: null,
        },
      },
    },
  });
  assert.equal(none.restriction.status, 'record-shows-none');
  assert.equal(none.restriction.speedKnots, null);
  assert.equal(none.restriction.effectiveAt, '2026-09-14T00:00:00Z');
  assert.equal(none.restriction.publishedAt, '2026-09-14T00:00:00Z');
  assert.equal(none.restriction.cancellationReference, null);
  assert.equal(
    restrictionSentence(none.restriction),
    'The notice shows no special Zone A restriction. This does not mean there are no other rules.',
  );

  const other = adaptNowReads({
    ...reads,
    navwarn: {
      data: {
        status: 'latest_published_notice',
        notice: { ...restrictedNotice, zoneAState: 'seasonal_closure' },
      },
    },
  });
  assert.equal(other.restriction.status, 'unknown');
});

test('WHOI and marine keep their own statuses when another read is absent', () => {
  const stale = adaptNowReads({
    ais: null,
    whoi: {
      data: {
        status: 'stale_review',
        latestReview: { reviewDate: '2026-09-20', detectionCount: 0 },
        indexedDetections: [{ id: 'whoi:old-mark', platformLatitude: 49.35, platformLongitude: -64.68 }],
      },
    },
    navwarn: null,
    marine: {
      fetch: { status: 'success', lastSuccessAt: '2026-09-25T12:00:00Z' },
      data: {
        status: 'stale',
        observation: {
          validAt: '2026-09-25T10:00:00Z',
          waveHeightM: 0,
          seaSurfaceTemperatureC: null,
          oceanCurrentVelocityKmh: null,
        },
      },
    },
  });

  assert.equal(stale.ais.state, 'unknown');
  assert.equal(stale.whaleReview?.state, 'stale');
  assert.equal(stale.whaleReview?.reviewDate, '2026-09-20');
  assert.equal(stale.whaleReview?.rightWhaleRows, 0);
  assert.equal(JSON.stringify(stale).includes('whoi:old-mark'), false);
  assert.equal(stale.restriction.status, 'unknown');
  assert.equal(stale.marine?.state, 'stale');
  assert.equal(stale.marine?.waveHeightMetres, 0);
  assert.equal(stale.marine?.seaSurfaceTemperatureC, null);
  assert.equal(stale.marine?.currentSpeedMs, null);
  assert.equal(stale.marine?.validAt, '2026-09-25T10:00:00Z');
  assert.equal(stale.marine?.fetchedAt, '2026-09-25T12:00:00Z');

  const missing = adaptNowReads({
    ...reads,
    whoi: { data: { status: 'missing', latestReview: null, indexedDetections: [] } },
    marine: { fetch: { status: 'never', lastSuccessAt: null }, data: { status: 'missing', observation: null } },
  });
  assert.equal(missing.ais.state, 'fresh');
  assert.equal(missing.whaleReview?.state, 'missing');
  assert.equal(missing.whaleReview?.reviewDate, null);
  assert.equal(missing.whaleReview?.rightWhaleRows, null);
  assert.equal(missing.marine?.state, 'missing');
  assert.equal(missing.marine?.waveHeightMetres, null);
  assert.equal(missing.marine?.currentSpeedMs, null);
  assert.equal(missing.marine?.validAt, null);
  assert.equal(missing.marine?.fetchedAt, null);
  assert.equal(missing.restriction.status, 'active');
});
