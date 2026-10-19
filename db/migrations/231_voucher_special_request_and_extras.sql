-- =============================================================================
-- 231 · The booking confirmation as the old system's (the owner's D27-344, 19
--       October; D27-347: the special request is a box of its own)
-- =============================================================================
-- (1) `reservations.special_request`: what the guest asked for, typed in its
--     own box on New booking (or a booking site's or the CRS's request, copied
--     in), and printed on the voucher. The booking's notes stay the hotel's own
--     and never reach the guest.
-- (2) `app.voucher_more(reservation)`: what the voucher prints besides
--     app.guest_voucher's facts - the arrival time, the special request, the
--     room promotion, and the booking's extras (reservation_inclusions, every
--     room of a group's). An extra's GST is the room rule's at its rate, as
--     the desk's Add charge posts it (postCharge's taxKind defaults to room);
--     no rule, no rate (a dash). A definer, as app.voucher_meal_days: the
--     sweep that sends vouchers has nobody signed in.
--
-- Re-runnable.
-- =============================================================================

alter table reservations add column if not exists special_request text;
alter table reservations drop constraint if exists reservations_special_request_length;
alter table reservations add constraint reservations_special_request_length
  check (special_request is null or length(special_request) <= 500);
comment on column reservations.special_request is
  'D27-347: the guest''s special request, printed on the booking voucher. Notes are the hotel''s own.';

create or replace function app.voucher_more(p_reservation uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'arrivalTime', to_char(r.expected_arrival, 'HH24:MI'),
    'specialRequest', nullif(btrim(r.special_request), ''),
    'promotion', case when p.id is null then null
                      else jsonb_build_object('name', p.name, 'percent', p.percent, 'amount', p.amount) end,
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', ri.name, 'quantity', ri.quantity, 'rate', ri.rate,
               'gstRate', case when ri.rate is null then null
                               else app.gst_rate_or_null(r.hotel_id, 'room', ri.rate) end)
             order by ri.created_at)
        from reservation_inclusions ri
       where ri.reservation_id in (
               select x.id from reservations x
                where x.id = r.id or (r.group_id is not null and x.group_id = r.group_id))
    ), '[]'::jsonb))
    from reservations r
    left join room_promotions p on p.id = r.room_promotion_id
   where r.id = p_reservation
$$;
revoke all on function app.voucher_more(uuid) from public;
grant execute on function app.voucher_more(uuid) to pms_app;
