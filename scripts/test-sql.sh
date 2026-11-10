#!/usr/bin/env bash
# 로컬 PostgreSQL에 임시 DB를 만들어 마이그레이션·시드·RLS를 검증한다.
# 사용: PSQL="psql -U postgres" scripts/test-sql.sh   (기본값: psql)
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
DB=realdex_test_$$
$PSQL -q -d postgres -c "create database $DB"
trap '$PSQL -q -d postgres -c "drop database $DB"' EXIT
run() { $PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run tests/sql/stub_supabase.sql
run supabase/migrations/0001_init.sql
run supabase/seed.sql
run supabase/seed.sql   # 두 번 실행해도 안전해야 한다
$PSQL -At -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/rls_test.sql
