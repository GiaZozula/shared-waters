import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { browserContentSecurityPolicy } from '../shared/browser-policy.js';
import { registerObservability } from './observability.js';

const normalize = (policy: string) => policy.replace(/\s+/g, ' ').replace(/\s*;\s*/g, '; ').trim();
test('static and runtime policies enforce the same asset and exact API boundary', async () => {
  const template = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const staticPolicy = template.match(/^  Content-Security-Policy: (.+)$/m)![1];
  for (const origin of ['', 'https://api.shared-waters.giazozula.com', 'http://127.0.0.1:5194']) {
    assert.equal(normalize(staticPolicy.replace('__API_CONNECT_SRC__', origin)), browserContentSecurityPolicy(origin));
    const server = Fastify();
    registerObservability(server, { browserApiOrigin: origin });
    server.get('/', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>fixture</title>'));
    try {
      const response = await server.inject('/');
      assert.equal(response.headers['content-security-policy'], browserContentSecurityPolicy(origin));
      assert.equal(response.headers['content-security-policy-report-only'], undefined);
    } finally { await server.close(); }
  }
  assert.doesNotMatch(staticPolicy, /unsafe-inline|unsafe-eval/);
  assert.match(staticPolicy, /script-src-attr 'none'/);
  assert.match(browserContentSecurityPolicy('http://[::1]:5194'), /connect-src 'self' http:\/\/\[::1\]:5194/);
  assert.match(browserContentSecurityPolicy('https://café.example'), /https:\/\/xn--caf-dma.example/);
  assert.match(staticPolicy, /form-action 'self'/);
  assert.doesNotMatch(await readFile(new URL('../system.html', import.meta.url), 'utf8'), /<style|<script(?![^>]*src=)/i);
});

test('an API origin cannot inject directives or widen policy to arbitrary sources', () => {
  for (const value of ['https://api.example.test;script-src', 'https://api.example.test,evil.test', 'https://api.example.test; script-src *', 'https://api.example.test/path',
    'https://user:secret@api.example.test', 'https://*.example.test', 'http://api.example.test',
    "https://api.example.test\nscript-src 'unsafe-inline'"]) {
    assert.throws(() => browserContentSecurityPolicy(value));
  }
});
