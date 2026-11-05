import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWhoiReview, parseWhoiReviewLinks } from './whoi.js';

const mission = `<h2>Daily analyst review</h2><a href="dal2606_sable_html/dal2606_sable_manual_analysis_table_20260924.html">09/24/2026</a>
<a href="dal2606_sable_html/dal2606_sable_manual_analysis_table_20260914.html">09/14/2026</a>`;
const url = 'https://dcs.whoi.edu/dal2606/dal2606_sable_html/dal2606_sable_manual_analysis_table_20260914.html';
const review = `<h3>Fin whale:</h3><table><tr><td>Date/time (local)</td></tr>
<tr><td>09/14/26 12:23:53</td><td>Detected</td><td>49.35</td><td>-64.7</td></tr></table>
<h3>Right whale:</h3><table><tr><th>Date/time (local)</th><th>Occurrence</th><th>Latitude</th><th>Longitude</th><th>Notes</th></tr>
<tr><td><a>09/14/26 15:23:53</a></td><td>Detected</td><td>49.3576</td><td>-64.6864</td><td>Strong evidence</td></tr>
<tr><td><a>09/14/26 15:38:53</a></td><td>Detected</td><td>49.3585</td><td>-64.6886</td><td>Three upcalls</td></tr></table><h3>Blue whale:</h3>`;

test('WHOI dated links and right-whale records preserve source-local time and glider coordinates', () => {
  const links = parseWhoiReviewLinks(mission);
  assert.equal(links[0].day, '2026-09-24');
  const parsed = parseWhoiReview(review, '2026-09-14', url);
  assert.equal(parsed.detections.length, 2);
  assert.equal(parsed.detections[0].sourceLocalTime, '2026-09-14 15:23:53');
  assert.equal(parsed.detections[0].platformLatitude, 49.3576);
});

test('WHOI empty latest review is valid, malformed detection row is not', () => {
  const empty = parseWhoiReview('<h3>Right whale:</h3><table><tr><th>Date/time (local)</th><th>Occurrence</th><th>Latitude</th><th>Longitude</th></tr></table>',
    '2026-09-24', url.replace('20260914', '20260924'));
  assert.equal(empty.detections.length, 0);
  assert.throws(() => parseWhoiReview(review.replace('49.3576', '99'), '2026-09-14', url));
  assert.throws(() => parseWhoiReview(review.replace('09/14/26 15:38:53', '09/14/26 at 15:38:53'), '2026-09-14', url));
  assert.throws(() => parseWhoiReview(review.replace('09/14/26 15:38:53', '09/14/26 15:23:53'), '2026-09-14', url));
  assert.throws(() => parseWhoiReview('<p>error page</p>', '2026-09-14', url));
});


test('WHOI refuses an unrelated species table instead of accepting an unreviewed zero', () => {
  assert.throws(() => parseWhoiReview('<h3>Fin whale:</h3><table><tr><th>Date/time (local)</th></tr></table>',
    '2026-09-14', url), /right-whale section missing/);
  assert.throws(() => parseWhoiReview('<h3>Right whale:</h3><p>Table unavailable</p>',
    '2026-09-14', url), /unexpected page structure|table header missing/);
});


test('WHOI refuses a truncated right-whale table even when the header arrived', () => {
  assert.throws(() => parseWhoiReview('<h3>Right whale:</h3><table><tr><th>Date/time (local)</th></tr>',
    '2026-09-14', url), /table incomplete/);
});
