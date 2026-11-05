-- Conservative shared collection allowance. Reservations are never refunded.
CREATE TABLE IF NOT EXISTS ais_daily_budget (
  id smallint PRIMARY KEY CHECK (id = 1),
  budget_day date NOT NULL DEFAULT ((clock_timestamp() AT TIME ZONE 'UTC')::date),
  reserved_ms bigint NOT NULL DEFAULT 0 CHECK (reserved_ms >= 0),
  reserved_until timestamptz
);
INSERT INTO ais_daily_budget (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
