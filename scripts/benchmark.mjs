// Isolated HTTP/PostgreSQL comparison. Never load-test production or live providers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import pg from 'pg';
import Fastify from 'fastify';
import { performance } from 'node:perf_hooks';
import { createRuntimePool } from '../server/database.ts';
import { registerApiProtection } from '../server/api-protection.ts';
import { registerReplayRoute } from '../server/replay.ts';
import { registerAisRoute } from '../server/ais-routes.ts';
import { registerDomainRoutes } from '../server/domain-routes.ts';
import { registerQuestionRoutes } from '../server/question-routes.ts';
import { registerAgentRoutes } from '../server/agent.ts';
import { reserveAiCall } from '../server/ai-budget.ts';
import { importStoryEnding } from '../server/story-ending.ts';
import { parseGfwSnapshot } from '../server/gfw.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname))
  throw new Error('TEST_DATABASE_URL must identify an isolated localhost database.');
const output = process.argv[2];
if (!output) throw new Error('Provide a JSON result path.');
const schema = `perf_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString });
let fixture;
const percentile = (values, p) => values.length ? [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.ceil(values.length*p)-1)] : null;
const round = n => n == null ? null : Math.round(n * 100) / 100;

async function seed() {
  await admin.query(`CREATE SCHEMA ${schema}`);
  fixture = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  await fixture.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const names=['zone_a_presence_2026-09-13_2026-09-17.json','zone_a_presence_speed_at_or_below_10kn.json','zone_a_presence_speed_above_10kn.json'];
  const input=await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(`../data/gfw/${name}`,import.meta.url),'utf8'))));
  for(const row of parseGfwSnapshot(...input)) await fixture.query(`INSERT INTO historical_presence
    (id,source,source_record_id,kind,zone_id,event_at,latitude,longitude,vessel_id,speed_band_group,source_url,raw_reference,raw_payload)
    VALUES ($1,'global_fishing_watch',$2,'gfw_vessel_presence_hour','zone_a',$3,$4,$5,$6,$7,'https://example.test/gfw',$8,$9)`,
    [row.id,row.sourceRecordId,row.eventAt,row.latitude,row.longitude,row.vesselId,row.speedBandGroup,row.rawReference,row.rawPayload]);
  await importStoryEnding(fixture);
  await fixture.query(`INSERT INTO whoi_detections (id,source,source_record_id,zone_id,review_date,source_local_time,
    occurrence,platform_latitude,platform_longitude,source_url,raw_text,last_fetched_at) VALUES
    ('whoi:benchmark','whoi_robots4whales','benchmark','zone_a','2026-09-14','2026-09-14 15:23:53',
    'detected',49.358,-64.687,'https://example.test/whoi','LOCAL BENCHMARK FIXTURE',now())`);
  await fixture.query(`INSERT INTO ais_connection_status (source,state,checked_at) VALUES ('aisstream','disconnected',now())`);
}

async function run(variant, workload, repeat) {
  const protectedVariant = variant === 'protected';
  const config={connectionString,options:`-c search_path=${schema}`,max:5,connectionTimeoutMillis:10000,query_timeout:7000};
  const db=protectedVariant ? createRuntimePool(config) : new pg.Pool(config);
  let wireQueries=0, checkedOut=0, peakCheckedOut=0, peakConnections=0;
  db.on('connect', client => {
    client.query=new Proxy(client.query,{apply(target,thisArg,args){wireQueries++;return Reflect.apply(target,thisArg,args);}});
  });
  db.on('acquire',()=>{checkedOut++;peakCheckedOut=Math.max(peakCheckedOut,checkedOut);peakConnections=Math.max(peakConnections,db.totalCount);});
  db.on('release',()=>{checkedOut--;});
  await db.query('SELECT 1'); wireQueries=0; peakCheckedOut=0;
  const app=Fastify({handlerTimeout:15000,logger:false});
  const guard=protectedVariant ? registerApiProtection(app) : null;
registerReplayRoute(app,db); registerAisRoute(app,db); registerDomainRoutes(app,db);
registerQuestionRoutes(app,db);
registerAgentRoutes(app,db,async()=>{
    await new Promise(resolve=>setTimeout(resolve,4));
    return {id:'local-model-stub',status:'completed',output:[{type:'function_call',name:'get_latest_detection',arguments:'{}',call_id:'one'}]};
  },identity=>reserveAiCall(db,identity,{clientCalls:100,clientWindowSeconds:600,siteCalls:1000,siteWindowSeconds:3600,
    concurrency:2,totalCalls:10000,identitySecret:'LOCAL-BENCHMARK-NOT-A-PRODUCTION-SECRET'}));
  app.get('/api/health',async()=>({database:(await db.query('SELECT 1 AS ready')).rows[0].ready}));
  await app.ready();
  // Use inject rather than Node fetch: after the body is read, fetch leaves Fastify's
  // request.signal aborted, which makes paid questions report model_timeout incorrectly.
  const count=workload==='questions'?6:workload==='overload'?240:80;
  const concurrency=workload==='questions'?2:workload==='overload'?48:8;
  const path=workload==='story'||workload==='overload'?'/api/story/replay':workload==='live'?'/api/current/ais':'/api/ask';
  const askPayload=workload==='questions'?{method:'POST',url:path,headers:{'content-type':'application/json'},payload:{question:'When was the latest indexed detection?'}}:{method:'GET',url:path};
  let next=0, rssPeak=process.memoryUsage().rss;
  const statuses={}, cacheStates={}, cacheAges=[], latencies=[], successful=[];let correctnessErrors=0;
  const sampler=setInterval(()=>{rssPeak=Math.max(rssPeak,process.memoryUsage().rss);},5);
  const cpu=process.cpuUsage(), began=performance.now();
  try {
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(next++<count){
        const start=performance.now();
        const response=await app.inject(askPayload);
        const body=response.json(); const latency=performance.now()-start;
        const cacheState=response.headers['x-data-cache'];
        if(cacheState)cacheStates[cacheState]=(cacheStates[cacheState]??0)+1;
        const cachedAt=Date.parse(response.headers['x-data-cached-at']??'');
        if(Number.isFinite(cachedAt))cacheAges.push(Date.now()-cachedAt);
        statuses[response.statusCode]=(statuses[response.statusCode]??0)+1;latencies.push(latency);
        if(response.statusCode===200){successful.push(latency);
          if((workload==='story'||workload==='overload')&&(body.status!=='ready'||body.presence.length!==358))correctnessErrors++;
          if(workload==='live'&&(body.data.status!=='unknown'||body.data.positions.length!==0))correctnessErrors++;
          if(workload==='questions'&&!body.evidenceIds?.includes('whoi:benchmark'))correctnessErrors++;
        }
      }
    }));
    const elapsedMs=performance.now()-began, usedCpu=process.cpuUsage(cpu);
    const measuredWireQueries=wireQueries;
    const health=await app.inject('/api/health');assert.equal(health.statusCode,200);
    if(protectedVariant&&workload==='overload')await new Promise(resolve=>setTimeout(resolve,1100));
    const recovered=await app.inject(askPayload);
    assert.equal(recovered.statusCode,200);
    assert.equal(correctnessErrors,0);
    const result={variant,workload,repeat,count,concurrency,statuses,correctnessErrors,elapsedMs:round(elapsedMs),
      offeredCompletionRps:round(count/elapsedMs*1000),successfulRps:round(successful.length/elapsedMs*1000),
      allLatencyMs:{p50:round(percentile(latencies,.5)),p95:round(percentile(latencies,.95)),p99:round(percentile(latencies,.99))},
      successfulLatencyMs:{p50:round(percentile(successful,.5)),p95:round(percentile(successful,.95)),p99:round(percentile(successful,.99))},
      cacheStates,maxReadCacheAgeMs:cacheAges.length?Math.max(...cacheAges):null,wireQueryCalls:measuredWireQueries,peakCheckedOutConnections:peakCheckedOut,peakPoolConnections:peakConnections,
      cpuMsCombined:round((usedCpu.user+usedCpu.system)/1000),rssPeakBytesCombined:rssPeak,
      protection:guard?.snapshot()??null,healthPassed:true,recoveryPassed:true};
    console.log(JSON.stringify(result));return result;
  }finally{clearInterval(sampler);await app.close();await db.end();}
}

try {
  await seed();
  const results=[];
  for(const workload of ['story','live','questions','overload'])for(let repeat=1;repeat<=3;repeat++){
    for(const variant of repeat%2?['baseline','protected']:['protected','baseline'])results.push(await run(variant,workload,repeat));
  }
  const report={createdAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,
    logicalCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),postgres:(await admin.query('SHOW server_version')).rows[0].server_version},
    configuration:{poolMax:5,storyRows:358,fixtureWhaleRows:1,livePositions:0,model:'4ms local tool-selection stub; no provider calls',
      normalRequests:80,normalConcurrency:8,questionRequests:6,questionConcurrency:2,overloadRequests:240,overloadConcurrency:48,repeats:3,
      baseline:'raw pg.Pool, no SEC-01 admission/cache; same routes and local AI reservation policy',
      protected:'SEC-01 admission, fixed-read cache/coalescing and transaction-local query deadlines',
      caveats:['Loopback HTTP/local PostgreSQL, not Render or Neon capacity','CPU/RSS include server and load generator in one Node process; database CPU not measured',
        'SQL query-call counts include BEGIN/SET/COMMIT and AI admission, not only reads','Short burst experiment; not a sustained load test',
        'Local fixture identities/allowances, no paid model or upstream feed','Protected overload rejections are reported separately from successful responses']},results};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
}finally{await fixture?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
