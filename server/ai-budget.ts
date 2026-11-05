import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

export type AiPolicy = {
  clientCalls: number; clientWindowSeconds: number;
  siteCalls: number; siteWindowSeconds: number;
  concurrency: number; totalCalls: number; identitySecret: string;
};
export class BudgetFailure extends Error {
  constructor(readonly reason: 'ai_disabled' | 'ai_budget_unavailable' | 'ai_budget_exhausted' | 'ai_frequency_limit' | 'ai_busy',
    readonly retryAfterSeconds?: number) { super(reason); }
}
// Anonymous browser identity avoids relying on an unverified hosted proxy chain.
// Clearing cookies can obtain another identity; site-wide limits remain authoritative.
export function visitorIdentity(cookie: string | undefined, secret: string): { id: string; cookie?: string } {
  const sign = (id: string) => createHmac('sha256', secret).update(`visitor:${id}`).digest('hex');
  const token = cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('sw_visitor='))?.slice(11);
  if (token && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) {
    const [id, signature] = token.split('.');
    if (timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return { id };
  }
  const id = randomUUID();
  return { id, cookie: `sw_visitor=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure` };
}
export function publishedAiLimits(env: NodeJS.ProcessEnv = process.env) {
  const number = (key: string) => {
    const value = env[key];
    if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
    return Number(value);
  };
  const limits = {
    clientCalls: number('AI_CLIENT_CALLS'), clientWindowSeconds: number('AI_CLIENT_WINDOW_SECONDS'),
    siteCalls: number('AI_SITE_CALLS'), siteWindowSeconds: number('AI_SITE_WINDOW_SECONDS'),
    concurrency: number('AI_CONCURRENCY'), totalCalls: number('AI_TOTAL_CALLS'),
  };
  return Object.values(limits).every((value) => value !== null) ? limits as { [K in keyof typeof limits]: number } : null;
}

export function aiPolicy(env: NodeJS.ProcessEnv = process.env): AiPolicy {
  if (env.AI_QUESTIONS_ENABLED !== 'true') throw new BudgetFailure('ai_disabled');
  const number = (key: string) => {
    const value = env[key];
    if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new BudgetFailure('ai_budget_unavailable');
    return Number(value);
  };
  if (!env.AI_IDENTITY_SECRET || env.AI_IDENTITY_SECRET.length < 32) throw new BudgetFailure('ai_budget_unavailable');
  return { clientCalls: number('AI_CLIENT_CALLS'), clientWindowSeconds: number('AI_CLIENT_WINDOW_SECONDS'),
    siteCalls: number('AI_SITE_CALLS'), siteWindowSeconds: number('AI_SITE_WINDOW_SECONDS'),
    concurrency: number('AI_CONCURRENCY'), totalCalls: number('AI_TOTAL_CALLS'), identitySecret: env.AI_IDENTITY_SECRET };
}

// The singleton row serializes admission across processes. Never refund an admitted call:
// transport errors and timeouts can still be billed. No automatic total-budget reset.
export async function reserveAiCall(db: Pool, address: string, policy: AiPolicy): Promise<{ finish: () => Promise<void>; remaining: number }> {
  const clientKey = createHmac('sha256', policy.identitySecret).update(address).digest('hex');
  let client;
  try { client = await db.connect(); } catch { throw new BudgetFailure('ai_budget_unavailable'); }
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    const state = await client.query<{ used_calls: string }>('SELECT used_calls FROM ai_budget_state WHERE id = 1 FOR UPDATE');
    if (!state.rows[0]) throw new BudgetFailure('ai_budget_unavailable');
    const used = Number(state.rows[0].used_calls);
    if (used >= policy.totalCalls) throw new BudgetFailure('ai_budget_exhausted');
    const counts = await client.query<{ active: string; site: string; visitor: string;
      site_latest: string; visitor_latest: string; now_seconds: string }>(`
      SELECT count(*) FILTER (WHERE finished_at IS NULL) AS active,
        count(*) FILTER (WHERE started_at > clock_timestamp() - $1 * interval '1 second') AS site,
        count(*) FILTER (WHERE client_key = $3 AND started_at > clock_timestamp() - $2 * interval '1 second') AS visitor,
        MAX(EXTRACT(EPOCH FROM started_at)) AS site_latest,
        MAX(EXTRACT(EPOCH FROM started_at)) FILTER (WHERE client_key = $3) AS visitor_latest,
        EXTRACT(EPOCH FROM clock_timestamp()) AS now_seconds
      FROM ai_call_reservations`, [policy.siteWindowSeconds, policy.clientWindowSeconds, clientKey]);
    const count = counts.rows[0];
    const retrySeconds = Math.max(1,
      Number(count.site) >= policy.siteCalls ? Math.ceil(Number(count.site_latest) + policy.siteWindowSeconds - Number(count.now_seconds)) : 0,
      Number(count.visitor) >= policy.clientCalls ? Math.ceil(Number(count.visitor_latest) + policy.clientWindowSeconds - Number(count.now_seconds)) : 0);
    if (Number(count.site) >= policy.siteCalls || Number(count.visitor) >= policy.clientCalls)
      throw new BudgetFailure('ai_frequency_limit', retrySeconds);
    if (Number(count.active) >= policy.concurrency) throw new BudgetFailure('ai_busy', 10);
    const id = randomUUID();
    await client.query('INSERT INTO ai_call_reservations (id, client_key) VALUES ($1, $2)', [id, clientKey]);
    await client.query('UPDATE ai_budget_state SET used_calls = used_calls + 1 WHERE id = 1');
    await client.query('COMMIT');
    return { remaining: policy.totalCalls - used - 1, finish: async () => {
      try { await db.query('UPDATE ai_call_reservations SET finished_at = clock_timestamp() WHERE id = $1', [id]); }
      catch { throw new BudgetFailure('ai_budget_unavailable'); }
    } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof BudgetFailure) throw error;
    throw new BudgetFailure('ai_budget_unavailable');
  } finally { client.release(); }
}
