-- =============================================================================
-- 141 · Offers only to a guest who said yes (the owner's D25-39, 25 September)
-- =============================================================================
-- Until now an offer could go to anybody who had not asked for none (D21-22,
-- `offer_opt_outs`, 122 § 7). The data protection law asks for opt-in from
-- 13 May 2027, and the owner chose it now: ONLY a guest who said yes gets
-- offers. A guest nobody asked counts as no (the owner, 26 September).
--
-- The yes is kept exactly as the no is (D21-22): against the PHONE NUMBER OR
-- EMAIL ITSELF, as its matching key, for the whole group. A later answer
-- replaces an earlier one: recording a yes takes that phone's or email's no
-- away, and recording a no takes its yes away. Who and when: recorded_by and
-- recorded_at, and the audit log keeps every row that was replaced.
--
-- Asked at booking, at the walk-in, at check-in, on the guest's own page and
-- on Guest 360 (the owner, 26 September).
-- =============================================================================

create table if not exists offer_opt_ins (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  value       text not null,
  -- Null when the guest ticked it on their own page: nobody at the hotel
  -- recorded it, the guest did.
  recorded_by uuid references staff(id),
  recorded_at timestamptz not null default now(),

  constraint offer_opt_ins_kind check (kind in ('phone', 'email')),
  constraint offer_opt_ins_is_a_key check (
    (kind = 'phone' and value = app.phone_key(value))
    or (kind = 'email' and value = app.email_key(value))),
  constraint offer_opt_ins_once unique (kind, value)
);

comment on table offer_opt_ins is
  'A phone number or email address that agreed to be sent offers, for the '
  'whole group (D25-39). Kept as its matching key. No row: no offers.';

alter table offer_opt_ins enable row level security;
alter table offer_opt_ins force  row level security;

drop policy if exists offer_opt_ins_read on offer_opt_ins;
create policy offer_opt_ins_read on offer_opt_ins
  for select using ( app.is_active_staff() );

-- Taking a yes away is the managers' on Guest 360, as clearing a no is.
drop policy if exists offer_opt_ins_clear on offer_opt_ins;
create policy offer_opt_ins_clear on offer_opt_ins
  for delete using ( app.is_crm_manager() );

grant select, delete on offer_opt_ins to pms_app;

drop trigger if exists offer_opt_ins_audit on offer_opt_ins;
create trigger offer_opt_ins_audit after insert or update or delete on offer_opt_ins
  for each row execute function app.write_audit();

-- THE YES. The one way it is recorded, from the desk and from the guest's own
-- page (inside app.guest_details_submit, which has no person behind it).
-- SECURITY DEFINER because it takes the same phone's or email's earlier no
-- away, which the desk may not delete by hand. A number under ten digits
-- records nothing. Answers how many of the two were newly agreed.
create or replace function app.record_offers_yes(p_phone text, p_email text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  v_rows int;
  v_key record;
begin
  for v_key in
    select 'phone' as kind, app.phone_key(p_phone) as value
    union all
    select 'email', app.email_key(p_email)
  loop
    continue when v_key.value is null;
    delete from offer_opt_outs where kind = v_key.kind and value = v_key.value;
    insert into offer_opt_ins (kind, value, recorded_by)
    values (v_key.kind, v_key.value, app.current_user_id())
    on conflict (kind, value) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return v_n;
end
$$;

comment on function app.record_offers_yes(text, text) is
  'The guest agreed to offers (D25-39): records the phone''s and email''s yes '
  'and takes away an earlier no on either.';

revoke all on function app.record_offers_yes(text, text) from public;
grant execute on function app.record_offers_yes(text, text) to pms_app;

-- THE NO, as 122 made it - and now it takes that phone's or email's yes away.
-- Same arguments and return type as 122's (MEMORY 317). Called only from the
-- managers' door on Guest 360, whose delete the policy above allows.
create or replace function app.record_no_offers(p_phone text, p_email text)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  v_rows int;
begin
  if app.phone_key(p_phone) is not null then
    delete from offer_opt_ins where kind = 'phone' and value = app.phone_key(p_phone);
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('phone', app.phone_key(p_phone), app.current_user_id())
    on conflict (kind, value) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  if app.email_key(p_email) is not null then
    delete from offer_opt_ins where kind = 'email' and value = app.email_key(p_email);
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('email', app.email_key(p_email), app.current_user_id())
    on conflict (kind, value) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  return v_n;
end
$$;

-- THE GUEST'S OWN TICK. 121's function, same arguments and return type
-- (MEMORY 317), plus one thing: "offersAgreed": true records the yes against
-- the phone and email on the guest's record, at once. The ID details still
-- wait for a clerk (D21-8); the yes is the guest's own word, not a document.
create or replace function app.guest_details_submit(
  p_token_hash text, p_unlock_hash text, p_details jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null then
    return false;
  end if;

  insert into guest_detail_submissions
    (hotel_id, reservation_id, guest_id, id_type, id_number,
     passport_expiry, visa_number, visa_expiry, address_line, city, country)
  values
    (v.hotel_id, v.reservation_id, v.guest_id,
     p_details->>'idType', trim(p_details->>'idNumber'),
     nullif(p_details->>'passportExpiry', '')::date,
     nullif(trim(p_details->>'visaNumber'), ''),
     nullif(p_details->>'visaExpiry', '')::date,
     nullif(trim(p_details->>'addressLine'), ''),
     nullif(trim(p_details->>'city'), ''),
     nullif(trim(p_details->>'country'), ''))
  on conflict (reservation_id) where status = 'waiting' do update set
     id_type = excluded.id_type, id_number = excluded.id_number,
     passport_expiry = excluded.passport_expiry,
     visa_number = excluded.visa_number, visa_expiry = excluded.visa_expiry,
     address_line = excluded.address_line, city = excluded.city,
     country = excluded.country, submitted_at = now();

  if p_details->>'offersAgreed' = 'true' then
    perform app.record_offers_yes(g.phone, g.email::text)
       from guests g where g.id = v.guest_id;
  end if;

  return true;
end
$fn$;
