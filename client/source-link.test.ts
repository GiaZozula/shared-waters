import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptEvidenceRecord } from './shared-water/world/question/askScene.js';
import { sourceLinkUrl, setSourceLink } from './source-link.js';

test('stored sources allow HTTPS provenance without accepting executable, credentialled or relative URLs', () => {
  for (const source of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '\tjavascript:alert(1)',
    'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'blob:https://example.test/id', '//example.test/source', '/source',
    'https://user:password@example.test/source', 'http://example.test/source',
    'https://example.test/\u0000source', '', undefined, null, {}, 123]) {
    assert.equal(sourceLinkUrl(source), null, String(source));
  }
  assert.equal(sourceLinkUrl(' https://dcs.whoi.edu/source?date=2026-09-14#record '), 'https://dcs.whoi.edu/source?date=2026-09-14#record');
  assert.equal(sourceLinkUrl('https://example.test/?text=%3Cimg%20src=x%3E'), 'https://example.test/?text=%3Cimg%20src=x%3E');
});

test('a failed source refresh clears an earlier safe link instead of retaining a dangerous href', () => {
  const attributes = new Map<string, string>();
  const link = { set href(value: string) { attributes.set('href', value); },
    set rel(value: string) { attributes.set('rel', value); }, removeAttribute(name: string) { attributes.delete(name); } } as HTMLAnchorElement;
  setSourceLink(link, 'https://example.test/record');
  assert.equal(attributes.get('href'), 'https://example.test/record');
  assert.equal(attributes.get('rel'), 'noopener noreferrer');
  setSourceLink(link, 'javascript:alert(1)');
  assert.equal(attributes.has('href'), false);
});

test('question evidence drops an unsafe link while preserving its stored time text', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const record = adaptEvidenceRecord({ record: { id:'fixture:one',kind:'gfw_presence',sourceUrl:'javascript:alert(1)',eventAt:hostile } });
  assert.ok(record);
  assert.equal(record.sourceUrl,undefined);
  assert.equal(record.eventAt,hostile);
});
