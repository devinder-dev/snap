#!/usr/bin/env bash
set -euo pipefail

# This runs from the stable installation, with the exact command SSH received.
request=${SSH_ORIGINAL_COMMAND-}
deploy_pattern='^deploy ([0-9a-f]{40})$'
script_dir=${BASH_SOURCE[0]%/*}
if [[ $request =~ $deploy_pattern ]]; then
    exec "$script_dir/deploy.sh" "${BASH_REMATCH[1]}"
fi
if [[ $request == rollback ]]; then
    exec "$script_dir/deploy.sh" rollback
fi

logger -t snap-deploy 'Refused SSH deployment command' || true
printf 'Snap deploy: command refused\n' >&2
exit 1
