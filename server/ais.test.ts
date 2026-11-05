import assert from 'node:assert/strict';
import test from 'node:test';
import { ZONE_A_CORNERS } from '../shared/zone-a.js';
import { ZONE_POLYGON, aisSubscription, inZoneA, parseAisPosition } from './ais.js';

const received = new Date('2026-09-25T12:34:20Z');
const message = {
  MessageType: 'PositionReport', MetaData: { MMSI: 316123456, ShipName: 'TEST SHIP' },
  Message: { PositionReport: { UserID: 316123456, Latitude: 49.35, Longitude: -64.7,
    Sog: 8.2, Timestamp: 17, Valid: true } },
};

test('AIS polygon filter uses the shared Zone A corners', () => {
  assert.equal(ZONE_POLYGON, ZONE_A_CORNERS);
});

test('AIS subscription is limited to the Zone A bounding box and position types', () => {
  const subscription = aisSubscription('test-key');
  assert.deepEqual(subscription.BoundingBoxes, [[[49.183333, -65], [49.683333, -64]]]);
  assert.deepEqual(subscription.FilterMessageTypes,
    ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport']);
  assert.equal(inZoneA(49.35, -64.7), true);
  assert.equal(inZoneA(49.2, -64.9), false);
});

test('AIS parser creates a stable source key for a repeated frame and excludes outside positions', () => {
  const first = parseAisPosition(message, received);
  const repeat = parseAisPosition(message, new Date('2026-09-25T12:34:30Z'));
  assert.ok(first);
  assert.equal(first.id, repeat?.id);
  assert.equal(first.observedAt, '2026-09-25T12:34:17.000Z');
  assert.equal(first.speedKnots, 8.2);
  assert.equal(parseAisPosition({ ...message, Message: { PositionReport: {
    ...message.Message.PositionReport, Latitude: 49.2, Longitude: -64.9,
  } } }, received), null);
  assert.equal(parseAisPosition({ ...message, Message: { PositionReport: {
    ...message.Message.PositionReport, Valid: false,
  } } }, received), null);
  const outside = { ...message, Message: { PositionReport: {
    ...message.Message.PositionReport, Latitude: 48.5, Longitude: -62 } } };
  assert.equal(parseAisPosition(outside, received), null);
  assert.equal(inZoneA(48.5, -62), false);
  const gulf = parseAisPosition(outside, received, (latitude, longitude) =>
    latitude >= 47 && latitude <= 50.5 && longitude >= -67 && longitude <= -59);
  assert.equal(gulf?.latitude, 48.5);
});

test('AIS parser preserves unknown speed and uses source UTC time when present', () => {
  const parsed = parseAisPosition({ ...message, MetaData: {
    ...message.MetaData, time_utc: '2026-09-25T12:33:59Z',
  }, Message: { PositionReport: { ...message.Message.PositionReport, Sog: 102.3 } } }, received);
  assert.equal(parsed?.speedKnots, null);
  assert.equal(parsed?.observedAt, '2026-09-25T12:33:59.000Z');
});

test('AIS parser accepts a live Go-style nanosecond UTC timestamp', () => {
  const parsed = parseAisPosition({ ...message, MetaData: {
    ...message.MetaData, time_utc: '2026-09-25 12:34:17.34505366 +0000 UTC',
  } }, received);
  assert.equal(parsed?.observedAt, '2026-09-25T12:34:17.345Z');
});


test('AIS retains explicit delayed and future source clocks rather than inventing a current observation', () => {
  for (const at of ['2026-09-25T10:00:00Z', '2026-09-25T14:00:00Z']) {
    const parsed = parseAisPosition({ ...message, MetaData: { ...message.MetaData, time_utc: at } }, received);
    assert.equal(parsed?.observedAt, new Date(at).toISOString());
    assert.equal(parsed?.receivedAt, received.toISOString());
  }
});
