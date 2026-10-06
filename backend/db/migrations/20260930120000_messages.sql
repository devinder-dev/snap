-- migrate:up

-- Text chat between two users. Unlike snaps these persist: a conversation is
-- history, not a one-shot view.
create table messages (
  id           bigserial primary key,
  sender_id    bigint not null references users(id) on delete cascade,
  recipient_id bigint not null references users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

-- A conversation is read as two halves — my messages to them, and theirs to
-- me — each newest first. One index per direction serves each half of that
-- UNION ALL, including the `id < before` pagination and the sort.
create index messages_sender_recipient_id_idx on messages (sender_id, recipient_id, id desc);
create index messages_recipient_sender_id_idx on messages (recipient_id, sender_id, id desc);

-- migrate:down

drop table messages;
