#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
FIXTURES_DIR="$ROOT_DIR/scripts/fixtures"
POSTGRES_IMAGE="${POSTGRES_TEST_IMAGE:-postgres:17-alpine}"
CONTAINER_NAME="lingdaily-pgsql-migrations-$$-${RANDOM}"
CONTAINER_ID=""
POSTGRES_PASSWORD="lingdaily-migration-test"
FRESH_DB="lingdaily-pgsql-fresh"
LEGACY_DB="lingdaily-pgsql-legacy"
PRODUCTION_DB="lingdaily-pgsql-production"
INVALID_CHAT_DB="lingdaily-pgsql-invalid-chat"
DUPLICATE_SCENARIO_DB="lingdaily-pgsql-duplicate-scenario"

cleanup() {
  if [[ -n "$CONTAINER_ID" ]]; then
    docker rm --force "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

fail() {
  echo "migration test failed: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"

mapfile -t MIGRATIONS < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort)
[[ ${#MIGRATIONS[@]} -eq 7 ]] || fail "expected 7 numbered migrations, found ${#MIGRATIONS[@]}"

for migration in "${MIGRATIONS[@]}"; do
  filename="$(basename "$migration")"
  [[ "$filename" =~ ^[0-9]{12}_[a-z0-9_]+\.sql$ ]] \
    || fail "migration filename is not versioned: $filename"
  grep -Eq '^begin;$' "$migration" \
    || fail "migration has no explicit transaction start: $filename"
  [[ "$(awk 'NF { last = $0 } END { print last }' "$migration")" == "commit;" ]] \
    || fail "migration has no explicit transaction commit: $filename"
done

echo "Starting isolated PostgreSQL container $CONTAINER_NAME (no host port)..."
CONTAINER_ID="$(docker run --detach \
  --name "$CONTAINER_NAME" \
  --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_IMAGE")"

[[ -z "$(docker port "$CONTAINER_ID")" ]] \
  || fail "test container unexpectedly publishes a host port"

ready=false
for _ in $(seq 1 45); do
  if docker exec "$CONTAINER_ID" pg_isready --username postgres --dbname postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || fail "PostgreSQL did not become ready"

create_database() {
  local database="$1"
  docker exec "$CONTAINER_ID" createdb --username postgres "$database"
  docker exec --interactive --env PGOPTIONS=--client-min-messages=warning "$CONTAINER_ID" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 --username postgres --dbname "$database" \
    < "$FIXTURES_DIR/postgres-bootstrap.sql" >/dev/null
}

apply_sql_file() {
  local database="$1"
  local sql_file="$2"
  docker exec --interactive --env PGOPTIONS=--client-min-messages=warning "$CONTAINER_ID" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$database" \
    < "$sql_file" >/dev/null
}

apply_migrations() {
  local database="$1"
  for migration in "${MIGRATIONS[@]}"; do
    echo "  [$database] $(basename "$migration")"
    apply_sql_file "$database" "$migration"
  done
}

apply_migrations_through() {
  local database="$1"
  local count="$2"
  local index
  for ((index = 0; index < count; index++)); do
    echo "  [$database] $(basename "${MIGRATIONS[$index]}")"
    apply_sql_file "$database" "${MIGRATIONS[$index]}"
  done
}

expect_sql_file_failure() {
  local database="$1"
  local sql_file="$2"
  local label="$3"
  if apply_sql_file "$database" "$sql_file" >/dev/null 2>&1; then
    fail "$label (SQL unexpectedly succeeded)"
  fi
}

query_scalar() {
  local database="$1"
  local sql="$2"
  docker exec --env PGOPTIONS=--client-min-messages=warning "$CONTAINER_ID" \
    psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$database" --command "$sql" \
    | tr -d '\r'
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] \
    || fail "$label (expected '$expected', got '$actual')"
}

echo "Testing fresh schema..."
create_database "$FRESH_DB"
apply_migrations "$FRESH_DB"
assert_equals "14" "$(query_scalar "$FRESH_DB" "select count(*) from public.scenarios where user_id is null;")" "fresh seed count"
assert_equals "0" "$(query_scalar "$FRESH_DB" "select count(*) from (select category_slug, title_en from public.scenarios where user_id is null group by category_slug, title_en having count(*) > 1) duplicates;")" "fresh seed duplicates"
assert_equals "uuid" "$(query_scalar "$FRESH_DB" "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'user_id';")" "fresh preference user_id type"

echo "Testing full-chain rerun on fresh schema..."
apply_migrations "$FRESH_DB"
assert_equals "14" "$(query_scalar "$FRESH_DB" "select count(*) from public.scenarios where user_id is null;")" "rerun seed count"

echo "Testing legacy upgrade..."
create_database "$LEGACY_DB"
apply_sql_file "$LEGACY_DB" "$FIXTURES_DIR/legacy-schema.sql"
apply_migrations "$LEGACY_DB"
assert_equals "text" "$(query_scalar "$LEGACY_DB" "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'user_id';")" "legacy preference user_id type"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select count(*) from public.user_preferences where user_id = '00000000-0000-0000-0000-000000000001';")" "legacy preference preservation"
assert_equals "ja|zh-CN|Japanese Custom|Chinese Custom" "$(query_scalar "$LEGACY_DB" "select learning_language_code || '|' || native_language_code || '|' || learning_language_label || '|' || native_language_label from public.user_preferences;")" "legacy preference labels preserved"
assert_equals "completed" "$(query_scalar "$LEGACY_DB" "select status from public.podcasts where date_folder = '2026-07-10';")" "legacy podcast status"
assert_equals "timestamp with time zone" "$(query_scalar "$LEGACY_DB" "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'podcasts' and column_name = 'created_at';")" "legacy podcast timestamp"
assert_equals "ARRAY" "$(query_scalar "$LEGACY_DB" "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'podcasts' and column_name = 'image_url';")" "legacy podcast image array conversion"
assert_equals "https://cdn.example.com/podcasts/legacy.jpg" "$(query_scalar "$LEGACY_DB" "select image_url[1] from public.podcasts where date_folder = '2026-07-10';")" "legacy podcast scalar image preserved"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select count(*) from pg_index index_row join pg_class index_class on index_class.oid = index_row.indexrelid where index_class.relname = 'podcasts_date_category_idx' and index_row.indisunique;")" "legacy podcast index upgraded to unique"
assert_equals "14" "$(query_scalar "$LEGACY_DB" "select count(*) from public.scenarios where user_id is null and target_language_code = 'en' and native_language_code = 'zh-CN';")" "legacy default-language seed count"
assert_equals "15" "$(query_scalar "$LEGACY_DB" "select count(*) from public.scenarios where user_id is null;")" "legacy multilingual system scenario count"
assert_equals "0" "$(query_scalar "$LEGACY_DB" "select count(*) from (select category_slug, title_en, target_language_code, native_language_code from public.scenarios where user_id is null group by category_slug, title_en, target_language_code, native_language_code having count(*) > 1) duplicates;")" "legacy scenario deduplication"
assert_equals "2" "$(query_scalar "$LEGACY_DB" "select count(*) from public.scenarios where user_id is null and category_slug = 'daily_life' and title_en = 'Ordering at a Restaurant';")" "same-title multilingual scenarios coexist"
assert_equals "10000000-0000-0000-0000-000000000001" "$(query_scalar "$LEGACY_DB" "select category_id from public.scenarios where id = '20000000-0000-0000-0000-000000000001';")" "legacy category reference preserved"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select count(*) from public.chat_history where source_type = 'scenario';")" "legacy scenario history preserved"
assert_equals "0" "$(query_scalar "$LEGACY_DB" "select count(*) from public.chat_history history where history.source_type = 'scenario' and not exists (select 1 from public.scenarios scenario where history.news_key = 'scenario:' || scenario.id::text);")" "legacy history scenario reference"
assert_equals "20000000-0000-0000-0000-000000000001|20000000-0000-0000-0000-000000000001" "$(query_scalar "$LEGACY_DB" "select (news->>'id') || '|' || (news->>'_scenarioId') from public.chat_history where source_type = 'scenario';")" "legacy embedded scenario reference"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select jsonb_array_length(history) from public.chat_history where source_type = 'scenario';")" "legacy transcript length"

echo "Testing full-chain rerun on upgraded legacy schema..."
apply_migrations "$LEGACY_DB"
assert_equals "15" "$(query_scalar "$LEGACY_DB" "select count(*) from public.scenarios where user_id is null;")" "legacy rerun seed count"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select count(*) from public.chat_history where source_type = 'scenario';")" "legacy rerun history count"
assert_equals "1" "$(query_scalar "$LEGACY_DB" "select jsonb_array_length(history) from public.chat_history where source_type = 'scenario';")" "legacy rerun transcript length"
assert_equals "20000000-0000-0000-0000-000000000001|20000000-0000-0000-0000-000000000001" "$(query_scalar "$LEGACY_DB" "select (news->>'id') || '|' || (news->>'_scenarioId') from public.chat_history where source_type = 'scenario';")" "legacy rerun embedded scenario reference"

echo "Testing the exact production catalog shape..."
create_database "$PRODUCTION_DB"
apply_sql_file "$PRODUCTION_DB" "$FIXTURES_DIR/production-20260711-schema.sql"
apply_sql_file "$PRODUCTION_DB" "$ROOT_DIR/scripts/preflight-production.sql"
apply_migrations "$PRODUCTION_DB"

echo "Testing full-chain rerun on the upgraded production shape..."
apply_migrations "$PRODUCTION_DB"
apply_sql_file "$PRODUCTION_DB" "$ROOT_DIR/scripts/postflight-production.sql"
apply_sql_file "$PRODUCTION_DB" "$FIXTURES_DIR/verify-production-upgrade.sql"

echo "Testing non-array chat history fails without erasing content..."
create_database "$INVALID_CHAT_DB"
apply_migrations_through "$INVALID_CHAT_DB" 3
apply_sql_file "$INVALID_CHAT_DB" "$FIXTURES_DIR/invalid-chat-history.sql"
expect_sql_file_failure "$INVALID_CHAT_DB" "${MIGRATIONS[3]}" "invalid chat payload guard"
assert_equals "object|not be erased" "$(query_scalar "$INVALID_CHAT_DB" "select jsonb_typeof(history) || '|' || (history->>'must') from public.chat_history where id = '81000000-0000-0000-0000-000000000001';")" "invalid chat content preserved after rollback"
assert_equals "0" "$(query_scalar "$INVALID_CHAT_DB" "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_history' and column_name = 'revision';")" "invalid chat migration rolled back"

echo "Testing duplicate system scenarios fail without deleting either row..."
create_database "$DUPLICATE_SCENARIO_DB"
apply_migrations_through "$DUPLICATE_SCENARIO_DB" 6
apply_sql_file "$DUPLICATE_SCENARIO_DB" "$FIXTURES_DIR/duplicate-system-scenarios.sql"
expect_sql_file_failure "$DUPLICATE_SCENARIO_DB" "${MIGRATIONS[6]}" "duplicate scenario guard"
assert_equals "2" "$(query_scalar "$DUPLICATE_SCENARIO_DB" "select count(*) from public.scenarios where title_en = 'Duplicate Migration Sentinel';")" "duplicate scenarios preserved after rollback"
assert_equals "2" "$(query_scalar "$DUPLICATE_SCENARIO_DB" "select count(distinct system_prompt) from public.scenarios where title_en = 'Duplicate Migration Sentinel';")" "duplicate scenario prompts preserved"
assert_equals "0" "$(query_scalar "$DUPLICATE_SCENARIO_DB" "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'scenarios_system_category_title_language_uidx';")" "duplicate scenario index creation rolled back"

echo "Migration tests passed. The isolated container will now be removed."
