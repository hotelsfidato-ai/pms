-- =============================================================================
-- 088 · Adding somebody may not take over somebody who already exists
-- =============================================================================
-- THE HOLE. `POST /admin/staff` creates the person's Firebase account —
-- or, when that address already has one, ADOPTS it and sets the password
-- the manager typed (`ensureAccount`, identity.ts). It did that after only
-- two checks: the caller manages the hotel named, and the role is one they
-- may give.
--
-- So a general manager could "add" the OWNER — the owner's own email, any
-- role they are allowed to give, a password of their choosing — and the
-- owner's Firebase password became theirs. Firebase is not in the database
-- transaction, so the refusal that followed at the staff row changed
-- nothing: the password had already moved. They then signed in as a group
-- administrator, with every property.
--
-- `app.may_set_password` exists precisely to refuse that — its own comment
-- says "resetting a group administrator's password is how a property
-- manager becomes one" — but only the password endpoint asked it. Found in
-- the security review of 15 September; live since 9 September.
--
-- THE RULE. An address that already belongs to somebody may be claimed
-- only by a caller who may set THAT person's password. A new address, or
-- a Firebase account nobody here owns, is still adopted as before.
--
-- ⚠ SECURITY DEFINER, and that is the point. Asked under the caller's own
-- row policies, a manager cannot SEE the owner's staff row — the lookup
-- would come back empty, read as "a new address", and let the takeover
-- through. The question must see every row to be answered honestly; it
-- returns only a yes or a no.
-- =============================================================================

create or replace function app.may_claim_address(p_email text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select app.may_set_password(s.id)
       from staff s
      where s.email = p_email::citext),
    true);
$$;

comment on function app.may_claim_address(text) is
  'May this caller add somebody at this email address? Always, when nobody '
  'here has it. Otherwise only if they may set that person''s password '
  '(app.may_set_password). Asked BEFORE any Firebase account is touched — '
  'adopting an existing account sets its password, and Firebase cannot be '
  'rolled back.';

grant execute on function app.may_claim_address(text) to pms_app;

-- The refusal a person reads, in the house style of require_hotel_admin:
-- raised from the database, so it holds for any caller that asks it.
create or replace function app.require_claimable_address(p_email text)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if app.may_claim_address(p_email) then return; end if;
  raise exception
    'That address already belongs to somebody you cannot manage. Adding them '
    'here would change their password.'
    using errcode = 'insufficient_privilege',
          hint = 'Pick them on the People screen instead, or ask a group administrator.';
end $$;

comment on function app.require_claimable_address(text) is
  'Raises unless app.may_claim_address holds. Called by POST /admin/staff '
  'before ensureAccount — the order is the fix.';

grant execute on function app.require_claimable_address(text) to pms_app;
