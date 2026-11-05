import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTools, toolUrl } from './agent.js';
import { supportsInternalRead } from './internal-read.js';
test('every validated tool URL is admitted by internal-read policy', () => {
 const args: Record<string, Record<string, unknown>> = {
  get_restriction_at: {at:'2026-09-15T13:00:00Z'}, get_detections_on_date:{date:'2026-09-14'},
  get_evidence_by_id:{id:'whoi:example'}, explain_records:{topic:'all'},
  compare_presence_bands:{beforeStart:'2026-09-14T00:00:00Z',beforeEnd:'2026-09-14T01:00:00Z',afterStart:'2026-09-15T00:00:00Z',afterEnd:'2026-09-15T01:00:00Z'}
 };
 for (const tool of agentTools) {
  const url = toolUrl(tool.name as never, args[tool.name] ?? {});
  assert.ok(url, tool.name); assert.ok(supportsInternalRead(url), url);
 }
});
