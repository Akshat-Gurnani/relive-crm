#!/bin/sh
# Rebuilds a throwaway database and runs migration, seed and tests. Needs local Postgres and the postgres OS user.
set -e
D="$(cd "$(dirname "$0")/.." && pwd)"
su postgres -c "psql -q -c 'drop database if exists crm_test' -c 'create database crm_test'" >/dev/null
for f in tests/stub.sql supabase/migrations/0001_core.sql supabase/migrations/0002_dashboard.sql supabase/migrations/0003_workflows.sql supabase/migrations/0004_hierarchy.sql supabase/migrations/0005_integrations.sql supabase/migrations/0007_cratio_import.sql supabase/migrations/0008_import_owners.sql supabase/migrations/0009_lead_source_codes.sql supabase/migrations/0010_lead_sources_as_in_cratio.sql supabase/migrations/0011_lead_search.sql supabase/migrations/0012_insights.sql supabase/migrations/0013_meta_routing.sql supabase/migrations/0014_project_aliases.sql supabase/seed.sql tests/behaviour.sql tests/dashboard.sql tests/app_actions.sql tests/workflows.sql tests/hierarchy.sql tests/integrations.sql tests/insights.sql tests/meta_routing.sql; do
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -d crm_test -f $D/$f" 2>&1 | grep -E "NOTICE|ERROR|FAIL|PASSED" | sed 's/^psql:[^ ]* //'
done
