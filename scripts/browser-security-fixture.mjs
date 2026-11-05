// Local, credential-free browser acceptance harness. Never imported by production.
// Build first with VITE_API_BASE=http://127.0.0.1:5194 npm run build:client.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserContentSecurityPolicy } from '../shared/browser-policy.ts';
import { registerApiBoundary } from '../server/api-boundary.ts';
const origin = 'http://127.0.0.1:5183', apiOrigin = 'http://127.0.0.1:5194';
const reportOnly = process.argv.includes('--report-only');
const snapshot = JSON.parse(await readFile('data/story/snapshot.json', 'utf8'));
const hostile = '<img id="fixture-injected-node" src="/fixture/unexpected" onerror="document.title=\'UNSAFE\'">';
for (const row of snapshot.data.presence) {
  if (row.eventAt.startsWith('2026-09-13T00:')) { row.shipName = hostile; row.sourceUrl = "javascript:document.title='UNSAFE'"; }
}
snapshot.data.notices[0].sourceRecordId = 'NOTICE ' + hostile;
snapshot.data.notices[0].sourceUrl = 'data:text/html,' + encodeURIComponent(hostile);
snapshot.data.detections[0].occurrence = hostile;
snapshot.data.detections[0].sourceUrl = "java\nscript:document.title='UNSAFE'";
const site = Fastify({ logger: false }), api = Fastify({ logger: false });
const requests = [];
let questionsHandled = 0;
api.addHook('onRequest', async request => { if (requests.length < 100) requests.push({ method: request.method, path: request.url.split('?')[0] }); });
registerApiBoundary(api, { allowedOrigins: [origin] });
api.get('/api/wake', async () => ({ service:'shared-waters', api:'connected', database:'connected' }));
api.get('/api/health', async () => ({ api:'connected', database:'connected' }));
api.get('/api/story/replay', async () => snapshot.data);
api.get('/api/historical/presence', async () => ({total:snapshot.data.presence.length,limit:1,offset:0,records:snapshot.data.presence.slice(0,1)}));
api.get('/api/ask/status', async () => ({configured:true,enabled:true}));
api.get('/api/current/ais', async (_request, reply) => reply.code(503).send({error:'fixture_ais_unavailable'}));
const fetchState = {status:'error', checkedAt:'2026-11-03T00:00:00Z',lastSuccessAt:null,error:'FIXTURE unavailable, not zero'};
api.get('/api/current/marine', async () => ({sourceUrl:'javascript:alert(1)',fetch:fetchState,data:{status:'missing',observation:null}}));
api.get('/api/current/whoi', async () => ({fetch:fetchState,note:hostile,data:{status:'unverified',latestReview:{reviewDate:'2026-09-14',detectionCount:2,sourceUrl:'data:text/html,unsafe'},indexedDetections:snapshot.data.detections}}));
api.get('/api/current/navwarn', async () => ({fetch:fetchState,note:hostile,data:{status:'unverified',notice:snapshot.data.notices[0]}}));
api.post('/api/ask', async () => { questionsHandled++; return {answer:'HOSTILE TEXT ' + hostile,evidenceIds:['fixture:hostile'],warnings:[hostile]}; });
api.get('/api/query/evidence', async () => ({record:{id:'fixture:hostile',kind:'gfw_presence',shipName:hostile,sourceUrl:'javascript:alert(1)',eventAt:'2026-09-13T00:00:00Z',latitude:49.3,longitude:-64.4,speedBandGroup:'bands_from_10_up'}}));
site.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options','nosniff');reply.header('Referrer-Policy','no-referrer');
  reply.header('Content-Security-Policy',reportOnly ? "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" : browserContentSecurityPolicy(apiOrigin));
  if(reportOnly)reply.header('Content-Security-Policy-Report-Only',browserContentSecurityPolicy(apiOrigin));
  return payload;
});
const observer = `document.documentElement.dataset.securityViolations='[]';document.documentElement.dataset.fixtureErrors='[]';
addEventListener('securitypolicyviolation',e=>{let a=JSON.parse(document.documentElement.dataset.securityViolations);if(a.length<30)a.push({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition,source:e.sourceFile,line:e.lineNumber,column:e.columnNumber});document.documentElement.dataset.securityViolations=JSON.stringify(a)});
addEventListener('error',e=>{let a=JSON.parse(document.documentElement.dataset.fixtureErrors);if(a.length<20)a.push(String(e.message));document.documentElement.dataset.fixtureErrors=JSON.stringify(a)});`;
site.get('/fixture/security-observer.js',async (_request,reply)=>reply.type('text/javascript').send(observer));
site.get('/fixture/requests',async()=>({requests,questionsHandled}));
site.get('/fixture/cors-probe.js',async (_request,reply)=>reply.type('text/javascript').send(`fetch('${apiOrigin}/api/ask',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'fixture origin probe'})}).then(()=>{document.querySelector('output').textContent='unexpected success'}).catch(()=>{document.querySelector('output').textContent='blocked by browser/API boundary'});`));
site.get('/fixture/cors-probe',async (_request,reply)=>reply.type('text/html').send('<!doctype html><html><head><script src="/fixture/security-observer.js"></script><title>Local origin probe</title></head><body><h1>Local origin probe</h1><output>Waiting</output><script src="/fixture/cors-probe.js"></script></body></html>'));
site.get('/fixture/metadata',async()=>({reportOnly,origin,apiOrigin,hostilePayload:hostile}));
site.get('/fixture/unexpected',async (_request,reply)=>reply.code(409).send('Hostile markup was interpreted; this must not be requested.'));
const html = async (name,reply)=>reply.type('text/html').send((await readFile(resolve('dist',name),'utf8')).replace('<head>','<head><script src="/fixture/security-observer.js"></script>'));
site.get('/',async (_request,reply)=>html('index.html',reply));
site.get('/system',async (_request,reply)=>html('system.html',reply));
site.get('/system.html',async (_request,reply)=>html('system.html',reply));
site.get('/assets/snapshot-:fingerprint.json',async()=>snapshot);
await site.register(fastifyStatic,{root:resolve('dist'),prefix:'/',wildcard:true,index:false});
await api.listen({host:'127.0.0.1',port:5194});await site.listen({host:'127.0.0.1',port:5183});
console.log(`Credential-free fixture ready on ${origin}; ${reportOnly?'report-only':'enforced'} policy; API ${apiOrigin}.`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await site.close();await api.close();process.exit(0)});
