import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptEvidenceRecord, answerLead, askFailureNotice, askWarningLines, evidenceQueryUrl, focusableEvidenceId, submitSceneQuestion } from './shared-water/world/question/askScene.js';

const gfwId = 'gfw:2026-09-15T14:00:00Z/vessel-a';

test('ask sends the selected time and previous evidence ids, then loads each encoded id', async () => {
  const calls: { url: string; body?: { question: string; mode: 'story' | 'live'; zoneId: string; selectedTime?: string | null; previousEvidenceIds: string[] } }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body
      ? JSON.parse(String(init.body)) as { question: string; mode: 'story' | 'live'; zoneId: string; selectedTime: string | null; previousEvidenceIds: string[] }
      : undefined;
    calls.push({ url, body });
    if (url === '/api/ask') {
      return new Response(JSON.stringify({
        answer: 'A stored notice is not verified as current.',
        evidenceIds: [gfwId],
        selectedTime: '2026-09-15T16:40:00Z',
        viewAction: 'compare_presence_bands',
        warnings: ['These are source speed categories, not exact speeds.'],
        facts: { compare_presence_bands: { latitude: 49.3, longitude: -64.4 } },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      record: {
        id: gfwId,
        kind: 'gfw_presence',
        eventAt: '2026-09-15T14:00:00Z',
        speedBandGroup: 'bands_from_10_up',
        latitude: 49.3,
        longitude: -64.4,
        sourceUrl: 'https://example.com/gfw',
      },
    }), { status: 200 });
  };

  const result = await submitSceneQuestion({
    question: 'what restriction applied?',
    mode: 'story',
    selectedTimeMs: Date.parse('2026-09-15T16:40:00.400Z'),
    previousEvidenceIds: ['navwarn:one', 'navwarn:one'],
  }, fetchImpl);

  assert.equal(calls[0].url, '/api/ask');
  assert.equal(calls[0].body?.question, 'what restriction applied?');
  assert.equal(calls[0].body?.mode, 'story');
  assert.equal(calls[0].body?.zoneId, 'zone_a');
  assert.equal(calls[0].body?.selectedTime, '2026-09-15T16:40:00Z');
  assert.deepEqual(calls[0].body?.previousEvidenceIds, ['navwarn:one']);
  assert.equal(calls[1].url, evidenceQueryUrl(gfwId));
  assert.equal(calls[1].url, `/api/query/evidence?id=${encodeURIComponent(gfwId)}`);
  assert.equal(result.answer, 'A stored notice is not verified as current.');
  assert.equal(result.notice, null);
  assert.deepEqual(result.warnings, ['These are source speed categories, not exact speeds.']);
  assert.equal(result.viewAction, 'compare_presence_bands');
  assert.equal(result.evidence[0].id, gfwId);
  assert.equal(result.evidence[0].source, 'Global Fishing Watch');
  assert.equal(result.evidence[0].eventAt, '2026-09-15T14:00:00Z');
  assert.equal(result.evidence[0].limitation, 'A GFW row is one vessel-hour, not a track or an exact speed.');
  assert.equal(result.evidence[0].observedAt, undefined);
  assert.equal(result.evidence[0].observation, undefined);
  assert.deepEqual(result.previousEvidenceIds, [gfwId]);
  assert.equal(Object.hasOwn(result, 'facts'), false);
  assert.equal(Object.hasOwn(result, 'selectedTime'), false);
});

test('live mode omits historical selected time and still loads cited evidence', async () => {
  const sent: Record<string, unknown> = {};
  const calls: string[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(_input));
    if (String(_input) !== '/api/ask') {
      return new Response(JSON.stringify({ record: {
        id: 'navwarn:live', kind: 'navwarn_notice',
        effectiveAt: '2026-09-15T12:30:00Z',
        sourceUrl: 'https://example.com/navwarn',
      } }), { status: 200 });
    }
    Object.assign(sent, JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      answer: 'Zone A is restricted to 10 knots for vessels over 13 m.',
      evidenceIds: ['navwarn:live'],
    }), { status: 200 });
  };

  const result = await submitSceneQuestion({
    question: 'Is Zone A restricted now?',
    mode: 'live',
    selectedTimeMs: Date.parse('2026-09-15T16:40:00Z'),
    previousEvidenceIds: [],
  }, fetchImpl);

  assert.equal(Object.hasOwn(sent, 'selectedTime'), false);
  assert.deepEqual(calls, ['/api/ask', '/api/query/evidence?id=navwarn%3Alive']);
  assert.equal(result.answer, 'Zone A is restricted to 10 knots for vessels over 13 m.');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].id, 'navwarn:live');
  assert.equal(result.evidence[0].source, 'Canadian Coast Guard NAVWARN');
  assert.equal(result.evidence[0].effectiveAt, '2026-09-15T12:30:00Z');
  assert.deepEqual(result.previousEvidenceIds, ['navwarn:live']);
});

test('error statuses show error or reason and do not keep an answer', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    answer: 'This body is not an answer.',
    error: 'selected_time_mismatch',
    reason: 'tool instant disagreed',
    evidenceIds: ['navwarn:one'],
    viewAction: 'get_restriction_at',
  }), { status: 409 });

  const result = await submitSceneQuestion({
    question: 'what restriction applied?',
    mode: 'story',
    selectedTimeMs: Date.parse('2026-09-15T16:40:00Z'),
    previousEvidenceIds: ['navwarn:kept'],
  }, fetchImpl);

  assert.equal(result.answer, null);
  assert.equal(result.notice, 'The notice time did not match the moment selected in the scene, so no reading was used.');
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.evidenceIds, []);
  assert.deepEqual(result.previousEvidenceIds, ['navwarn:kept']);
  assert.equal(result.viewAction, null);
});

test('evidence keeps present times and kind limitations without invented positions', () => {
  assert.deepEqual(adaptEvidenceRecord({
    zoneId: 'zone_a',
    evidenceIds: ['whoi:one'],
    record: {
      id: 'whoi:one',
      kind: 'whoi_detection',
      sourceLocalTime: '2026-09-14 15:38:53',
      occurrence: 'detected',
      platformLatitude: 49.35,
      platformLongitude: -64.68,
      sourceUrl: 'https://example.com/whoi',
    },
  }), {
    id: 'whoi:one',
    source: 'WHOI / Robots4Whales',
    sourceUrl: 'https://example.com/whoi',
    sourceLocalTime: '2026-09-14 15:38:53',
    limitation: 'Coordinates locate the glider, not a whale. The time is source-local.',
  });

  assert.deepEqual(adaptEvidenceRecord({
    record: {
      id: 'navwarn:one',
      kind: 'navwarn_notice',
      publishedAt: '2026-09-15T11:00:00Z',
      effectiveAt: '2026-09-15T12:30:00Z',
      zoneAState: 'restricted_10_knots',
      appliesTo: 'vessels_over_13_m',
      sourceUrl: 'https://example.com/notice',
    },
  }), {
    id: 'navwarn:one',
    source: 'Canadian Coast Guard NAVWARN',
    sourceUrl: 'https://example.com/notice',
    effectiveAt: '2026-09-15T12:30:00Z',
    limitation: 'A notice is not a compliance determination.',
  });

  assert.deepEqual(adaptEvidenceRecord({
    record: {
      id: 'ais:one',
      kind: 'ais_position',
      observedAt: '2026-09-25T12:00:00Z',
      receivedAt: '2026-09-25T12:00:04Z',
      speedKnots: 9.5,
      latitude: 49.2,
      longitude: -64.1,
      shipName: 'Example',
      sourceUrl: 'https://example.com/ais',
    },
  }), {
    id: 'ais:one',
    source: 'AISStream',
    sourceUrl: 'https://example.com/ais',
    observedAt: '2026-09-25T12:00:00Z',
    receivedAt: '2026-09-25T12:00:04Z',
    limitation: 'An AIS speed is not a compliance finding.',
  });
});

test('failure codes and warning codes become sentences', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: 'invalid_tool_arguments',
    evidenceIds: ['navwarn:one'],
  }), { status: 400 });
  const result = await submitSceneQuestion({
    question: 'what restriction applied?',
    mode: 'live',
    selectedTimeMs: Date.parse('2026-09-15T16:40:00Z'),
    previousEvidenceIds: ['navwarn:kept'],
  }, fetchImpl);
  assert.equal(result.answer, null);
  assert.match(result.notice ?? '', /could not be matched to a stored reading/);
  assert.equal(result.notice?.includes('invalid_tool_arguments'), false);
  assert.equal(askFailureNotice({ error: 'agent_unavailable', reason: 'missing_model_key' }, 503),
    'Questions are not configured on this server yet.');
  assert.equal(askFailureNotice({ error: 'domain_query_failed', domainError: 'marine_data_unavailable' }, 503),
    'Marine model values could not be read just now.');
  assert.equal(askFailureNotice({ error: 'Question route unavailable.' }, 0), 'Question route unavailable.');
  assert.deepEqual(askWarningLines({ warnings: ['unsupported_question', 'These are source speed categories, not exact speeds.'] }), [
    'This question asks for something these records do not establish.',
    'These are source speed categories, not exact speeds.',
  ]);
  assert.match(answerLead(`${'Stored evidence. '.repeat(40)}Second sentence stays in the panel.`), /^Stored evidence\./);
});

test('viewAction focuses a loaded record only when it is a tool name', () => {
  const loaded = new Set(['whoi:one', 'gfw:hour']);
  assert.equal(focusableEvidenceId('get_latest_detection', ['navwarn:one', 'whoi:one'], loaded), 'whoi:one');
  assert.equal(focusableEvidenceId('whoi:one', ['whoi:one'], loaded), null);
  assert.equal(focusableEvidenceId('49.3,-64.4', ['gfw:hour'], loaded), null);
  assert.equal(focusableEvidenceId('get_evidence_by_id', ['missing'], loaded), null);
});


test('free explanations work without fetch; measurement questions still use the API', async () => {
  let calls = 0;
  const offline = async () => { calls++; throw new Error('offline'); };
  const base = { mode: 'story' as const, selectedTimeMs: Date.parse('2026-09-15T16:00:00Z'), previousEvidenceIds: [] };
  for (const question of ['what does a whale detection mean?', 'what is a vessel-hour?', 'what do these records not tell us?', 'what is Shared Waters?']) {
    const result = await submitSceneQuestion({ ...base, question }, offline);
    assert.equal(result.notice, null);
    assert.ok(result.answer);
    assert.equal(result.viewAction, 'explain_records');
  }
  assert.equal(calls, 0);
  const result = await submitSceneQuestion({ ...base, question: 'latest whale detection?' }, offline);
  assert.equal(calls, 1);
  assert.match(result.notice!, /Model questions are unavailable/);
});

test('offline questions do not fetch, and a paid question keeps its mode and site remainder', async () => {
  let calls = 0;
  let mode = '';
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    mode = JSON.parse(String(init?.body)).mode;
    return new Response(JSON.stringify({ answer: 'Fixture model answer.', evidenceIds: [] }), {
      status: 200,
      headers: { 'X-AI-Remaining-Calls': '240' },
    });
  };
  const base = { mode: 'story' as const, selectedTimeMs: Date.parse('2026-09-15T16:00:00Z'), previousEvidenceIds: [] as string[] };
  const explanation = await submitSceneQuestion({ ...base, question: 'what is a vessel-hour?', network: 'local-only' }, fetchImpl);
  assert.equal(explanation.answerBasis, 'explanation');
  const replay = {
    zoneId: 'zone_a', start: '2026-09-13T00:00:00Z', end: '2026-09-20T00:00:00Z', status: 'ready' as const,
    presence: [], notices: [], note: '',
    detections: [{ id: 'whoi:1', reviewDate: '2026-09-14', sourceLocalTime: '2026-09-14T15:23:53', occurrence: 'upcall', platformLatitude: 49, platformLongitude: -64, sourceUrl: 'https://example.com/whoi' }],
  };
  const saved = await submitSceneQuestion({ ...base, question: 'latest whale detection?', storyReplay: replay, network: 'local-only' }, fetchImpl);
  assert.equal(saved.answerBasis, 'story');
  const unmatched = await submitSceneQuestion({ ...base, question: 'how many whales are swimming now?', network: 'local-only' }, fetchImpl);
  assert.match(unmatched.notice ?? '', /needs the model/);
  assert.equal(calls, 0);
  const paid = await submitSceneQuestion({ ...base, mode: 'live', question: 'how many whales are swimming now?' }, fetchImpl);
  assert.equal(calls, 1);
  assert.equal(mode, 'live');
  assert.equal(paid.siteRemainingCalls, 240);
  const limited = await submitSceneQuestion({ ...base, question: 'how many whales are swimming now?' }, async () => new Response(JSON.stringify({
    error: 'ai_frequency_limit',
    message: 'The paid-question limit was reached. Please wait before trying again. Try again in 600 seconds.',
  }), { status: 429, headers: { 'Retry-After': '600' } }));
  assert.match(limited.notice ?? '', /600 seconds/);
  assert.equal(limited.siteRemainingCalls ?? null, null);
  const spent = await submitSceneQuestion({ ...base, mode: 'live', question: 'how many whales are swimming now?' }, async () => new Response(JSON.stringify({
    error: 'agent_unavailable', reason: 'provider_unavailable',
  }), { status: 503, headers: { 'X-AI-Remaining-Calls': '249' } }));
  assert.equal(spent.siteRemainingCalls, 249);
  assert.match(spent.notice ?? '', /did not respond/);
});
