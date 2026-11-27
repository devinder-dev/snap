# Migrations during a deploy

The new tools image runs dbmate while the previous API and worker still serve.
An **expand/contract migration** changes the schema in stages. For example, add
a nullable column first. Deploy code that can read either column and write both,
then backfill. Switch reads and writes to the new column. Remove the old column
in a later release, once the running and rollback versions have stopped using it.
Keep locks short on populated tables.

Deploy and rollback both run forward migrations. dbmate records applied versions
in `schema_migrations` and skips them on repeat runs. Never edit a migration that
has shipped or run its down section as part of an app rollback. The four initial
up migrations only create tables and indexes. Their drops are in down sections.
