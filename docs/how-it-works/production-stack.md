# Snap's production stack

The shared VM can publish ports 80 and 443 once. The shared Traefik edge receives HTTPS and sends requests for Snap's hostname to three API copies. Each copy can use the same Postgres database and RabbitMQ broker. The worker removes expired photos.

```text
Internet -> shared Traefik :443 -> edge -> API x3 -> private -> Postgres
                                           |          |
                                           |          +-----> RabbitMQ
                                           |          |
                                           |        worker -> outbound
                                           |                      |
                                           +-----> Oracle Object Storage
```

- **External network.** `edge` is a shared Docker bridge created outside Snap. Traefik finds the `snap-api` router by its Docker labels and forwards to port 3000 on that bridge. For example, `SNAP_HOST=snap.example.test` only matches requests for that host. Only trusted projects should join the bridge. Snap trusts one forwarded-IP hop because the edge proxy is its public entry point.
- **Private network.** Snap creates an internal bridge for services such as Postgres. The database and broker attach only to it. Snap publishes no host ports. The API reaches Oracle through `edge` and the worker, sweep and e2e use `outbound`, a regular bridge with an internet route. No other project needs access to the private bridge.
- **Image by SHA.** The full Git commit hash in `SNAP_SHA` selects a specific release, such as the image tagged with the checkout's 40-character commit. The app tag runs API, worker and sweep. The tools tag runs migrations, e2e and demo seeding. Both are multi-platform releases.
- **Memory limit.** Docker applies a ceiling to each container. For example, each API copy can use up to 256 MiB. The six long-running containers total 2,432 MiB of limits. With the host and edge measured at about 460 MiB, that leaves roughly 1.2 GiB on the 4 GiB VM before on-demand tools. RabbitMQ alarms at 512 MiB, below its 768 MiB limit. Measure baseline use and headroom before the proof. An alarm causes the API to drop live pushes without losing the HTTP write.
- **Demo mode.** Public registration returns HTTP 403 unless a request includes the server's code in the `x-snap-registration-code` header. The app leaves public visitors on seeded accounts and explains the 403 in Swedish. The code stays on the server and in the operator's test environment. When the code is unset, the laptop and CI keep open registration.
- **S3-compatible endpoint.** Oracle implements S3 requests for objects in a bucket. An endpoint such as the namespace host from Terraform's `s3_endpoint` output lets Bun call Oracle using the same upload, presign, and delete functions.

## Try it yourself

Start the shared edge first and use the standalone production file. The laptop and CI files carry development services and ports, so leave them out of the production invocation. Keep the server's `.env` private.

```sh
cp -n .env.prod.example .env
chmod 600 .env
# Fill in .env in an editor. Use independent hex values for DB and broker passwords.
docker compose --env-file .env -f compose.prod.yml config --quiet
docker compose --env-file .env -f compose.prod.yml pull
docker compose --env-file .env -f compose.prod.yml up -d
docker compose --env-file .env -f compose.prod.yml ps
docker compose --env-file .env -f compose.prod.yml run --rm seed-demo
```

Generate the database and broker passwords with separate `openssl rand -hex 32` calls. Hex characters work both as passwords and inside the connection URLs. Use a separate random registration code and JWT secret. Set `SNAP_DEMO_PASSWORD` to seed the three demo accounts. Anna and Ben start as mutual friends. Cara starts with nobody. Rerunning seeds the Anna–Ben friendship without removing relationships made during a demo.

On the public host, `curl -fsS https://<host>/health` checks liveness, and `/health/ready` checks Postgres, RabbitMQ, and the relay on the responding copy. Compose and Traefik use liveness to keep a shared dependency outage from removing all copies. Migrations run as a one-shot service. The Postgres and RabbitMQ named volumes survive a normal Compose stop or down. Reuse the same project name and the same volume credentials when starting again.

### Rehearsal measurements

On the 3,901 MiB test VM, the stack used 1,120 MiB including the 188 MiB
S3 stand-in. Without it, the estimate is about 930 MiB (24%), above Oracle's
20% idle memory threshold. RabbitMQ used 132 MiB and did not raise an alarm.
This was a snapshot after e2e. Oracle's idle assessment runs over several days.

In the live chat rehearsal, clients reconnected in about one second after two
API processes crashed. Docker restarted both. To rehearse a crash on a disposable
VM, use `sudo kill -9 "$(docker inspect -f '{{.State.Pid}}' snap-prod-api-1)"`.
A deliberate `docker kill` can leave the container stopped under
`unless-stopped`. Start it again with Compose if you intentionally stop it.

## Oracle photo storage

Use Oracle's **Customer Secret Key** for the photo-storage identity. Its access-key ID goes in `S3_ACCESS_KEY_ID`. Its secret half goes in `S3_SECRET_ACCESS_KEY`. The key for signing Terraform API requests is separate. Create both by hand and keep their secrets out of Git and Terraform state. Give the storage identity access to the private photos bucket and stay within the tenancy's shared Always Free storage and request limits.

- `S3_REGION` is the OCI region identifier, such as `eu-stockholm-1`.
- `S3_BUCKET` is the photos bucket name from Terraform's `bucket_names` output.
- `S3_ENDPOINT` is the namespace host, without a bucket or object suffix. Copy `terraform -chdir=terraform output -raw s3_endpoint` from the server repo. Oracle's current commercial path-style form is `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`. If OCI supplies `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com` for your tenancy, use the supplied namespace endpoint. Keep the region and hostname consistent when signing.
- With the custom endpoint, Snap uses Bun's path-style addressing. The bucket goes in the path, as in `/photos/object-id`. Virtual-hosted addressing puts the bucket in the hostname and uses OCI's different `vhcompat` endpoint. A phone fetches the presigned URL straight from Oracle, so the host must be reachable outside Docker.

[Oracle S3 compatibility and Customer Secret Keys](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm) · [Oracle path-style and virtual-hosted endpoints](https://docs.oracle.com/en-us/iaas/Content/Object/s3-virtual-style.htm)

## What can go wrong

- **Traefik 404.** Check the requested hostname, `SNAP_HOST`, and the `traefik.enable` label.
- **502 or 504.** Check that the copies joined `edge` and listen on port 3000. Inspect `docker network inspect edge`.
- **`SignatureDoesNotMatch`.** Compare the endpoint, region, addressing style, and Customer Secret Key with the photos bucket.
- **403 on registration.** Check the operator code and the request's registration header. Public app users can log in with an existing demo account.
- **Compose refuses to start.** The error names the missing `.env` setting. Use `config --quiet` to check without printing resolved secrets.
- **RabbitMQ alarm or out-of-memory restart.** Check `docker stats --no-stream` and the broker logs. Confirm whether normal memory use is below the alarm before running the proof.

## Runtime and debugging

The `app` target uses Bun's distroless image. **Distroless** means the runtime
ships with enough OS files to run Bun and the app, without a shell or package
manager. In the rehearsal, it was 257 MB versus 379 MB for the old Debian slim
runtime. Trivy reported 39 findings (0 HIGH/CRITICAL) versus 241 (46
HIGH/CRITICAL). Debian remains in the tools image and dependency build stages.

Read normal logs with `docker compose -f compose.prod.yml logs api worker`.
For a disposable debugging shell, join one copy's process and network namespaces:

```sh
id=$(docker compose -f compose.prod.yml ps -q api | head -n 1)
test -n "$id" && docker run --rm -it --pid="container:$id" \
  --network="container:$id" busybox:1.37.0 sh
```

Inside, `ps` shows the shared process list and `wget -qO- http://127.0.0.1:3000/health`
checks that copy directly. The helper does not need the Docker socket or
privileged mode. Exit the shell and Docker removes it.

New registrations use letters A–Z, digits, underscores, dots and hyphens
in names of 1–32 characters. The names `.` and `..` are reserved as path
segments. This keeps new usernames usable in routes such as
`/messages/alex-2`, even though the edge blocks ambiguous path escapes.
Existing accounts are unchanged.

Postgres and RabbitMQ use matching patch tags in production, laptop and CI.
The root Dependabot Docker Compose job includes `compose.prod.yml`. Review
updates to both pins together.

[Dependabot Compose filename matching](https://github.com/dependabot/dependabot-core/blob/main/docker/lib/dependabot/docker_compose/file_fetcher.rb)
