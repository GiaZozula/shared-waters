// Experiment preload: fail closed instead of ever contacting real providers.
import http from 'node:http';
import https from 'node:https';
const allowed = new Set(['127.0.0.1', 'localhost', 'fake-upstream']);
const deny = () => { throw new Error('FORBIDDEN_EXPERIMENT_UPSTREAM'); };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol !== 'http:' || !allowed.has(url.hostname)) return Promise.reject(new Error('FORBIDDEN_EXPERIMENT_UPSTREAM'));
  return originalFetch(input, init);
};
https.request = https.get = deny;
const request = http.request;
http.request = function(input, ...args) {
  const host = input instanceof URL ? input.hostname : typeof input === 'string'
    ? new URL(input).hostname : input.hostname ?? input.host;
  if (!allowed.has(host)) return deny();
  return request.call(this, input, ...args);
};
http.get = function(input, ...args) {
  const req = http.request(input, ...args);
  req.end();
  return req;
};
