#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
    result="Snap deploy: $*"
    if [[ ${logging:-} != yes ]]; then printf '%s\n' "$result" >&2; fi
    exit 1
}

sha_pattern='^[0-9a-f]{40}$'
[[ $# == 1 && ( $1 == rollback || $1 =~ $sha_pattern ) ]] ||
    fail 'usage: deploy.sh <40-character lowercase SHA> | rollback'

root="$HOME/snap-deploy"
source_repo="$root/source"
releases="$root/releases"
state="$root/deployed"
mkdir -p "$releases"
exec 9>"$root/deploy.lock"
flock -n 9 || fail 'deploy lock is held'

# A rollout owns the lock until it finishes, even if the SSH client leaves.
trap '' HUP
exec 8>&1
exec </dev/null >>"$root/deploy.log" 2>&1
logging=yes
result='Snap deploy: failed; see deploy.log'
staging=
next_state=
cleanup_needed=
finish() {
    local status=$?
    trap - EXIT
    if [[ -n $cleanup_needed ]]; then cleanup_candidates || true; fi
    if [[ -n $staging ]]; then rm -rf -- "$staging" || true; fi
    if [[ -n $next_state ]]; then rm -f -- "$next_state" || true; fi
    printf '%s\n' "$result"
    # A broken SSH pipe can only terminate this subshell, after the rollout.
    (printf '%s\n' "$result" >&8) 2>/dev/null || true
    exit "$status"
}
trap finish EXIT
printf '\n%s Snap deploy: requested %s\n' "$(date -u +%FT%TZ)" "$1"

current=
previous=
if [[ -f $state ]]; then
    read -r current previous < "$state"
    [[ $current =~ $sha_pattern && ( $previous == - || $previous =~ $sha_pattern ) ]] ||
        fail 'invalid deployment record'
fi

sha="$1"
if [[ $sha == rollback ]]; then
    [[ $previous =~ $sha_pattern ]] || fail 'no previous deployment recorded'
    sha="$previous"
fi

# Step 1: Resolve a release from the trusted main branch and stage its files.
release="$releases/$sha"
if [[ ! -d $release ]]; then
    if ! git -C "$source_repo" merge-base --is-ancestor "$sha" refs/remotes/origin/main 2>/dev/null; then
        git -C "$source_repo" fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
        git -C "$source_repo" merge-base --is-ancestor "$sha" refs/remotes/origin/main ||
            fail 'SHA is outside the deployment source main branch'
    fi
    staging=$(mktemp -d "$releases/.release.XXXXXXXX")
    git -C "$source_repo" archive "$sha" compose.prod.yml infra/rabbitmq | tar -xf - -C "$staging"
    mv -- "$staging" "$release"
    staging=
fi

# Docker bind-mounts these versioned files into containers running as other users.
# The private deployment root still protects the environment, state and log.
chmod -R go+rX "$release"

export SNAP_SHA="$sha"
compose=(docker compose -p snap-prod --env-file "$root/.env" -f "$release/compose.prod.yml")
app="ghcr.io/devinder-dev/snap-app:$sha"
tools="ghcr.io/devinder-dev/snap-tools:$sha"

# Step 2: Resolve all images before touching any running container.
"${compose[@]}" config --quiet >/dev/null 2>&1 ||
    fail 'invalid Compose configuration; check release files and server environment'
for image in "$app" "$tools"; do
    docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" || fail "image unavailable: $image"
done
"${compose[@]}" pull --policy missing postgres rabbitmq >/dev/null 2>&1 ||
    fail 'could not pull the Postgres or RabbitMQ image'

api_ids() {
    docker ps "$@" --no-trunc --quiet \
        --filter label=com.docker.compose.project=snap-prod \
        --filter label=com.docker.compose.service=api \
        --filter label=com.docker.compose.oneoff=False
}

# Step 3: Start shared dependencies if needed, and run forward migrations.
old=$(api_ids)
[[ $(wc -w <<< "$old") -le 3 ]] || fail 'more than three running API copies; inspect the interrupted deploy'
"${compose[@]}" up -d --no-recreate --pull never --wait --wait-timeout 120 postgres rabbitmq >/dev/null 2>&1 ||
    fail 'Postgres or RabbitMQ failed to start healthy'
printf 'Snap deploy: running forward migrations\n'
# Compose and dbmate errors may include environment values or SQL. Log fixed
# diagnostic categories without copying any of that output, even on rollback.
"${compose[@]}" run --rm --no-deps --pull never -T migrate 2>&1 |
    awk '
        /authentication failed|no pg_hba.conf entry/ { auth = 1 }
        /connection refused|failed to connect|i\/o timeout|no such host/ { connection = 1 }
        /syntax error|SQLSTATE|pq:|migration .*failed/ { migration = 1 }
        END {
            if (auth) print "Database authentication failed"
            if (connection) print "Database connection failed"
            if (migration) print "Database rejected a migration statement"
        }
    ' ||
    fail 'migration failed; check database health and migration files as the server operator'

# Compose counts stopped containers during scaling. Remove only stopped API copies.
all=$(api_ids -a)
while IFS= read -r id; do
    [[ -n $id ]] || continue
    if ! [[ " $old " == *"$id"* ]]; then
        docker rm "$id" >/dev/null
    fi
done <<< "$all"

# Recover the previous SHA on the first managed upgrade from an existing stack.
if [[ -z $current && -n $old ]]; then
    old_image=$(docker inspect --format '{{.Config.Image}}' "${old%%$'\n'*}")
    old_sha="${old_image##*:}"
    if [[ $old_sha =~ $sha_pattern ]]; then
        current="$old_sha"
        baseline=$(mktemp "$root/.deployed.XXXXXXXX")
        printf '%s -\n' "$current" > "$baseline"
        mv -f -- "$baseline" "$state"
    fi
fi

new_api_ids() {
    local all_ids id
    all_ids=$(api_ids -a) || return
    while IFS= read -r id; do
        [[ -n $id ]] || continue
        if ! [[ " $old " == *"$id"* ]]; then
            printf '%s\n' "$id"
        fi
    done <<< "$all_ids"
}

stop_and_remove() {
    docker stop -t 330 "$@" >/dev/null && docker rm "$@" >/dev/null
}

# Step 4: Reuse an already healthy target set when retrying worker or state updates.
if [[ -n $old ]]; then
    mapfile -t old_ids <<< "$old"
else
    old_ids=()
fi
target_line="$app running healthy"
if (( ${#old_ids[@]} == 3 )) &&
    statuses=$(docker inspect --format '{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}}' "${old_ids[@]}") &&
    [[ $statuses == "$target_line"$'\n'"$target_line"$'\n'"$target_line" ]]; then
    printf 'Snap deploy: three target API copies already healthy\n'
else
    cleanup_candidates() {
        local candidates
        candidates=$(new_api_ids) || return
        if [[ -n $candidates ]]; then
            mapfile -t candidate_ids <<< "$candidates"
            stop_and_remove "${candidate_ids[@]}" ||
                printf 'Snap deploy: candidate cleanup needs attention\n' >&2
        fi
    }
    cleanup_needed=yes
    trap 'exit 130' INT
    trap 'exit 143' TERM
    "${compose[@]}" up -d --no-deps --no-recreate --pull never --scale "api=$((${#old_ids[@]} + 3))" api >/dev/null 2>&1 ||
        fail 'could not start candidate API copies'

    candidates=$(new_api_ids)
    [[ $(wc -w <<< "$candidates") -eq 3 ]] || fail 'expected three new API copies'
    mapfile -t candidate_ids <<< "$candidates"
    printf 'Snap deploy: waiting for three new API copies\n'
    deadline=$((SECONDS + 120))
    while :; do
        statuses=$(docker inspect --format '{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}}' "${candidate_ids[@]}")
        [[ $statuses == "$target_line"$'\n'"$target_line"$'\n'"$target_line" ]] && break
        (( SECONDS < deadline )) || fail 'new API copies did not become healthy; keeping old copies'
        sleep 2
    done

    # Step 5: Old APIs withdraw from Traefik on SIGTERM before closing their listeners.
    # Keep the new copies even if stopping an old copy fails after cutover starts.
    cleanup_needed=
    trap - INT TERM
    if (( ${#old_ids[@]} )); then
        stop_and_remove "${old_ids[@]}"
    fi
fi

# Step 6: Move the worker after the API cutover. Record both SHAs together.
"${compose[@]}" up -d --no-deps --pull never worker >/dev/null 2>&1 ||
    fail 'could not update the worker'
if [[ $sha != "$current" ]]; then
    previous="${current:--}"
fi
next_state=$(mktemp "$root/.deployed.XXXXXXXX")
printf '%s %s\n' "$sha" "${previous:--}" > "$next_state"
mv -f -- "$next_state" "$state"
next_state=
printf -v result 'Snap deploy: deployed %s (previous %s)' "$sha" "${previous:--}"
