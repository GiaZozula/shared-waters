-- Bounded control state, separate from source evidence and paid-call admission.
CREATE TABLE IF NOT EXISTS collection_control (
  id smallint PRIMARY KEY CHECK (id = 1),
  demand_until timestamptz,
  active_since timestamptz,
  resume_at timestamptz,
  owner_id text,
  owner_heartbeat_at timestamptz
);
INSERT INTO collection_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
