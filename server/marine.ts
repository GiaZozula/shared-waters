export const MARINE_SOURCE = 'open_meteo_marine';
export const MARINE_ZONE = 'zone_a';
export const MARINE_POINT = { latitude: 49.358, longitude: -64.687 } as const;
export const MARINE_URL = new URL('https://marine-api.open-meteo.com/v1/marine');
MARINE_URL.searchParams.set('latitude', String(MARINE_POINT.latitude));
MARINE_URL.searchParams.set('longitude', String(MARINE_POINT.longitude));
MARINE_URL.searchParams.set('current', 'wave_height,sea_surface_temperature,ocean_current_velocity');
MARINE_URL.searchParams.set('timezone', 'GMT');

export type MarineObservation = {
  id: string;
  sourceRecordId: string;
  validAt: string;
  gridLatitude: number;
  gridLongitude: number;
  waveHeightM: number | null;
  seaSurfaceTemperatureC: number | null;
  oceanCurrentVelocityKmh: number | null;
  rawPayload: Record<string, unknown>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Marine response: invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function nullableNumber(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Marine response: invalid ${label}`);
  }
  return value;
}

export function parseMarineCurrent(value: unknown): MarineObservation {
  const raw = object(value, 'root');
  const units = object(raw.current_units, 'current_units');
  const current = object(raw.current, 'current');
  if (raw.timezone !== 'GMT' || raw.utc_offset_seconds !== 0 ||
      units.wave_height !== 'm' || units.sea_surface_temperature !== '°C' ||
      units.ocean_current_velocity !== 'km/h') {
    throw new Error('Marine response: unexpected timezone or units');
  }
  const latitude = raw.latitude;
  const longitude = raw.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude - MARINE_POINT.latitude) > 0.25 ||
      Math.abs(longitude - MARINE_POINT.longitude) > 0.25) {
    throw new Error('Marine response: grid point is too far from Zone A sample point');
  }
  const time = current.time;
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) {
    throw new Error('Marine response: invalid current time');
  }
  const validAt = `${time}:00Z`;
  const parsed = Date.parse(validAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().replace('.000Z', 'Z') !== validAt ||
      typeof current.interval !== 'number' || current.interval <= 0 || current.interval > 3600) {
    throw new Error('Marine response: invalid model valid time or interval');
  }
  const waveHeightM = nullableNumber(current.wave_height, 'wave_height', 0, 50);
  const seaSurfaceTemperatureC = nullableNumber(current.sea_surface_temperature, 'sea_surface_temperature', -5, 45);
  const oceanCurrentVelocityKmh = nullableNumber(current.ocean_current_velocity, 'ocean_current_velocity', 0, 50);
  const sourceRecordId = `${MARINE_ZONE}/${validAt}`;
  return {
    id: `open-meteo-marine:${sourceRecordId}`, sourceRecordId, validAt,
    gridLatitude: latitude, gridLongitude: longitude,
    waveHeightM, seaSurfaceTemperatureC, oceanCurrentVelocityKmh,
    rawPayload: raw,
  };
}

export type DataStatus = 'fresh' | 'stale' | 'missing';

export function marineDataStatus(
  observation: (Pick<MarineObservation, 'waveHeightM' | 'seaSurfaceTemperatureC' | 'oceanCurrentVelocityKmh'> &
    { validAt: string | Date }) | null,
  now: Date,
): { status: DataStatus; ageMinutes: number | null } {
  if (!observation || [observation.waveHeightM, observation.seaSurfaceTemperatureC,
    observation.oceanCurrentVelocityKmh].every((value) => value === null)) {
    return { status: 'missing', ageMinutes: null };
  }
  const validTime = observation.validAt instanceof Date ? observation.validAt.getTime() : Date.parse(observation.validAt);
  const ageMinutes = Math.round((now.getTime() - validTime) / 60_000);
  const ageMs = now.getTime() - validTime;
  return { status: ageMs >= -5 * 60_000 && ageMs <= 45 * 60_000 ? 'fresh' : 'stale', ageMinutes };
}
