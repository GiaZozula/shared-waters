// Credential-free local simulation of MediaQueryList changes; never shipped.
import { createServer } from 'vite';
const script = `
const nativeMatch = window.matchMedia.bind(window);
let reduced = new URLSearchParams(location.search).get('fixtureReduced') === '1';
const lists = new Set();
window.matchMedia = query => {
  if (query !== '(prefers-reduced-motion: reduce)') return nativeMatch(query);
  const list = new EventTarget();
  Object.defineProperties(list, { matches: {get:()=>reduced}, media:{value:query}, onchange:{writable:true,value:null} });
  list.addListener = cb => list.addEventListener('change',cb);
  list.removeListener = cb => list.removeEventListener('change',cb);
  lists.add(list); return list;
};
// Apply the app's actual reduced-motion CSS blocks to the same simulated value.
// This changes fixture CSSOM only, not the browser/OS preference.
const rules = new Map();
function applyStyles() {
  function scan(entries) { for (const rule of entries) {
    if (rule instanceof CSSMediaRule && /prefers-reduced-motion/.test(rule.conditionText)) rules.set(rule,rule.conditionText);
    else if (rule.cssRules) scan(rule.cssRules);
  }}
  for (const sheet of document.styleSheets) { try { scan(sheet.cssRules); } catch {} }
  for (const [rule] of rules) rule.media.mediaText = reduced ? 'all' : 'not all';
}
function setReduced(value) {
  reduced = value; applyStyles();
  document.documentElement.dataset.fixtureReduced = String(reduced);
  for (const list of lists) { const event = new Event('change'); Object.defineProperties(event,{matches:{value:reduced},media:{value:list.media}}); list.dispatchEvent(event); list.onchange?.(event); }
}
addEventListener('DOMContentLoaded',()=>{
  const panel = document.createElement('aside'); panel.setAttribute('aria-label','Motion fixture');
  panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9999;padding:12px;background:#fff;color:#000;font:12px monospace';
  const label = document.createElement('p'); label.textContent='Local simulated preference (not OS)'; panel.append(label);
  for(const [name,value] of [['Reduce motion',true],['Resume motion',false]]) {const button=document.createElement('button');button.textContent=name;button.onclick=()=>setReduced(value);panel.append(button)}
  document.body.append(panel); setReduced(reduced);
  new MutationObserver(applyStyles).observe(document.head,{childList:true,subtree:true});
});
`;
const server = await createServer({ server:{host:'127.0.0.1',port:5185,strictPort:true}, plugins:[{
  name:'motion-fixture',
  configureServer(server) { server.middlewares.use((req,res,next)=>{
    if(req.url?.startsWith('/api/')) {res.statusCode=503;res.setHeader('Content-Type','application/json');res.end('{"error":"fixture_service_unavailable"}');return}
    if(req.url==='/fixture-motion.js') {res.setHeader('Content-Type','application/javascript');res.end(script);return}
    next();
  })},
  transformIndexHtml(){return [{tag:'script',attrs:{src:'/fixture-motion.js'},injectTo:'head-prepend'}]},
}] });
await server.listen();
console.log('Local motion fixture: http://127.0.0.1:5185/?mode=story&motionStats&fixtureReduced=1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0)});
