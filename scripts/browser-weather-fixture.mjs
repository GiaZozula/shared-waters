// Local, credential-free weather acceptance preview. No provider or database access.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const cases = { clear: [0, 12, 8, 0.3], overcast: [3, 90, 18, 0.8], rain: [63, 95, 28, 1.5], storm: [95, 100, 55, 3] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const preview = `<script>
const scenario = new URLSearchParams(location.search).get('weather') || 'clear';
const originalFetch = window.fetch.bind(window);
window.fetch = (url, init) => originalFetch(typeof url === 'string' && url.startsWith('/api/') ? url + (url.includes('?') ? '&' : '?') + 'weather=' + scenario : url, init);
</script>`;
http.createServer(async (req, res) => {
 try {
 const url = new URL(req.url, 'http://127.0.0.1');
 if (url.pathname.startsWith('/api/')) {
  res.setHeader('Content-Type', 'application/json');
  const now = new Date().toISOString(), item = cases[url.searchParams.get('weather') || 'clear'];
  let body = {};
  if (url.pathname === '/api/wake') body = { service:'shared-waters', api:'connected', database:'connected' };
  else if (url.pathname === '/api/current/marine') body = { weather:item ? {code:item[0], cloudCover:item[1], windSpeedKmh:item[2], validAt:now}:null, fetch:{status:'success',lastSuccessAt:now},data:{status:'fresh',observation:{waveHeightM:item?.[3] ?? 0.5,seaSurfaceTemperatureC:10,oceanCurrentVelocityKmh:1,validAt:now}} };
  else if (url.pathname === '/api/current/ais') body = {connection:{status:'connected'},data:{status:'no_recent_positions',positions:[]}};
  else if (url.pathname === '/api/health') body = {api:'connected',database:'connected'};
  else if (url.pathname === '/api/historical/presence') body = {total:358,records:[]};
  else if (url.pathname === '/api/ask/status') body = {configured:false};
  else if (url.pathname === '/api/story/replay') { body = JSON.parse(await readFile('data/story/snapshot.json','utf8')).data; }
  else { res.statusCode=503; body={error:'weather_preview_other_source_unavailable'}; }
  res.end(JSON.stringify(body)); return;
 }
 const path = ['/system', '/system/'].includes(url.pathname) ? '/system.html' : url.pathname === '/' ? '/index.html' : url.pathname;
 const full = resolve(root, '.'+path);
 if (!full.startsWith(root+'/')) throw Error();
 let body = await readFile(full);
 if (path === '/index.html') body = Buffer.from(body.toString().replace('</head>', preview+'</head>'));
 res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(body);
 } catch { res.statusCode=404; res.end('Not found'); }
}).listen(4891,'127.0.0.1',()=>console.log('Weather preview: http://127.0.0.1:4891/?mode=live&weather=clear'));
