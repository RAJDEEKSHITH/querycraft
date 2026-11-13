#!/bin/bash
# Loads AdventureWorks into the adventureworks database. Runs once, on the first start.
# Some lorint views fail to create; that is expected (views are never granted to qc_reader).
set -euo pipefail

cd /adventureworks
echo "QueryCraft: loading AdventureWorks (takes a minute; view errors in the log are expected)"
psql -U "$POSTGRES_USER" -d adventureworks -q -f install.sql > /tmp/adventureworks-install.log 2>&1 || true

count=$(psql -U "$POSTGRES_USER" -d adventureworks -tAc "
  SELECT count(*) FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_schema IN ('sales','production','person','humanresources','purchasing');")

echo "QueryCraft: AdventureWorks base tables loaded: $count"
if [ "$count" -lt 68 ]; then
  echo "QueryCraft: expected 68 base tables. See /tmp/adventureworks-install.log inside the container." >&2
  exit 1
fi
