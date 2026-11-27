#!/usr/bin/env bash
# shellcheck source=infra/maintenance-common.sh
source "${BASH_SOURCE[0]%/*}/maintenance-common.sh"

[[ $# == 0 || ( $# == 1 && $1 == --scheduled ) ]] || fail 'usage: backup.sh [--scheduled]'
if ! lock_maintenance; then
    if [[ ${1:-} == --scheduled ]]; then echo 'Backup skipped: maintenance lock is held'; exit 0; fi
    fail 'maintenance lock is held'
fi
if ! find_postgres; then
    echo 'Backup skipped: Postgres is stopped or Snap is parked'
    [[ ${1:-} == --scheduled ]]
    exit
fi

# A failed dump must never replace the current object with a partial archive.
SECONDS=0
temp=$(mktemp -d "$root/.backup.XXXXXXXX")
trap 'rm -rf -- "$temp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# The block limit bounds local spool usage even if pg_dump produces a huge file.
(ulimit -f 262144; docker exec "$postgres" pg_dump -U snap -d snap -Fc > "$temp/postgres.dump" 2>/dev/null) ||
    fail 'pg_dump failed or exceeded the spool limit'
storage upload "$temp/postgres.dump"
printf 'Backup complete in %ss\n' "$SECONDS"
