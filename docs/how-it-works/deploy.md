# Deploying Snap

Compose normally replaces API containers as soon as their image changes.
Traefik can still have an old container's address when that container closes
its listener. A request sent in that gap can get a 502.

A **zero-downtime deploy** keeps serving requests during a release. Think of a
shop opening three new tills before asking the old tills to finish serving
their queues. Snap pulls the release, migrates the shared database, and opens
three new API copies. Only after all three are healthy does it retire the old
copies and update the worker.

```text
                         time moves right →
old API copies     serving ─────────────────── drain ── finish HTTP ── stop
new API copies                start ── healthy ── serving ────────────────→
Traefik            old only ────────── old + new ── new only ─────────────→
worker             old release ─────────────────────────────────→ new
```

A **drain** takes a copy out of rotation while it can still finish requests.
SIGTERM sets a local flag. `/health/traffic` switches from 200 to 503, while
`/health` stays 200 and normal HTTP still works. Docker probes every 2 seconds
with a 2-second timeout and marks the container unhealthy after two failures.
Traefik's existing Docker labels identify the same shared service throughout
the deploy. Its Docker provider watches health events and omits unhealthy
containers. The API waits 12 seconds for the probes and proxy refresh to take
effect before it closes HTTP and its WebSocket transports. Phones reconnect
through Traefik and refetch anything they missed.

The previous 8-second shutdown guard still applies to the worker and local
API. In production the API guard allows 322 seconds, including the 12-second
withdrawal and up to 310 seconds for close and cleanup. That budget
accommodates the shared edge's 300-second request read timeout. Docker allows
330 seconds before it can force-stop the process. Both API probes work
without Postgres or RabbitMQ. A shared dependency failure is reported by
`/health/ready`. The deploy adds no automatic HTTP retries.

The first transition from the pre-drain `d73541c` release can drop requests
because its retiring copies close immediately. Both releases need the drain
code for the rehearsal's zero-failure target.

In the 1-CPU, 4-GB rehearsal, the switch took 17 seconds and the rollback
took 19 seconds. Across both, 2,861 health requests and 2,856 authenticated
reads had zero non-2xx responses. All 15 e2e runs passed 69/69. The transition
from `d73541c` dropped five requests in 0.3 seconds. Chat reconnected in
1.1–1.4 seconds. A push can be missed during that gap. The message is stored
and the app refetches on `connect`, so it still appears.

## How releases are selected

The host keeps a source clone and reads the target SHA's `compose.prod.yml`
and RabbitMQ files with `git archive`. The script accepts commits reachable
from the clone's `origin/main`. It keeps each extracted release directory
because a running RabbitMQ container can still use a file from that directory.
The archived config is readable to the RabbitMQ user inside the container.
The installed scripts live outside the clone. Fetching a release cannot
rewrite the script Bash is reading.

Both Snap image tags are immutable commit SHAs. A local tag is used if it is
already present. This also lets a disposable VM rehearse releases with images
loaded by `docker load`. If a required image is unavailable the deploy stops
before changing containers. The database and broker start if needed, and their
existing containers and volumes stay in place. A change to one of those shared
services needs its own maintenance.

Keeping a single Compose project lets old and new copies share Postgres,
RabbitMQ, and the same Traefik router. A blue/green setup with two projects
would also support overlap, but would need shared networks and a separate
traffic switch. Keep overlapping versions' router and service labels compatible.
The script scales by three with `--no-recreate`, identifies the three new
containers by ID, and removes the old IDs after the cutover. On an empty or
parked stack it starts three copies. After parking, allow Traefik 1–2 seconds
to add the route. An immediate request can return 404. At the measured 32–37 MiB per idle copy,
six should use 192–222 MiB combined, about 96–111 MiB above steady state.
Their combined ceiling is 1,536 MiB. On the 1-CPU, 4-GB VM, measure memory
and request latency during the overlap. The rehearsal peaked at 1,429 of
3,901 MiB with six API copies and used about 1,150–1,245 MiB with three
under load.

An [expand/contract migration](../../backend/db/migrations/README.md) changes a
schema in stages. For example, add a replacement column in one release and
drop the old column only when both the running and rollback versions can
work without it. A **rollback** deploys the previous app and tools SHA with
its own Compose file. Postgres keeps its data and applied migrations.
A **lock** grants one deploy exclusive access. If two sessions try to deploy
at once, the second gets an error before starting another rollout.

## Names you will see

| Name | Kind | Where it lives | Meaning |
| --- | --- | --- | --- |
| `deploy` user | Linux account | Shared VM | Runs Docker and owns Snap's installation. |
| Deploy key | Separate SSH key pair | GitHub secret and the VM's `authorized_keys` | Lets CI authenticate for the allowed deploy commands. |
| `deploy.sh` | Bash script | Repo `infra/` and VM `~/snap-deploy/bin/` | Deploys a release and records the current and previous SHAs. |
| Forced command | SSH key setting and wrapper | `authorized_keys` and `deploy-ssh.sh` | SSH always runs the wrapper for this key. For example, `deploy <sha>` is allowed and `id` is refused. |
| CI deploy job | GitHub Actions job | `.github/workflows/ci.yml` | Calls SSH after both images have been published from a successful main build. |
| `DEPLOY_HOST` | Repository variable | GitHub Actions settings | Names the SSH host. An unset value keeps CI deployment dormant. |

## Try it yourself

Start the shared edge before deploying Snap. As the operator, connect with
your administration key and put a trusted release checkout on the VM, for
example at `~/snap-bootstrap`. Then install the two scripts as the `deploy`
user. Repeat the install when deliberately upgrading the deployment scripts.

```sh
umask 077
install -d -m 700 "$HOME/snap-deploy/bin" "$HOME/.ssh"
install -m 700 "$HOME/snap-bootstrap/infra/deploy.sh" "$HOME/snap-deploy/bin/deploy.sh"
install -m 700 "$HOME/snap-bootstrap/infra/deploy-ssh.sh" "$HOME/snap-deploy/bin/deploy-ssh.sh"
git clone --no-checkout https://github.com/devinder-dev/snap.git "$HOME/snap-deploy/source"
test -e "$HOME/snap-deploy/.env" || install -m 600 "$HOME/snap-bootstrap/.env.prod.example" "$HOME/snap-deploy/.env"
```

Fill in the private `.env` using the production stack instructions. The script
supplies `SNAP_SHA` from its argument. Keep the same database and broker
credentials on subsequent releases. On a disposable VM use a local Git
clone with a `main` branch as the origin and load images tagged with its
commit SHAs.

Generate a separate CI key. Save its private half in GitHub's
`DEPLOY_PRIVATE_KEY` secret. Add its public half to `~deploy/.ssh/authorized_keys`
as one line and preserve the operator key. Use the actual absolute path
under the deploy user's home.

```text
command="/home/deploy/snap-deploy/bin/deploy-ssh.sh",restrict ssh-ed25519 PUBLIC_KEY snap-ci
```

Keep this line in the VM runbook setup because it is specific to Snap and
can be rotated without rebuilding the shared VM. `restrict` prevents
forwarding and PTY allocation. The wrapper accepts a single exact command
and logs refusals without copying the supplied command into the journal.
Treat the key as release authority. The deploy account has Docker access and
the approved release can run containers.

Save the host's exact `known_hosts` entry in `DEPLOY_KNOWN_HOSTS` after verifying
the SSH host key through the VM console or another trusted channel. Set
`DEPLOY_HOST` to that host name or IP when deployment is authorized. The
job checks the pinned host key and serializes deploys. From your computer,
with the deployment key, known-hosts file and variables set, try:

```sh
ssh -T -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" \
  -i "$deploy_key" "deploy@$host" "deploy $sha"
curl -fsS "https://$snap_host/health"
ssh -T -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" \
  -i "$deploy_key" "deploy@$host" rollback
```

Once the server has the lock, the deploy ignores SSH hangups and writes
progress to `~/snap-deploy/deploy.log`. SSH returns the final result line and exit status when
the connection stays open. Migration failures are logged as fixed diagnostic
categories so tool output cannot expose connection details. After a failed
CI deploy, use the operator key to check the log and `deployed` before
deciding whether to roll back.

```sh
tail -n 60 "$HOME/snap-deploy/deploy.log"
cat "$HOME/snap-deploy/deployed"
```

## What can go wrong

- **A new copy never becomes healthy.** The script allows 120 seconds, stops
  and removes the new copies, leaves old copies serving and exits 1.
- **A 502 during cutover.** Check the Docker health events and Traefik
  logs against the old copy's shutdown time. A late proxy refresh can mean
  the 12-second withdrawal was too short.
- **The forced command refuses.** Use exactly `deploy <40 lowercase hex
  characters>` or `rollback`. The wrapper rejects extra words.
- **SSH reports a host-key mismatch.** Verify the host's key through the
  VM console before updating `DEPLOY_KNOWN_HOSTS`.
- **The deploy lock is held.** Another deploy is running. Check its result
  before retrying.
- **The worker update fails.** The healthy API copies keep serving. Retry
  the same SHA to finish the worker update and record the release.
- **More than three API copies are running before deployment.** An
  interrupted cutover can leave both sets alive. Inspect IDs, images and
  health as the operator. Keep a healthy set and gracefully stop and remove
  the extras before retrying.

[Docker Compose scale-up implementation](https://github.com/docker/compose/blob/v2.40.3/pkg/compose/convergence.go) · [Traefik Docker event handling](https://github.com/traefik/traefik/blob/v3.7.19/pkg/provider/docker/pdocker.go)
