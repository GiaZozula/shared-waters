-- Disposable compose database only. Production provisioning is described in Operations.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE shared_water_runtime LOGIN PASSWORD 'local_runtime_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE shared_water TO shared_water_runtime;
GRANT USAGE ON SCHEMA public TO shared_water_runtime;
