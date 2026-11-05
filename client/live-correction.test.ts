import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptNowReads} from './adapt-now-reads.js';
import {retainReading} from './retained-reading.js';
import {buildSceneState} from './shared-water/world/data/buildSceneState.js';
import {submitSceneQuestion} from './shared-water/world/question/askScene.js';
import {freshWeather} from '../shared/live-weather.js';
test('displayed answers retain failed-poll facts, age while paused, and recover', async () => {
 const time='2026-11-04T16:00:00Z', now=Date.parse(time);
 const marine={weather:{code:95,validAt:time},data:{status:'fresh',observation:{validAt:time,waveHeightM:1,seaSurfaceTemperatureC:10,oceanCurrentVelocityKmh:1}}};
 const navwarn={fetch:{lastSuccessAt:time},data:{status:'latest_published_notice',notice:{zoneAState:'restricted_10_knots',effectiveAt:time,appliesTo:'vessels_over_13_m'}}};
 const original=Date.now;
 try {
  for (const [failed,elapsed] of [[false,0],[true,0],[false,46*60000],[false,7*3600000],[false,0]] as const) {
   Date.now=()=>now+elapsed;
   const input=adaptNowReads({ais:null,whoi:null,marine:failed?retainReading(marine,null):marine,navwarn:failed?retainReading(navwarn,null):navwarn});
   const state=buildSceneState(input);
   assert.equal(state.mode,'now');
   if(state.mode!=='now') throw Error('wrong mode');
   const ask=async(question:string)=>(await submitSceneQuestion({question,mode:'live',selectedTimeMs:now,previousEvidenceIds:[],liveState:state},async()=>{throw Error('unexpected network')})).answer!;
   const sea=await ask('What marine values are stored?');
   assert.match(sea,/WMO code 95/); assert.match(sea,/2026-11-04T16:00:00Z/);
   const notice=await ask('What restriction is listed?'); assert.match(notice,/10 knots.*13 metres/);
   assert.equal(freshWeather(state.marine?.weather,Date.now()),!failed && elapsed===0);
   if(failed) {assert.match(sea,/last known.*refresh failed|refresh failed.*last known/i);assert.match(notice,/current conditions unverified/);}
   if(elapsed>0) assert.equal(state.marine?.state,'stale');
   if(elapsed>6*3600000) assert.equal(state.restriction.status,'unverified');
  }
 } finally {Date.now=original;}
});
