-- Durable admission state. Migrations/restarts never replenish the lifetime allowance.
CREATE TABLE IF NOT EXISTS ai_budget_state (
  id integer PRIMARY KEY CHECK (id = 1),
  used_calls bigint NOT NULL DEFAULT 0 CHECK (used_calls >= 0)
);
INSERT INTO ai_budget_state (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_call_reservations (
  id uuid PRIMARY KEY,
  client_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_calls_started ON ai_call_reservations (started_at);
CREATE INDEX IF NOT EXISTS ai_calls_active ON ai_call_reservations (id) WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS historical_presence (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_record_id text NOT NULL,
  kind text NOT NULL CHECK (kind = 'gfw_vessel_presence_hour'),
  zone_id text NOT NULL,
  event_at timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  vessel_id text NOT NULL,
  speed_band_group text NOT NULL CHECK (speed_band_group IN ('bands_below_or_up_to_10', 'bands_from_10_up')),
  source_url text NOT NULL,
  raw_reference text NOT NULL,
  raw_payload jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS historical_presence_kind_time ON historical_presence (kind, event_at);
CREATE INDEX IF NOT EXISTS historical_presence_zone_time ON historical_presence (zone_id, event_at);

CREATE TABLE IF NOT EXISTS marine_observations (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source = 'open_meteo_marine'),
  source_record_id text NOT NULL,
  zone_id text NOT NULL CHECK (zone_id = 'zone_a'),
  valid_at timestamptz NOT NULL,
  grid_latitude double precision NOT NULL,
  grid_longitude double precision NOT NULL,
  wave_height_m double precision CHECK (wave_height_m >= 0),
  sea_surface_temperature_c double precision,
  ocean_current_velocity_kmh double precision CHECK (ocean_current_velocity_kmh >= 0),
  source_url text NOT NULL,
  raw_payload jsonb NOT NULL,
  first_ingested_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz NOT NULL,
  UNIQUE (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS marine_observations_zone_time ON marine_observations (zone_id, valid_at DESC);

CREATE TABLE IF NOT EXISTS feed_status (
  source text PRIMARY KEY,
  last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_error text,
  last_attempt_status text NOT NULL CHECK (last_attempt_status IN ('success', 'error'))
);

CREATE TABLE IF NOT EXISTS whoi_reviews (
  source text NOT NULL CHECK (source = 'whoi_robots4whales'),
  source_record_id text NOT NULL,
  zone_id text NOT NULL CHECK (zone_id = 'zone_a'),
  review_date date NOT NULL,
  detection_count integer NOT NULL CHECK (detection_count >= 0),
  source_url text NOT NULL,
  first_ingested_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz NOT NULL,
  PRIMARY KEY (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS whoi_reviews_zone_date ON whoi_reviews (zone_id, review_date DESC);

CREATE TABLE IF NOT EXISTS whoi_detections (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source = 'whoi_robots4whales'),
  source_record_id text NOT NULL,
  zone_id text NOT NULL CHECK (zone_id = 'zone_a'),
  review_date date NOT NULL,
  source_local_time text NOT NULL,
  occurrence text NOT NULL CHECK (occurrence IN ('detected', 'possibly_detected')),
  platform_latitude double precision NOT NULL,
  platform_longitude double precision NOT NULL,
  source_url text NOT NULL,
  raw_text text NOT NULL,
  first_ingested_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz NOT NULL,
  UNIQUE (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS whoi_detections_zone_local_time ON whoi_detections (zone_id, source_local_time DESC);

CREATE TABLE IF NOT EXISTS navwarn_notices (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source = 'canadian_coast_guard_navwarn'),
  source_record_id text NOT NULL,
  zone_id text NOT NULL CHECK (zone_id = 'zone_a'),
  published_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  zone_a_state text NOT NULL CHECK (zone_a_state IN ('restricted_10_knots', 'no_restriction_stated')),
  applies_to text NOT NULL CHECK (applies_to = 'vessels_over_13_m'),
  cancels text,
  source_url text NOT NULL,
  raw_text text NOT NULL,
  first_ingested_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz NOT NULL,
  UNIQUE (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS navwarn_notices_zone_publication ON navwarn_notices (zone_id, published_at DESC);

CREATE TABLE IF NOT EXISTS ais_positions (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source = 'aisstream'),
  source_record_id text NOT NULL,
  zone_id text NOT NULL CHECK (zone_id = 'zone_a'),
  mmsi text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  speed_knots double precision,
  ship_name text,
  source_url text NOT NULL,
  raw_payload jsonb NOT NULL,
  UNIQUE (source, source_record_id)
);
CREATE INDEX IF NOT EXISTS ais_positions_zone_time ON ais_positions (zone_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ais_positions_vessel_time ON ais_positions (mmsi, observed_at DESC);

CREATE TABLE IF NOT EXISTS ais_connection_status (
  source text PRIMARY KEY CHECK (source = 'aisstream'),
  state text NOT NULL CHECK (state IN ('connecting', 'connected', 'disconnected', 'unconfigured')),
  checked_at timestamptz NOT NULL,
  connected_at timestamptz,
  last_message_at timestamptz,
  last_error text,
  frames_received integer NOT NULL DEFAULT 0,
  frames_unparsed integer NOT NULL DEFAULT 0,
  frames_outside integer NOT NULL DEFAULT 0,
  frames_stored integer NOT NULL DEFAULT 0
);
ALTER TABLE ais_connection_status ADD COLUMN IF NOT EXISTS frames_received integer NOT NULL DEFAULT 0;
ALTER TABLE ais_connection_status ADD COLUMN IF NOT EXISTS frames_unparsed integer NOT NULL DEFAULT 0;
ALTER TABLE ais_connection_status ADD COLUMN IF NOT EXISTS frames_outside integer NOT NULL DEFAULT 0;
ALTER TABLE ais_connection_status ADD COLUMN IF NOT EXISTS frames_stored integer NOT NULL DEFAULT 0;
