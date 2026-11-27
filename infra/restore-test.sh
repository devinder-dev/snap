#!/usr/bin/env bash
# shellcheck source=infra/maintenance-common.sh
source "${BASH_SOURCE[0]%/*}/maintenance-common.sh"

[[ $# -le 1 ]] || fail 'usage: restore-test.sh [version-id]'
find_postgres || fail 'start the Postgres service explicitly before testing a restore'
use_release
target="zzt_restore_$(openssl rand -hex 8)"
docker exec "$postgres" createdb -U snap -T template0 "$target"
cleanup() {
    if ! docker exec "$postgres" dropdb -U snap --if-exists "$target"; then
        printf 'Restore test: remove database %s manually\n' "$target" >&2
        exit 1
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SECONDS=0
"$bin/restore.sh" "$target" "$@"
# Use the tools image and its existing photos client with the restored DB.
"${compose[@]}" run --rm --no-deps --pull never -T -e "RESTORE_TEST_DB=$target" e2e bun scripts/restore-photos.ts </dev/null
printf 'Restore drill complete in %ss\n' "$SECONDS"
