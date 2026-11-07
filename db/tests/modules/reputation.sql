-- =============================================================================
-- REVIEWS — the link nobody has given yet (docs/briefs/reputation.md)
-- =============================================================================
-- Refers to its migration by what it does — "the review link" — never by its
-- number: the master settles the number at merge, in merge order.
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here; what the APPLICATION may do is checked through its
-- grants, and row isolation through FORCE.
--
-- WHAT THIS FILE IS FOR. The owner's D18-14 asks for a review request carrying
-- THE GROUP'S OWN REVIEW LINK, and the owner has not given that link. Every
-- rule below exists so that the absence of it is a state the database holds
-- rather than a state the screens remember to pretend:
--   * a property has NO ROW until somebody types a link in — not '' and not a
--     placeholder, because '' and a placeholder are both things something
--     would eventually read as a link and send
--   * only an https address is stored at all, because it is put in front of a
--     guest
--   * a property's link is its own, and invisible at another property
--   * clearing it back to nothing is possible, and nothing is what refuses
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  clerk uuid; elsewhere uuid;
  n int; v text; failed boolean;
begin
  -- ---------- two properties ------------------------------------------------
  h     := app.provision_property_unchecked('RVW','Reviews Test','Nowhere');
  other := app.provision_property_unchecked('RVX','Reviews Other','Nowhere');

  insert into staff (email, full_name) values ('rvw-clerk@fidato.in', 'Reviews Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('rvw-else@fidato.in', 'Reviews Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (elsewhere, other, 'gm');

  perform set_config('app.user_id', clerk::text, true);

  -- ---------- nothing ships -------------------------------------------------
  select count(*) into n from review_links where hotel_id in (h, other);
  perform test.ok('reviews','a new property has no review link at all',
    n = 0, n || ' arrived with the property');

  -- ---------- the empty state has ONE spelling, and it is the missing row ----
  /* ⚠ EVERY REFUSED INSERT BELOW CLEANS UP AFTER ITSELF, and that is not
     tidiness. If a constraint is ever taken out, the insert SUCCEEDS, the
     assertion records its failure and carries on - and the next attempt
     then hits `review_links_pkey` and kills the whole suite, so one broken
     guard reads as a broken harness and every assertion after it never
     runs (MEMORY 289). Found by taking the https constraint out to watch
     these fail, 19 September. */
  failed := false;
  begin
    insert into review_links (hotel_id, url) values (h, '');
  exception when check_violation then failed := true;
  end;
  perform test.ok('reviews','an empty link cannot be stored - no row IS the empty state',
    failed, 'a link of '''' was accepted');
  delete from review_links where hotel_id = h;

  failed := false;
  begin
    insert into review_links (hotel_id, url) values (h, '   ');
  exception when check_violation then failed := true;
  end;
  perform test.ok('reviews','nor can a link of spaces',
    failed, 'a link of spaces was accepted');
  delete from review_links where hotel_id = h;

  -- ---------- it is put in front of a guest, so it is checked ---------------
  failed := false;
  begin
    insert into review_links (hotel_id, url) values (h, 'http://g.page/example');
  exception when check_violation then failed := true;
  end;
  perform test.ok('reviews','a plain http link is refused - the hotel vouches for what it sends',
    failed, 'http:// was accepted');
  delete from review_links where hotel_id = h;

  failed := false;
  begin
    insert into review_links (hotel_id, url) values (h, 'g.page/example');
  exception when check_violation then failed := true;
  end;
  perform test.ok('reviews','something that is not a web address at all is refused',
    failed, 'a bare word was accepted');
  delete from review_links where hotel_id = h;

  -- ---------- one a person typed --------------------------------------------
  insert into review_links (hotel_id, url, set_by)
  values (h, 'https://g.page/r/example-review-link/review', clerk);
  select url into v from review_links where hotel_id = h;
  perform test.ok('reviews','a link somebody typed is stored exactly as typed',
    v = 'https://g.page/r/example-review-link/review', coalesce(v, 'null'));

  -- one row per property, and typing a second one replaces the first
  insert into review_links (hotel_id, url, set_by)
  values (h, 'https://g.page/r/corrected/review', clerk)
  on conflict (hotel_id) do update set url = excluded.url;
  select count(*) into n from review_links where hotel_id = h;
  perform test.ok('reviews','a property holds one link, not a history of them', n = 1, n || ' rows');

  -- ---------- a time belongs to its property (113) --------------------------
  update hotels set timezone = 'Asia/Kolkata' where id = h;
  update review_links set set_at = app.hotel_moment(h, '2026-09-19T11:45') where hotel_id = h;
  select app.hotel_clock(h, set_at) into v from review_links where hotel_id = h;
  perform test.ok('reviews','the moment a link was set reads back in the property''s own time',
    v = '2026-09-19T11:45', coalesce(v, 'null'));

  -- ---------- one property cannot read another's ---------------------------
  perform set_config('app.user_id', elsewhere::text, true);
  set local role pms_app;
  select count(*) into n from review_links where hotel_id = h;
  reset role;
  perform test.ok('reviews','a property''s link is invisible at another property',
    n = 0, n || ' rows were readable from RVX');

  -- and cannot be written either: the policy has a with check as well
  perform set_config('app.user_id', elsewhere::text, true);
  set local role pms_app;
  failed := false;
  begin
    insert into review_links (hotel_id, url) values (h, 'https://someone.elses/link');
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('reviews','nor can another property''s clerk set it',
    failed, 'a link was written into RVW from RVX');

  perform set_config('app.user_id', clerk::text, true);

  -- ---------- clearing it back to nothing -----------------------------------
  set local role pms_app;
  delete from review_links where hotel_id = h;
  reset role;
  select count(*) into n from review_links where hotel_id = h;
  perform test.ok('reviews','the application can clear a link back to nothing',
    n = 0, n || ' rows left, so the empty state is unreachable');

  -- ---------- the record of what was sent is not this service's to write -----
  -- `messages_sent` belongs to the shared sender (its own migration), and this
  -- service calls that door rather than writing the table. Checked here
  -- because a second writer is the thing the door exists to prevent.
  perform test.ok('reviews','a review request is recorded through the shared sender',
    has_function_privilege('pms_app',
      'app.record_message_sent(uuid, text, text, text, text, text, text, text, text, integer, text, text, uuid)',
      'execute'),
    'pms_app cannot reach the one door out');

  -- ---------- clean up ------------------------------------------------------
  delete from review_links where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  update staff set is_active = false where id in (clerk, elsewhere);

  select count(*) into n from hotels where code in ('RVW', 'RVX');
  perform test.ok('reviews','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

-- =============================================================================
-- THE FEEDBACK SURVEY (D27-383 item 10)
-- =============================================================================
-- Refers to its migration by what it does - "the feedback survey". Off to
-- start; after check-out only; once a stay; the guest's two functions with
-- and without the unlock (OCI-5); staff read the answers and write none.
do $$
declare
  h uuid; guest uuid; stay uuid; link uuid; clerk uuid;
  said text; n int; failed boolean; d date;
  tok text := repeat('f', 64); unl text := repeat('g', 64);
begin
  h := app.provision_property_unchecked('RVF','Feedback Test','Nowhere');
  d := app.business_date(h);
  insert into staff (email, full_name) values ('rvf-gm@fidato.in', 'Feedback GM')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'gm');
  insert into guests (full_name) values ('Feedback Guest') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1), d - 2, d, 2000, 'checked_in')
  returning id into stay;
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay, tok, now() + interval '1 day') returning id into link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link, stay, unl, now() + interval '1 hour');

  perform test.ok('feedback', 'a property does not ask until it is switched on',
    not app.module_enabled(h, 'feedback_survey'));
  perform test.ok('feedback', 'the module is one the database knows',
    (select pg_get_constraintdef(oid) like '%''feedback_survey''%' from pg_constraint where conname = 'hotel_modules_known'));
  perform test.ok('feedback', 'a test hotel clears the answers with its trade',
    exists (select 1 from app.test_hotel_classes() where table_name = 'guest_feedback' and class = 'trading'));

  said := app.guest_survey_answer(tok, unl, 5, null, null, null, null, null);
  perform test.ok('feedback', 'switched off: refused', said = 'off', said);
  insert into hotel_modules (hotel_id, module, is_enabled) values (h, 'feedback_survey', true);

  said := app.guest_survey_answer(tok, unl, 5, null, null, null, null, null);
  perform test.ok('feedback', 'before check-out: refused', said = 'not_yet', said);
  update reservations set status = 'checked_out' where id = stay;

  said := app.guest_survey_answer(tok, 'nope', 1, null, null, null, null, 'link alone');
  perform test.ok('feedback', 'the link alone answers nothing', said = 'locked', said);
  perform test.ok('feedback', 'nor reads whether it is offered',
    not exists (select 1 from app.guest_survey(tok, 'nope')));
  perform test.ok('feedback', 'offered with the unlock, after check-out',
    (select offered and not answered from app.guest_survey(tok, unl)));

  said := app.guest_survey_answer(tok, unl, 2, 1, null, 3, 4, '  The AC was loud.  ');
  perform test.ok('feedback', 'one answer is kept', said = 'saved', said);
  said := app.guest_survey_answer(tok, unl, 5, 5, 5, 5, 5, 'second');
  select count(*) into n from guest_feedback where reservation_id = stay;
  perform test.ok('feedback', 'never a second', said = 'answered' and n = 1, said || ', ' || n || ' rows');
  perform test.ok('feedback', 'the first stands, its comment trimmed',
    (select overall = 2 and comment = 'The AC was loud.' from guest_feedback where reservation_id = stay));
  perform test.ok('feedback', 'and it is no longer offered',
    (select not offered and answered from app.guest_survey(tok, unl)));

  failed := false;
  begin
    insert into guest_feedback (hotel_id, reservation_id, overall) values (h, stay, 1);
  exception when unique_violation then failed := true;
  end;
  perform test.ok('feedback', 'the database itself keeps one a stay', failed, 'a second row went in');
  failed := false;
  begin
    update guest_feedback set overall = 6 where reservation_id = stay;
  exception when check_violation then failed := true;
  end;
  perform test.ok('feedback', 'a score is 1 to 5', failed, 'a 6 was kept');

  perform test.ok('feedback', 'staff read the answers and write none',
    has_table_privilege('pms_app', 'guest_feedback', 'select')
    and not has_table_privilege('pms_app', 'guest_feedback', 'insert')
    and not has_table_privilege('pms_app', 'guest_feedback', 'update')
    and not has_table_privilege('pms_app', 'guest_feedback', 'delete'));

  -- ---------- clean up ----------
  delete from guest_unlocks where link_id = link;
  delete from guest_links where hotel_id = h;
  delete from hotel_modules where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;
end $$;
