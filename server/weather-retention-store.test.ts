import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {refreshMarine} from './marine-store.js';
test('same marine hour retains original weather time after enrichment failure and recovers', async () => {
 const admin = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 const schema = `weather_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const db = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try {
  await db.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  const marine = {latitude:49.375,longitude:-64.708,timezone:'GMT',utc_offset_seconds:0,current_units:{wave_height:'m',sea_surface_temperature:'°C',ocean_current_velocity:'km/h'},current:{time:'2026-11-04T16:00',interval:900,wave_height:1,sea_surface_temperature:10,ocean_current_velocity:1}};
  const weather = {...marine,current_units:{weather_code:'wmo code',cloud_cover:'%',wind_speed_10m:'km/h'},current:{time:'2026-11-04T15:45',weather_code:95,cloud_cover:100,wind_speed_10m:50}};
  for (const fails of [false,true,false]) {
   let calls=0;
   await refreshMarine(db,async () => { if (++calls===2 && fails) throw Error('fake failure'); return new Response(JSON.stringify(calls===1?marine:weather)); });
   const result=await db.query('SELECT raw_payload FROM marine_observations');
   assert.equal(result.rowCount,1);
   const w=result.rows[0].raw_payload.liveWeather;
   assert.equal(w.code,95); assert.equal(w.validAt,'2026-11-04T15:45:00Z');
   assert.equal(w.refreshUnavailable===true,fails); assert.equal(calls,2);
  }
 } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
