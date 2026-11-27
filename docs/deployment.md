# Snap deployment runbook

## Provision the shared VM

Use an OCI Always Free tenancy in its home region. Keep the shared resource
totals within 2 A1 OCPUs, 12 GB RAM, 200 GB of block storage and 20 GB of
Object Storage. In the [shared server repository](https://github.com/devinder-dev/server),
use the private Terraform variables file and add the `apps` VM to `vms` with
1 OCPU, 4 GB and a 50 GB boot disk. Add the operator's public SSH key and a
real `backups_app_email`. Keep credential material out of the variables file
and Terraform state.

Run this from the server checkout. Review the plan before applying.

```sh
terraform -chdir=terraform plan
terraform -chdir=terraform apply
terraform -chdir=terraform output public_ips
terraform -chdir=terraform output -raw s3_endpoint
terraform -chdir=terraform output bucket_names
terraform -chdir=terraform output -raw photos_app_user
terraform -chdir=terraform output -raw backups_app_user
```

Create a DuckDNS name, and enter its name and token into the VM's root-only
`/etc/duckdns.env` following the server README. Start `duckdns.service`
and check that DNS resolves to the VM. Copy the server checkout's `edge/`
directory to the VM. Create the external Docker network and configure the
edge's private `.env` from its example. Test ACME staging first, then use
the production URL and a separate state filename.

```sh
sudo systemctl start duckdns.service
docker network inspect edge >/dev/null 2>&1 || docker network create edge
cd ~/edge
docker compose --env-file .env -f compose.yml -f compose.acme.yml up -d
```

## Install, deploy and enable jobs

Create one S3 customer secret key for each app identity in the OCI Console.
The photos key goes in `.env`. The backups key goes in `backup.env`.
Use the namespace endpoint from Terraform and the matching bucket and region
for each. Save the secrets directly into private files with mode 600.

Allow a new key to propagate. In the rehearsal, Oracle intermittently
returned `SignatureDoesNotMatch` with “The secret key required to complete
authentication could not be found” for about 10 minutes. After installing
the maintenance scripts, run `~/snap-deploy/bin/restore.sh versions` until
it succeeds five times in a row, including an empty version list for a
new key prefix. Verify that the photos key also succeeds repeatedly
before relying on either key or enabling the timers.

Put a trusted Snap checkout at `~/snap-bootstrap` on the VM. Install the
stable deploy scripts, clone the release source and configure the forced
command and pinned host key as described in [Deploying Snap](how-it-works/deploy.md).
Install the maintenance files from the same checkout:

```sh
cd ~/snap-bootstrap
install -m 700 infra/{backup,restore,restore-test,sweep,maintenance-common}.sh ~/snap-deploy/bin/
install -m 600 infra/backup-storage.py ~/snap-deploy/bin/
test -e ~/snap-deploy/backup.env || install -m 600 infra/backup.env.example ~/snap-deploy/backup.env
sudo install -m 644 infra/systemd/snap-{backup,sweep}.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
```

Fill in `~/snap-deploy/.env` from the [production example](../.env.prod.example),
including independent random hex values for the database and broker passwords.
Enter the actual HTTPS hostname and the demo password. Set `sha` to a
published main SHA that includes the backup tooling and deploy it:

```sh
~/snap-deploy/bin/deploy.sh "$sha"
cd ~/snap-deploy
read -r SNAP_SHA previous < deployed
export SNAP_SHA
compose=(docker compose -p snap-prod --env-file .env -f "releases/$SNAP_SHA/compose.prod.yml")
"${compose[@]}" run --rm --no-deps --pull never -T seed-demo
sudo systemctl enable --now snap-backup.timer snap-sweep.timer
systemctl list-timers snap-backup.timer snap-sweep.timer
curl -fsS "https://$snap_host/health/ready"
```

The sweep runs hourly and the backup starts at 02:15 UTC. System timers run
the jobs as `deploy`, so they work without an open login session.
`Persistent=true` lets systemd catch up after a missed start. Running a job
checks for live containers and shares the deployment lock. A parked stack
stays stopped.

Set GitHub's `DEPLOY_HOST` to the verified SSH endpoint and set
`SNAP_UPTIME_URL` to `https://<snap-host>/health/ready` while the app is live.
Enable **Email** and **Only notify for failed workflows** in the GitHub Actions
notification settings of the account responsible for the scheduled workflow.
GitHub sends scheduled-run notifications to the workflow's scheduling actor.
The check runs twice hourly and requires HTTP 200. It uses the public repo's
GitHub runner, so no external monitoring subscription is needed. Weekly CI
rebuilds and scans on Monday at 04:23 UTC. Both publishing and deployment
are push-only. GitHub can disable schedules in public repos after 60 days
without activity. [GitHub Actions notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs) · [GitHub schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Park

Disable uptime by removing `SNAP_UPTIME_URL`. Disable `DEPLOY_HOST` too so
a later main push cannot wake the stack. From the VM, stop the timers, take
a final backup and verify success before stopping Snap. Use the Compose
array above with the currently deployed SHA.

Removing the uptime variable leaves a skipped workflow run every 30 minutes.
To suppress those runs while parked, run `gh workflow disable uptime.yml`.
Run `gh workflow enable uptime.yml` when bringing Snap back online.

```sh
sudo systemctl disable --now snap-backup.timer snap-sweep.timer
sudo systemctl stop snap-backup.service snap-sweep.service
~/snap-deploy/bin/backup.sh &&
  flock -n ~/snap-deploy/deploy.lock "${compose[@]}" down
docker ps --filter label=com.docker.compose.project=snap-prod
```

Keep both named volumes and the private environment files. Parking stops
Snap's containers. The VM and any other projects on it keep running.
Check backups bucket usage while Snap is parked.

## Bring it back

If the named volumes survived, deploy the desired compatible SHA using the
same settings. Verify readiness with a bounded retry to allow the edge to
discover the route. Re-enable timers and GitHub variables when ready.

```sh
~/snap-deploy/bin/deploy.sh "$sha"
curl -fsS --retry 5 --retry-all-errors "https://$snap_host/health/ready"
sudo systemctl enable --now snap-backup.timer snap-sweep.timer
```

If the database volume was lost, bring up **only Postgres** using the selected
release files. On a replacement VM, first put a trusted SHA's Compose and
RabbitMQ files into `~/snap-deploy/releases/$sha` using `git archive` from the
trusted checkout. Use the same operator and S3 credentials as before,
or provision replacement keys. Leave uptime, CI deployment and timers off
until the restore succeeds.

```sh
cd ~/snap-deploy
export SNAP_SHA="$sha"
compose=(docker compose -p snap-prod --env-file .env -f "releases/$SNAP_SHA/compose.prod.yml")
"${compose[@]}" up -d --no-deps --wait postgres
bin/restore.sh versions
bin/restore.sh snap                 # Optional second argument: an older version ID.
bin/deploy.sh "$SNAP_SHA"
curl -fsS --retry 5 --retry-all-errors "https://$snap_host/health/ready"
```

If a failed version listing needs the OCI Console, continue with the chosen
ID or the current version. If recovering onto a non-empty volume, keep the
API and worker stopped and verify the archive before explicitly using
`bin/restore.sh --replace snap <version-id>`. The original database remains
available under the name reported by the script. After any recovery, check
known accounts, a chat and any unexpired photos before enabling the timers.
