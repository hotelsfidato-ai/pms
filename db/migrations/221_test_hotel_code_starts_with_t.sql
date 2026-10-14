-- =============================================================================
-- 221 · A test hotel's code is "T" + the real code (the owner's D27-320,
--       14 October)
-- =============================================================================
-- "test hotels" made a test hotel's code as the real code + "T", and SHI's
-- became "SHIT" on live. From here a NEW test hotel is "T" + the real code:
-- TSHI, TAMR. A test hotel already made keeps its code (AMRT stays; SHI's is
-- removed and made again by the owner after the release).
--
-- Only the code rule of app.create_test_hotel changes; the rest is "test
-- hotels"' own body, word for word. The code still fits hotels_code_format
-- (002: [A-Z0-9]{2,10}): "T" + the first nine of the real code. When that is
-- taken, the first free "T" + code + 2, 3 ... 99, the code cut short so the
-- number still fits in ten.
--
-- Re-runnable: create or replace, same signature, so its owner, grants and
-- comment stay as "test hotels" left them.
-- =============================================================================

create or replace function app.create_test_hotel(p_real uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       hotels;
  v_code  text;
  v_n     int;
  v_id    uuid;
  v_copied bigint;
begin
  perform app.require_test_hotel_admin();
  select * into r from hotels where id = p_real;
  if r.id is null then
    raise exception 'No such property.' using errcode = 'no_data_found';
  end if;
  -- A test hotel of a test hotel is hotels_test_rules' to refuse.
  if exists (select 1 from hotels where test_of = p_real) then
    raise exception '% already has a test hotel: %.', r.name,
      (select code from hotels where test_of = p_real)
      using errcode = 'unique_violation';
  end if;

  -- (D27-320) "T<CODE>", or the first free variant that fits the code's shape.
  v_code := 'T' || left(r.code, 9);
  v_n := 1;
  while exists (select 1 from hotels where code = v_code) loop
    v_n := v_n + 1;
    if v_n > 99 then
      raise exception 'No free code is left for a test hotel of %.', r.name;
    end if;
    v_code := 'T' || left(r.code, 9 - length(v_n::text)) || v_n;
  end loop;

  insert into hotels (code, name, city, state, timezone, test_of)
  values (v_code, r.name || ' · TEST', r.city, r.state, r.timezone, p_real)
  returning id into v_id;

  -- What a new hotel is seeded with (payment methods, lists, stores, KOT
  -- kinds, approval rules) is replaced by the real hotel's own.
  perform set_config('app.test_reset', v_id::text, true);
  perform app.test_hotel_clear(v_id, 'setup');
  v_copied := app.copy_hotel_setup(p_real, v_id);
  perform app.copy_hotel_row(p_real, v_id);
  perform set_config('app.test_reset', '', true);

  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (v_id, app.current_user_id(), 'hotels', v_id::text, 'TEST_CREATE', null,
          jsonb_build_object('copiedFrom', r.code, 'copied', v_copied,
                             'by', (select full_name from staff where id = app.current_user_id())));
  return v_id;
end $$;
