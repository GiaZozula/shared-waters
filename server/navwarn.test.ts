import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNavwarnSearch } from './navwarn.js';

const search = `<h1>Search for NAVWARNs</h1><p>Navigational Warnings</p><table>
<tr><td><a href="/public/rest/messages/en/message/185123">NW-C-3975-26</a></td><td>2026-09-15 10:40 UTC</td>
<td>Routeing Change - North Atlantic Right Whale</td><td>Effective 151230 UTC Sep 2026, the following North Atlantic Right Whale restriction Zones are in effect for all vessels greater than 13 meters in length overall: Dynamic Shipping Zones A and D: Vessels must not exceed 10 knots over ground. Dynamic Shipping Zones B, C, and E: No restriction in effect.</td></tr>
<tr><td><a href="/public/rest/messages/en/message/185999">NW-C-4078-26</a></td><td>2026-09-23 11:30 UTC</td>
<td>Routeing Change - North Atlantic Right Whale</td><td>Effective 231230 UTC Sep 2026, the following North Atlantic Right Whale restriction Zones are in effect for all vessels greater than 13 meters in length overall: Dynamic Shipping Zones A, B, and D: Vessels must not exceed 10 knots over ground. Dynamic Shipping Zones C and E: No restriction in effect. Cancels NW-C-3975-26</td></tr></table>`;

test('NAVWARN parses newest Zone A statement and distinct publication/effective times', () => {
  const notices = parseNavwarnSearch(search);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].sourceRecordId, 'NW-C-4078-26');
  assert.equal(notices[0].publishedAt, '2026-09-23T11:30:00Z');
  assert.equal(notices[0].effectiveAt, '2026-09-23T12:30:00Z');
  assert.equal(notices[0].zoneAState, 'restricted_10_knots');
  assert.equal(notices[0].cancels, 'NW-C-3975-26');
});

test('NAVWARN rejects missing Zone A, unexpected applicability and empty search', () => {
  assert.throws(() => parseNavwarnSearch(search.replaceAll('Zones A', 'Zones B')));
  assert.throws(() => parseNavwarnSearch(search.replaceAll('greater than 13 meters', 'greater than 10 meters')));
  assert.throws(() => parseNavwarnSearch('<h1>Search for NAVWARNs</h1><p>Navigational Warnings</p><table></table>'));
  assert.throws(() => parseNavwarnSearch(search.replace('Effective 231230 UTC Sep 2026', 'Effective immediately')));
});

test('NAVWARN ignores only the title-only duplicate row', () => {
  const titleOnly = '<tr><td>NW-C-4078-26</td><td>2026-09-23 11:30 UTC</td><td>4001(NAD83)</td><td>Routeing Change - North Atlantic Right Whale</td></tr>';
  assert.equal(parseNavwarnSearch(search.replace('</table>', `${titleOnly}</table>`)).length, 2);
});

test('NAVWARN preserves an explicit no-restriction statement for Zone A', () => {
  const changed = search.replace(
    'Dynamic Shipping Zones A, B, and D: Vessels must not exceed 10 knots over ground.',
    'Dynamic Shipping Zones B and D: Vessels must not exceed 10 knots over ground. Dynamic Shipping Zone A: No restriction in effect.',
  );
  assert.equal(parseNavwarnSearch(changed)[0].zoneAState, 'no_restriction_stated');
});
