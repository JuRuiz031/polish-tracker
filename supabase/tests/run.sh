#!/usr/bin/env bash
#
# Run the migrations against a throwaway Postgres and assert how they actually behave.
#
# src/data/__tests__/schemaParity.test.ts reads the migrations as TEXT — it proves the
# client and the SQL agree with each other. It cannot prove the SQL parses, that a CHECK
# rejects what it should, that the updated_at trigger resolves conflicts the way the
# comment claims, or that RLS actually isolates two users. That needs a real server, and
# this is it.
#
#   ./supabase/tests/run.sh            create (if needed), start, test, and LEAVE running
#   ./supabase/tests/run.sh --clean    ...then destroy the VM and free the disk
#
# Everything happens on a machine of its own (see MACHINE below) so it cannot disturb any
# other podman VM on this Mac.
set -euo pipefail

MACHINE="${POLISH_PG_MACHINE:-polish-pgtest}"
CONTAINER="polish-pg"
IMAGE="docker.io/library/postgres:17-alpine"   # PG15+ required: security_invoker, column-scoped SET NULL
CLEAN="${1:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/.."
P=(podman --connection "$MACHINE")

cleanup() {
  if [[ "$CLEAN" == "--clean" ]]; then
    echo
    echo "--- tearing down ---"
    "${P[@]}" rm -f "$CONTAINER" >/dev/null 2>&1 || true
    podman machine stop "$MACHINE" >/dev/null 2>&1 || true
    podman machine rm -f "$MACHINE" >/dev/null 2>&1 || true
    echo "machine '$MACHINE' removed."
  fi
}
trap cleanup EXIT

# ---- VM ---------------------------------------------------------------------
if ! podman machine inspect "$MACHINE" >/dev/null 2>&1; then
  echo "--- creating machine '$MACHINE' (small; separate from any other VM) ---"
  podman machine init "$MACHINE" --cpus 2 --memory 2048 --disk-size 20 >/dev/null
fi
if ! podman machine inspect "$MACHINE" --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "--- starting machine '$MACHINE' ---"
  podman machine start "$MACHINE" >/dev/null
fi

# ---- Postgres ---------------------------------------------------------------
if ! "${P[@]}" ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  "${P[@]}" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "--- starting postgres ---"
  "${P[@]}" run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=polish "$IMAGE" >/dev/null
fi
for _ in $(seq 1 60); do
  "${P[@]}" exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql_admin() { "${P[@]}" exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
psql_run()   { "${P[@]}" exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d polish; }

# A fresh database every run, so a result can never depend on a previous one — and so
# the migrations are re-proven to apply from nothing each time.
echo "--- recreating database ---"
psql_admin -c "drop database if exists polish (force);" >/dev/null
psql_admin -c "drop role if exists authenticated;"      >/dev/null
psql_admin -c "drop role if exists anon;"               >/dev/null
psql_admin -c "create database polish;"                 >/dev/null

for f in "$HERE/00_shim.sql" \
         "$MIGRATIONS/migrations/0001_schema.sql" \
         "$MIGRATIONS/migrations/0002_rls.sql" \
         "$MIGRATIONS/migrations/0003_views.sql" \
         "$HERE/10_grants.sql"; do
  printf '%-32s' "applying $(basename "$f")"
  if err="$(psql_run < "$f" 2>&1 >/dev/null)"; then echo "ok"; else echo "FAILED"; echo "$err"; exit 1; fi
done

echo
constraints="$(psql_run < "$HERE/20_tests.sql" 2>&1 | sed -n '/CONSTRAINTS/,$p')"
rls="$(psql_run < "$HERE/30_rls.sql" 2>&1 | sed -n '/RLS ISOLATION/,$p')"
printf '%s\n%s\n' "$constraints" "$rls"

# The assertions report themselves rather than raising, so the exit code has to be
# derived from the output — otherwise a wall of FAILs would still exit 0 and sail
# through CI.
if printf '%s%s' "$constraints" "$rls" | grep -q 'FAIL'; then
  echo
  echo "SCHEMA TESTS FAILED"
  exit 1
fi
echo
echo "all schema tests passed"
