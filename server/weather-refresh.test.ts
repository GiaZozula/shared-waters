import assert from 'node:assert/strict'
import test from 'node:test'
import type pg from 'pg'
import { refreshMarine } from './marine-store.js'
const marine = { latitude:49.375,longitude:-64.708,timezone:'GMT',utc_offset_seconds:0,
 current_units:{wave_height:'m',sea_surface_temperature:'°C',ocean_current_velocity:'km/h'},
 current:{time:'2026-11-04T16:00',interval:900,wave_height:1,sea_surface_temperature:10,ocean_current_velocity:1} }
const weather = { ...marine, current_units:{weather_code:'wmo code',cloud_cover:'%',wind_speed_10m:'km/h'},
 current:{time:'2026-11-04T16:00',weather_code:95,cloud_cover:100,wind_speed_10m:50} }
test('optional weather is persisted with marine; failure still commits marine with weather unavailable', async () => {
 for (const fails of [false,true]) {
  let payload: any, committed = false, calls = 0
  const client = { query:async (sql:string, values?:any[]) => {
   if (sql.includes('INSERT INTO marine_observations')) payload = values![10]
   if (sql === 'COMMIT') committed=true
   return {rows:[]}
  },release(){} }
  const db = {connect:async()=>client,query:client.query} as unknown as pg.Pool
  const fetcher:typeof fetch = async () => {
   calls++
   if (calls === 2 && fails) throw Error('Unavailable')
   return new Response(JSON.stringify(calls === 1 ? marine : weather),{status:200})
  }
  await refreshMarine(db,fetcher)
  assert.equal(committed,true)
  assert.equal(calls,2)
  assert.equal(payload.liveWeather?.code ?? null, fails ? null : 95)
 }
})
