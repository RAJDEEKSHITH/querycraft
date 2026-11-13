#!/bin/bash
# Read-only access for qc_reader. Runs once, after the data load.
# Must stay consistent with server/src/safety/policy.ts (IMPLEMENTATION.md sections 10.1, 13.1, 24).
#  - Base tables only (views run with their owner's privileges and could expose denied columns).
#  - person.password: no access.
#  - Denied columns: sales.creditcard.cardnumber, humanresources.employee.nationalidnumber
#    and .loginid, person.person.additionalcontactinfo, humanresources.jobcandidate.resume.
#  - Tables with denied columns get column-level SELECT on the other columns only,
#    because a column REVOKE cannot narrow a table-level GRANT.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d adventureworks <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE adventureworks TO qc_reader;

DO $$
DECLARE
  allowed_schemas text[] := ARRAY['sales','production','person','humanresources','purchasing'];
  s text;
  t record;
  cols text;
BEGIN
  FOREACH s IN ARRAY allowed_schemas LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO qc_reader', s);
  END LOOP;

  FOR t IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema = ANY (allowed_schemas)
  LOOP
    IF t.table_schema = 'person' AND t.table_name = 'password' THEN
      CONTINUE;
    ELSIF t.table_schema = 'sales' AND t.table_name = 'creditcard' THEN
      SELECT string_agg(quote_ident(column_name), ', ') INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'sales' AND table_name = 'creditcard'
        AND column_name NOT IN ('cardnumber');
      EXECUTE format('GRANT SELECT (%s) ON sales.creditcard TO qc_reader', cols);
    ELSIF t.table_schema = 'humanresources' AND t.table_name = 'employee' THEN
      SELECT string_agg(quote_ident(column_name), ', ') INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'humanresources' AND table_name = 'employee'
        AND column_name NOT IN ('nationalidnumber', 'loginid');
      EXECUTE format('GRANT SELECT (%s) ON humanresources.employee TO qc_reader', cols);
    ELSIF t.table_schema = 'person' AND t.table_name = 'person' THEN
      SELECT string_agg(quote_ident(column_name), ', ') INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'person' AND table_name = 'person'
        AND column_name NOT IN ('additionalcontactinfo');
      EXECUTE format('GRANT SELECT (%s) ON person.person TO qc_reader', cols);
    ELSIF t.table_schema = 'humanresources' AND t.table_name = 'jobcandidate' THEN
      SELECT string_agg(quote_ident(column_name), ', ') INTO cols
      FROM information_schema.columns
      WHERE table_schema = 'humanresources' AND table_name = 'jobcandidate'
        AND column_name NOT IN ('resume');
      EXECUTE format('GRANT SELECT (%s) ON humanresources.jobcandidate TO qc_reader', cols);
    ELSE
      EXECUTE format('GRANT SELECT ON %I.%I TO qc_reader', t.table_schema, t.table_name);
    END IF;
  END LOOP;
END
$$;
SQL

echo "QueryCraft: qc_reader grants applied"
