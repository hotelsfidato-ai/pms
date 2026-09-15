-- =============================================================================
-- 021_reversal_once.sql — a posting may be reversed at most once
-- =============================================================================
-- Found at CP10, building the reversal endpoint.
--
-- The first version locked the posting with `select ... for update` before
-- inserting its reversal, to stop two clerks reversing the same charge at the
-- same moment and creating two credits.
--
--   ERROR:  permission denied for table folio_postings
--
-- `pms_app` has SELECT and INSERT on this table and deliberately NOT UPDATE —
-- the ledger is append-only, and `FOR UPDATE` requires the update privilege
-- even when nothing is updated. The permission was not in the way; it was
-- telling me the lock was the wrong tool for an append-only table.
--
-- A UNIQUE INDEX says the same thing without a lock, and says it to everyone
-- rather than only to the code path that remembers to take one:
--
--   one posting  →  at most one reversal
--
-- Two concurrent reversals now leave one inserted and one refused by the
-- database, which is the same outcome the lock was reaching for.
-- =============================================================================

-- Existing data must satisfy it, or the index will not build. Nothing in the
-- demo or the suite double-reverses; this reports it rather than failing
-- cryptically if that ever changes.
do $$
declare n int;
begin
  select count(*) into n
    from (
      select reverses_id
        from folio_postings
       where reverses_id is not null
       group by reverses_id
      having count(*) > 1
    ) dupes;

  if n > 0 then
    raise exception
      '021: % postings already carry more than one reversal. The ledger has '
      'double credits in it and they must be understood before this index '
      'can be trusted to prevent more.', n;
  end if;
end $$;

create unique index if not exists folio_postings_one_reversal
  on folio_postings (reverses_id)
  where reverses_id is not null;

comment on index folio_postings_one_reversal is
  'A posting may be reversed at most once. Replaces a SELECT ... FOR UPDATE '
  'that pms_app cannot perform — it has no UPDATE on this table, because the '
  'ledger is append-only.';


do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'folio_postings_one_reversal'
  ) then
    raise exception '021: folio_postings_one_reversal was not created';
  end if;
end $$;
