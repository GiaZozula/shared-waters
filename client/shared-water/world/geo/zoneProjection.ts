export const ZONE_A_COORDINATES = [
  {
    lat: 49 + 41 / 60,
    lon: -65,
  },
  {
    lat: 49 + 20 / 60,
    lon: -65,
  },
  {
    lat: 49 + 11 / 60,
    lon: -64,
  },
  {
    lat: 49 + 22 / 60,
    lon: -64,
  },
] as const

/*
 * Display stretch across the visible water.
 * Longitude runs away from the camera.
 * Latitude runs across the view.
 * The glider stays near the middle.
 */
const ANCHOR_LON = -64.687

const LAT_SPAN_CENTER =
  (
    (49 + 41 / 60) +
    (49 + 11 / 60)
  ) / 2

const LAT_UNITS_PER_KM = 0.34

const LON_UNITS_PER_KM = 0.62

const SCREEN_CENTER_Z = -10

export function geoToWorld(
  lat: number,
  lon: number,
) {
  const kmPerLatitude =
    111.32

  const kmPerLongitude =
    111.32 *
    Math.cos(
      LAT_SPAN_CENTER *
      Math.PI /
      180,
    )

  return {
    x:
      (
        lat -
        LAT_SPAN_CENTER
      ) *
      kmPerLatitude *
      LAT_UNITS_PER_KM,

    z:
      SCREEN_CENTER_Z -
      (
        lon -
        ANCHOR_LON
      ) *
      kmPerLongitude *
      LON_UNITS_PER_KM,
  }
}
