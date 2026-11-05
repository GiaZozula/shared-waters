import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRain } from './shared-water/world/weather/createRain.js';
import type { SolarState } from './shared-water/world/time/getSolarState.js';

test('heavy cinematic rain stays within its allocated drops and GPU buffer during day and night', () => {
  const field = createRain();
  const camera = new THREE.PerspectiveCamera();
  try {
    for (const rain of [0.03, 0.24, 0.9, 1]) for (const nightAmount of [0, 0.5, 1]) {
      const solar: SolarState = { altitude: 0, azimuth: 0, sunDirection: new THREE.Vector3(0, 1, 0),
        dayAmount: 1 - nightAmount, nightAmount, twilightAmount: 0, daylightStrength: 1 - nightAmount };
      assert.doesNotThrow(() => field.update(camera, 20, { cloudCover: 1, rain, windStrength: 0.8,
        windX: -0.8, windZ: -0.5, haze: 0.5, waterEnergy: 0.8 }, solar));
      const positions = field.rain.geometry.getAttribute('position');
      assert.ok(field.rain.geometry.drawRange.count <= positions.count);
      assert.ok(Array.from(positions.array).every(Number.isFinite));
    }
  } finally { field.rain.geometry.dispose(); field.rain.material.dispose(); }
});

test('rain streaks follow their travel direction and keep restrained alpha', () => {
  const field = createRain();
  const camera = new THREE.PerspectiveCamera();
  const solar: SolarState = { altitude: 0, azimuth: 0, sunDirection: new THREE.Vector3(0, 1, 0),
    dayAmount: 1, nightAmount: 0, twilightAmount: 0, daylightStrength: 1 };
  const weather = { cloudCover: 1, rain: 1, windStrength: 0.8,
    windX: -0.8, windZ: -0.5, haze: 0.5, waterEnergy: 0.8 };
  try {
    field.update(camera, 20, weather, solar);
    const before = Array.from(field.rain.geometry.getAttribute('position').array);
    field.update(camera, 20.001, weather, solar);
    const after = field.rain.geometry.getAttribute('position').array;
    const alpha = field.rain.geometry.getAttribute('aAlpha').array;
    let checked = 0;
    for (let i = 0; i < field.rain.geometry.drawRange.count * 3; i += 6) {
      const dx = after[i] - before[i];
      const dy = after[i + 1] - before[i + 1];
      const dz = after[i + 2] - before[i + 2];
      if (dy >= 0) continue; // A wrapped drop begins a new fall.
      const tx = after[i] - after[i + 3];
      const ty = after[i + 1] - after[i + 4];
      const tz = after[i + 2] - after[i + 5];
      const alignment = (dx * tx + dy * ty + dz * tz) / (Math.hypot(dx, dy, dz) * Math.hypot(tx, ty, tz));
      assert.ok(alignment > 0.999);
      checked++;
    }
    assert.ok(checked > 100);
    assert.ok(Array.from(alpha).every(value => value >= 0 && value <= 0.4));
  } finally { field.rain.geometry.dispose(); field.rain.material.dispose(); }
});
