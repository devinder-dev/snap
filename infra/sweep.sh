#!/usr/bin/env bash
# shellcheck source=infra/maintenance-common.sh
source "${BASH_SOURCE[0]%/*}/maintenance-common.sh"

if ! lock_maintenance; then echo 'Sweep skipped: maintenance lock is held'; exit 0; fi
if ! find_postgres; then echo 'Sweep skipped: Postgres is stopped or Snap is parked'; exit 0; fi
api=$(container_ids api)
if [[ -z $api ]]; then echo 'Sweep skipped: no running API'; exit 0; fi
use_release
"${compose[@]}" run --rm --no-deps --pull never -T sweep </dev/null
