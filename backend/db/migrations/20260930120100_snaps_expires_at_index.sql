-- migrate:up

-- The expiry job asks "which snaps are past expires_at?" every few minutes.
-- Without this that is a full scan of snaps each time.
create index snaps_expires_at_idx on snaps (expires_at);

-- migrate:down

drop index snaps_expires_at_idx;
