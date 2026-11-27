#!/usr/bin/env bash
# Shared by the installed maintenance commands.
set -euo pipefail
umask 077

root="$HOME/snap-deploy"
bin=${BASH_SOURCE[0]%/*}

fail() { printf 'Snap maintenance: %s\n' "$*" >&2; exit 1; }

lock_maintenance() {
    exec 9>>"$root/deploy.lock"
    flock -n 9
}

container_ids() {
    docker ps --quiet --filter label=com.docker.compose.project=snap-prod \
        --filter "label=com.docker.compose.service=$1" --filter label=com.docker.compose.oneoff=False
}

find_postgres() {
    postgres=$(container_ids postgres) || fail 'could not query Docker'
    [[ -n $postgres ]] || return 1
    [[ $postgres != *$'\n'* ]] || fail 'expected one running Postgres container'
}

use_release() {
    read -r SNAP_SHA _ < "$root/deployed"
    [[ $SNAP_SHA =~ ^[0-9a-f]{40}$ ]] || fail 'invalid deployed SHA'
    export SNAP_SHA
    # The maintenance scripts that source this file use the Compose command.
    # shellcheck disable=SC2034
    compose=(docker compose -p snap-prod --env-file "$root/.env" -f "$root/releases/$SNAP_SHA/compose.prod.yml")
}

storage() { python3 "$bin/backup-storage.py" "$root/backup.env" "$@"; }
