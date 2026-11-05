import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const { WebSocketServer } = require('ws');
let connections = 0, active = 0, peak = 0;
const requests = { marine: 0, weather: 0, whoi: 0, navwarn: 0 };
const events = [];
const at = new Date().toISOString();
const frame = JSON.stringify({ MessageType: 'PositionReport',
  MetaData: { MMSI: 316123456, ShipName: 'SCALE FIXTURE', time_utc: at },
  Message: { PositionReport: { UserID: 316123456, Latitude: 49.35, Longitude: -64.7,
    Sog: 8.2, Timestamp: new Date(at).getUTCSeconds(), Valid: true } } });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/metrics') return res.end(JSON.stringify({ connections, active, peak, requests, events }));
  const feed = req.url?.slice(1);
  if (!(feed in requests)) { res.statusCode = 404; return res.end('{}'); }
  requests[feed]++;
  res.end(JSON.stringify(feed === 'marine' ? {
    latitude: 49.35, longitude: -64.7, timezone: 'GMT', utc_offset_seconds: 0,
    current_units: { wave_height: 'm', sea_surface_temperature: '°C', ocean_current_velocity: 'km/h' },
    current: { time: at.slice(0, 16), interval: 900, wave_height: 1, sea_surface_temperature: 8, ocean_current_velocity: 1 },
  } : feed === 'weather' ? {
    latitude: 49.35, longitude: -64.7, timezone: 'GMT', utc_offset_seconds: 0,
    current_units: { weather_code: 'wmo code', cloud_cover: '%', wind_speed_10m: 'km/h' },
    current: { time: at.slice(0, 16), interval: 900, weather_code: 63, cloud_cover: 90, wind_speed_10m: 25 },
  } : {}));
});
const ws = new WebSocketServer({ server });
ws.on('connection', socket => {
  active++; connections++; peak = Math.max(peak, active);
  events.push({ at: Date.now(), active, event: 'open' });
  socket.once('message', () => {
    socket.send(JSON.stringify({ MessageType: 'SubscriptionConfirmation' }));
    socket.send(frame); socket.send(frame);
  });
  socket.once('close', () => { active--; events.push({ at: Date.now(), active, event: 'close' }); });
});
server.listen(Number(process.env.PORT ?? 0), '0.0.0.0', () => {
  console.log(`FIXTURE_READY http://127.0.0.1:${server.address().port}`);
});
const close = () => { for (const client of ws.clients) client.terminate(); ws.close(); server.close(); };
process.once('SIGTERM', close); process.once('SIGINT', close);
