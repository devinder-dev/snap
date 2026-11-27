# Backups and restore

If the VM disk disappears, Postgres loses accounts, friendships, messages and
snap metadata. The nightly job makes a new database archive and uploads it to
a private bucket. A restore drill proves that Postgres can read the archive and
that unexpired photo links still work.

```text
Postgres → pg_dump → private temporary archive → backups bucket
                                                  snap/postgres.dump
                                                  ├─ current version
                                                  └─ previous versions
                                                           ↓
                                 empty database ← pg_restore
                                      ↓
                          presigned GET → photos bucket
```

- **pg_dump** takes a consistent database snapshot while requests continue.
  **Custom format** is the compressed archive read by `pg_restore`. Running
  the tools inside the Postgres container gives them the server's version.
- The script finishes the dump to a private temporary file first. If the dump
  fails halfway through, the current backup is still intact. Curl streams
  that file through a single signed PUT with a SHA-256 checksum, using the
  Ubuntu tools already on the VM. A download must match the stored checksum.
- **Versioning** means another upload to `snap/postgres.dump` keeps the previous
  bytes under a version ID. The **lifecycle rule** removes previous versions after
  14 days. The current version stays. A dump is limited to 256 MiB. At one upload
  per day, 15 versions at the limit would take about 3.75 GiB. Include manual
  backups and other projects when checking the tenancy's shared 20 GB.
- A **restore test** loads an archive into a randomly named `zzt_restore_…`
  database, reports row counts and checks that every unexpired photo returns
  HTTP 200 via a presigned GET. The test drops just its own database when it
  exits. Exit 0 means all checks passed, exit 1 means a check failed, and exit
  2 means the database restored but there were no living photo snaps to check.
  For a full drill, send one photo snap, take a backup, and run the drill
  before that snap expires.
- **How much data can be lost.** If a disk fails just before the nightly backup,
  up to 24 hours of database writes can be lost. A failed nightly backup can
  make that window longer. **How long a restore takes.** The scripts report
  elapsed seconds. The VM rehearsal backed up a 15 KB archive in under one
  second and restored both the latest and an older version. Download speed,
  archive size and index rebuilding affect restore time.
- RabbitMQ timers are disposable. After a restore, the hourly sweep finds
  expired snaps through Postgres and removes their photos. The photos bucket
  has its own two-day lifecycle. Restoring the database cannot recover photo
  objects that already expired or were deleted.

## Name map

| Name | Kind | Where it lives | What it does |
| --- | --- | --- | --- |
| Photos app user | OCI identity | Shared server Terraform | Can create, read and delete photo objects. |
| Photos S3 key | Customer secret key | VM `~/snap-deploy/.env` | Lets the app serve and clean up photos. |
| Backups app user | OCI identity | Shared server Terraform | Can write and read backups and inspect versions. Deletion stays with the operator. |
| Backups S3 key | Customer secret key | VM `~/snap-deploy/backup.env` | Gives the backup and restore scripts access to the backup bucket. |
| Deploy key | SSH key pair | GitHub secret and VM `authorized_keys` | Can request a release deploy or rollback. |
| Operator key | SSH key pair | Operator's computer and VM `authorized_keys` | Opens an administration session to install or recover the stack. |
| `deploy` | Linux user | Shared VM | Owns the Snap files and runs Docker and the maintenance jobs. |

## Try it yourself

On the VM as `deploy`, while Snap is running and has an unexpired photo:

```sh
~/snap-deploy/bin/backup.sh
~/snap-deploy/bin/restore.sh versions
~/snap-deploy/bin/restore-test.sh
journalctl -u snap-backup.service -u snap-sweep.service -n 30
```

`restore.sh <database>` downloads the current version. Pass a version ID as
the second argument for an older one. Version listing and download by ID
both worked on Oracle in the rehearsal. If an endpoint rejects S3 version
listing, find the ID in the OCI Console under the backup object's versions
and pass it directly. OCI documents version IDs for S3 object requests and
documents version listing through its native API. [OCI S3 compatibility](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi_topic-Amazon_S3_Compatibility_API_Support.htm) · [OCI Console version listing](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingversioning_topic-To_list_object_versions.htm)

In the Oracle permission drill, the backups key received 404 when deleting
an object or version, or listing or writing the photos bucket. The service
request `GET /` returned HTTP 200 with an empty `ListAllMyBucketsResult`.
Zero bucket names were exposed.

## What can go wrong

- **Postgres is stopped.** A manual backup exits nonzero. A timer logs a skip
  and exits successfully while Snap is parked.
- **Dump exceeds the spool limit.** The uploader keeps the current backup.
  Check disk space and storage usage before changing the limit.
- **Download checksum mismatch.** The archive never reaches Postgres. Check
  the selected version and try an older one if necessary.
- **Target database is not empty.** Use an empty database. For an intentional
  offline replacement, `--replace` restores into a staging database before
  swapping names and retains the old database as `snap_before_…`.
- **A photo returns 404.** Its row was recovered but its object is missing.
  Check when the photo expired and whether the bucket lifecycle already ran.
- **S3Mock 5.2.3 says the endpoint did not return a version list.** The
  stand-in wraps versions in `ListBucketResult`. The helper expects
  `ListVersionsResult`, as Oracle returns. Use a known version ID to
  rehearse downloading an older version on the stand-in.
