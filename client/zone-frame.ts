import { ZONE_A_CORNERS } from '../shared/zone-a.js';
import { aisCoverageLabel } from './display-labels.js';

const VIEW = 1.12;
const BOUNDS = { west: -65.08, east: -63.92, south: 49.10, north: 49.77 };

export type SceneMark = {
  layer: 'gfw' | 'ais' | 'glider';
  latitude: number;
  longitude: number;
  selected: boolean;
};

export function canvasSize(width: number): { width: number; height: number } {
  const safe = Math.max(width, 1);
  return { width: safe, height: Math.max(280, Math.min(520, safe * 0.58)) };
}

// Wide canvases expand the horizontal view so the square map stays fully visible.
export function cameraFrustum(width: number, height: number) {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  if (aspect >= 1) return { left: -VIEW * aspect, right: VIEW * aspect, top: VIEW, bottom: -VIEW };
  return { left: -VIEW, right: VIEW, top: VIEW / aspect, bottom: -VIEW / aspect };
}

export function scenePoint(latitude: number, longitude: number): { x: number; y: number } {
  return {
    x: (longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * 2 - 1,
    y: (latitude - BOUNDS.south) / (BOUNDS.north - BOUNDS.south) * 2 - 1,
  };
}

export function zoneCornersInView(width: number, height: number): boolean {
  const frame = cameraFrustum(width, height);
  return ZONE_A_CORNERS.every(([longitude, latitude]) => {
    const point = scenePoint(latitude, longitude);
    return point.x >= frame.left && point.x <= frame.right && point.y <= frame.top && point.y >= frame.bottom;
  });
}

export function sceneMarks(input: {
  presence: { latitude: number; longitude: number }[];
  ais: { latitude: number; longitude: number }[];
  detections: { id: string; platformLatitude: number; platformLongitude: number }[];
  selectedDetectionId: string | null;
}): SceneMark[] {
  return [
    ...input.presence.map((row) => ({ layer: 'gfw' as const, latitude: row.latitude, longitude: row.longitude, selected: false })),
    ...input.ais.map((row) => ({ layer: 'ais' as const, latitude: row.latitude, longitude: row.longitude, selected: false })),
    ...input.detections.map((row) => ({
      layer: 'glider' as const,
      latitude: row.platformLatitude,
      longitude: row.platformLongitude,
      selected: row.id === input.selectedDetectionId,
    })),
  ];
}

export function aisLegend(count: number, status: string): string {
  const coverage = aisCoverageLabel(status);
  if (count > 0) return `Latest received AIS (${count}; ${coverage})`;
  return `Latest received AIS (${coverage})`;
}
