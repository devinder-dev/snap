#!/usr/bin/env bash
# shellcheck source=infra/maintenance-common.sh
source "${BASH_SOURCE[0]%/*}/maintenance-common.sh"

if [[ $# == 1 && $1 == versions ]]; then storage versions; exit; fi
replace=no
if [[ ${1:-} == --replace ]]; then replace=yes; shift; fi
[[ $# -ge 1 && $# -le 2 ]] || fail 'usage: restore.sh versions | [--replace] <database> [version-id]'
target=$1
[[ $target == snap || $target =~ ^(zzt_|snap_restore_)[a-z0-9_]{1,45}$ ]] ||
    fail 'target must be snap, zzt_<name>, or snap_restore_<name>'

lock_maintenance || fail 'maintenance lock is held'
find_postgres || fail 'start the Postgres service explicitly before restoring'
psql() { docker exec -i "$postgres" psql -XqAt -U snap -v ON_ERROR_STOP=1 "$@"; }

if [[ $target == snap ]]; then
    api=$(container_ids api)
    worker=$(container_ids worker)
    [[ -z $api && -z $worker ]] || fail 'stop the API and worker before restoring snap'
fi

# Refuse any database with user objects, including one already migrated by dbmate.
empty=$(psql -d "$target" -c "
    SELECT count(*) FROM (
      SELECT oid FROM pg_class WHERE relnamespace >= 16384 OR relnamespace = 'public'::regnamespace
      UNION ALL SELECT oid FROM pg_proc WHERE pronamespace >= 16384 OR pronamespace = 'public'::regnamespace
      UNION ALL SELECT oid FROM pg_type WHERE typnamespace >= 16384 OR typnamespace = 'public'::regnamespace
      UNION ALL SELECT oid FROM pg_namespace WHERE oid >= 16384
      UNION ALL SELECT oid FROM pg_extension WHERE extname <> 'plpgsql'
    ) objects;" </dev/null)
[[ $empty == 0 || $replace == yes ]] || fail 'target database is not empty; use an empty database or explicitly pass --replace'

SECONDS=0
temp=$(mktemp -d "$root/.restore.XXXXXXXX")
staging=
cleanup() {
    rm -rf -- "$temp"
    if [[ -n $staging ]]; then docker exec "$postgres" dropdb -U snap --if-exists "$staging"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
storage download "$temp/postgres.dump" "${@:2}"
destination=$target
if [[ $empty != 0 ]]; then
    suffix=$(openssl rand -hex 8)
    destination="snap_restore_$suffix"
    docker exec "$postgres" createdb -U snap -T template0 "$destination"
    staging=$destination
fi
docker exec -i "$postgres" pg_restore -U snap -d "$destination" --single-transaction --exit-on-error \
    < "$temp/postgres.dump" 2>/dev/null || fail 'pg_restore failed; no changes were committed'

psql -d "$destination" -c "
    SELECT 'users', count(*) FROM users UNION ALL
    SELECT 'messages', count(*) FROM messages UNION ALL
    SELECT 'snaps', count(*) FROM snaps UNION ALL
    SELECT 'friendships', count(*) FROM friendships UNION ALL
    SELECT 'snap_recipients', count(*) FROM snap_recipients;" </dev/null
if [[ -n $staging ]]; then
    old="snap_before_$suffix"
    # Both renames succeed together. An active session prevents the swap.
    psql -d postgres <<SQL
BEGIN;
ALTER DATABASE "$target" RENAME TO "$old";
ALTER DATABASE "$staging" RENAME TO "$target";
COMMIT;
SQL
    staging=
    printf 'Original database retained as %s\n' "$old"
fi
printf 'Restore complete in %ss\n' "$SECONDS"
