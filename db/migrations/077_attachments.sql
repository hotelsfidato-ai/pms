-- =============================================================================
-- 077 · Attachments — the first file this system has ever kept
-- =============================================================================
-- Nothing in this database has ever stored a file. `guest_documents` keeps a
-- passport NUMBER and an expiry date, never an image. So §15 — every purchase
-- carries its physical supplier bill — needed a place for bytes to live before
-- any of Stage E could be written.
--
-- WHERE THE BYTES ACTUALLY ARE IS NOT DECIDED HERE.
--
-- `storage_backend` + `storage_key` and nothing more. The row says *which
-- store* and *what it is called in that store*, so moving from a disk on the
-- box to Oracle Object Storage is a copy and a config change rather than a
-- migration. The owner asked for bills in Google Drive through n8n; the
-- argument made back was that the PMS should own the record and Drive should
-- be a MIRROR, because a folder anybody can drag to the bin is not where a GST
-- invoice should exist only once. This shape supports either answer without
-- being rebuilt.
--
-- THE MIRROR IS RECORDED, NOT ASSUMED. `mirror_url` is null until something
-- says otherwise. A page that shows a Drive link before Drive has the file is
-- lying to the person who has to produce that bill for an assessor.
--
-- WHY THE HASH.
--
-- The same bill photographed twice, or a browser retrying an upload, produces
-- two rows pointing at two identical files. `sha256` makes that VISIBLE rather
-- than duplicating the store — and it is also the only way to answer "is the
-- file we are holding the file that was uploaded", which is the question that
-- matters when a purchase is queried a year later.
-- =============================================================================

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- What it is attached to. The same loose pairing `approvals` uses, for the
  -- same reason: one foreign key cannot point at four tables, and altering
  -- this table every time something new becomes attachable is worse.
  subject_table text not null,
  subject_id    uuid not null,

  -- What the person called it. Shown to people; never used as a path — a
  -- filename from a phone can contain anything, including a directory
  -- traversal, and the thing that names it on disk is `storage_key`.
  filename      text not null,
  content_type  text not null,
  byte_size     bigint not null,
  sha256        text not null,

  -- WHICH STORE, and what it is called in it.
  storage_backend text not null default 'disk',
  storage_key     text not null,

  -- Where a human can find it, once something has put it somewhere human.
  -- Null until then, and null is honest: it means nobody has mirrored it yet.
  mirror_url    text,
  mirrored_at   timestamptz,

  uploaded_by   uuid references staff(id),
  uploaded_at   timestamptz not null default now(),

  constraint attachments_filename_present check (length(trim(filename)) > 0),
  constraint attachments_size_sane check (byte_size > 0),
  constraint attachments_hash_shape check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint attachments_key_present check (length(trim(storage_key)) > 0),
  -- A mirror has a place AND a time, or neither. Half of it recorded is a
  -- row nobody can act on.
  constraint attachments_mirror_complete check (
    (mirror_url is null) = (mirrored_at is null))
);

comment on table attachments is
  'A file kept against a record. Says WHICH store holds the bytes and what '
  'they are called there, so the store can change without a migration.';

-- Two uploads of the same bytes against the same record is a retry, not two
-- bills. The store keeps one copy and the second upload finds this.
create unique index if not exists attachments_no_duplicate
  on attachments (hotel_id, subject_table, subject_id, sha256);

create index if not exists attachments_subject
  on attachments (hotel_id, subject_table, subject_id, uploaded_at desc);

-- Everything not yet mirrored, which is the queue n8n reads. Partial, so it
-- stays small however many files the property accumulates.
create index if not exists attachments_awaiting_mirror
  on attachments (hotel_id, uploaded_at)
  where mirror_url is null;


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table attachments enable row level security;
alter table attachments force  row level security;
drop policy if exists attachments_isolation on attachments;
create policy attachments_isolation on attachments
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- A bill is evidence. Who uploaded what, and when it was mirrored, is exactly
-- the history somebody needs when a purchase is queried.
drop trigger if exists attachments_audit on attachments;
create trigger attachments_audit
  after insert or update or delete on attachments
  for each row execute function app.write_audit();
