#!/bin/bash
# Creates roles and databases. Runs once, on the first start with an empty data volume.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v app_pw="$QC_APP_PASSWORD" \
  -v reader_pw="$QC_READER_PASSWORD" <<'SQL'
CREATE ROLE qc_app LOGIN PASSWORD :'app_pw';
CREATE ROLE qc_reader LOGIN PASSWORD :'reader_pw' CONNECTION LIMIT 5;

ALTER ROLE qc_reader SET default_transaction_read_only = on;
ALTER ROLE qc_reader SET statement_timeout = '5s';
ALTER ROLE qc_reader SET idle_in_transaction_session_timeout = '10s';

CREATE DATABASE adventureworks;
CREATE DATABASE querycraft_app OWNER qc_app;
CREATE DATABASE querycraft_test OWNER qc_app;

REVOKE ALL ON DATABASE adventureworks FROM PUBLIC;
REVOKE ALL ON DATABASE querycraft_app FROM PUBLIC;
REVOKE ALL ON DATABASE querycraft_test FROM PUBLIC;
SQL

for db in querycraft_app querycraft_test; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO qc_app;
ALTER SCHEMA public OWNER TO qc_app;
SQL
done

echo "QueryCraft: roles and databases created"
