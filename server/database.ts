import pg from 'pg';

// Honor the provider's TLS settings; do not silently disable certificate verification.
export function databasePoolOptions(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 7000,
    max: 5,
    idleTimeoutMillis: 10_000,
  };
}

// SET LOCAL is transaction-scoped, including through Neon's transaction pooler.
// Do not send unsupported startup GUCs or rely on sticky pooled sessions.
export function createRuntimePool(config: pg.PoolConfig, statementTimeoutMs = 5000): pg.Pool {
  const pool = new pg.Pool(config);
  const query = async (sql: unknown, values?: unknown) => {
    if (typeof values === 'function') throw new Error('Runtime database queries use promises, not callbacks.');
    const client = await pool.connect();
    let failure: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${Math.max(1, Math.floor(statementTimeoutMs))}ms'`);
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
      const result = await client.query(sql as string, values as unknown[] | undefined);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Database operation failed');
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(failure); }
  };
  // Stores in this application use the promise query overload. Explicit
  // multi-statement transactions (AI admission) use connect() directly.
  return new Proxy(pool, { get(target, key) {
    if (key === 'query') return query;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
