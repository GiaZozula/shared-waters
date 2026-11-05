import assert from 'node:assert/strict';
import test from 'node:test';
import { ZONE_A_CORNERS } from '../shared/zone-a.js';
import { ZONE_POLYGON } from '../server/ais.js';
import { aisLegend, canvasSize, sceneMarks, zoneCornersInView } from './zone-frame.js';

test('desktop and narrow canvases keep every shared Zone A corner in frame', () => {
  assert.equal(ZONE_POLYGON, ZONE_A_CORNERS);
  for (const width of [390, 720, 960, 1280]) {
    const size = canvasSize(width);
    assert.equal(zoneCornersInView(size.width, size.height), true, `${size.width}x${size.height}`);
  }
});

test('scene marks include every glider position and flag only the selected row', () => {
  const marks = sceneMarks({
    presence: [{ latitude: 49.4, longitude: -64.5 }],
    ais: [],
    detections: [
      { id: 'whoi:early', platformLatitude: 49.30, platformLongitude: -64.8 },
      { id: 'whoi:later', platformLatitude: 49.50, platformLongitude: -64.4 },
    ],
    selectedDetectionId: 'whoi:later',
  });
  const gliders = marks.filter((mark) => mark.layer === 'glider');
  assert.equal(gliders.length, 2);
  assert.deepEqual(gliders.map((mark) => mark.selected), [false, true]);
  assert.equal(marks.filter((mark) => mark.layer === 'gfw').length, 1);
});

test('an empty AIS layer is labeled with its status and no ship count', () => {
  assert.equal(aisLegend(0, 'unknown'), 'Latest received AIS (unknown)');
  assert.equal(aisLegend(0, 'unavailable'), 'Latest received AIS (unavailable)');
  assert.equal(aisLegend(2, 'recent_messages'), 'Latest received AIS (2; recent messages)');
});
