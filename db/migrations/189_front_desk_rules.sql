-- ════════════════════════════════════════════════════════════════════
-- 189 · THE FRONT DESK'S RULES, PER HOTEL (the owner's D27-243, D27-246;
--       Settings phase 3: 3.1, 3.2, 3.3, 3.4, 3.6)
--
-- Each was fixed in code, the same at every hotel. Each default is what
-- the code did, so nothing changes until a hotel changes it:
--   3.1 default_payment_method   the way of paying the desk's screens start
--                                on (the bill, a function's bill, New
--                                booking's advance; the till keeps Cash)
--   3.2 desk_may_overbook        on: the desk may book past a full house, as
--                                today; off: refused like a machine's booking
--   3.3 advance_before_check_in  none (today) / first_night / whole_stay
--   3.4 weekend_days             days of the week shaded (0 Sunday .. 6
--                                Saturday, as JavaScript's getUTCDay)
--   3.6 default_id_type,         what the desk's forms start on; NULL is a
--       default_nationality,     blank box, as today
--       default_title
--
-- And D27-246's tick: a booking from a booking site is taken as PREPAID
-- there, ON by default; the desk unticks it when the guest pays at the hotel,
-- and only then is the advance before check-in asked of it.
-- ════════════════════════════════════════════════════════════════════

alter table hotels add column if not exists default_payment_method text not null default 'Cash';
alter table hotels drop constraint if exists hotels_default_payment_method_valid;
alter table hotels add constraint hotels_default_payment_method_valid
  check (default_payment_method in ('Cash', 'UPI', 'Credit Card', 'Debit Card'));

alter table hotels add column if not exists desk_may_overbook boolean not null default true;

alter table hotels add column if not exists advance_before_check_in text not null default 'none';
alter table hotels drop constraint if exists hotels_advance_before_check_in_valid;
alter table hotels add constraint hotels_advance_before_check_in_valid
  check (advance_before_check_in in ('none', 'first_night', 'whole_stay'));

alter table hotels add column if not exists weekend_days smallint[] not null default '{0,6}';
alter table hotels drop constraint if exists hotels_weekend_days_valid;
alter table hotels add constraint hotels_weekend_days_valid
  check (weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[]);

alter table hotels add column if not exists default_id_type text;
alter table hotels drop constraint if exists hotels_default_id_type_valid;
alter table hotels add constraint hotels_default_id_type_valid
  check (default_id_type is null
         or default_id_type in ('aadhaar', 'passport', 'driving_licence', 'voter', 'other'));

alter table hotels add column if not exists default_nationality text not null default 'IN';
alter table hotels drop constraint if exists hotels_default_nationality_valid;
alter table hotels add constraint hotels_default_nationality_valid
  check (default_nationality ~ '^[A-Z]{2}$');

alter table hotels add column if not exists default_title text;
alter table hotels drop constraint if exists hotels_default_title_valid;
alter table hotels add constraint hotels_default_title_valid
  check (default_title is null or default_title in ('Mr', 'Ms', 'Mrs', 'Dr'));

alter table reservations add column if not exists prepaid_on_site boolean not null default true;

comment on column reservations.prepaid_on_site is
  'D27-246: a booking-site booking paid on the booking site (on by default). '
  'Read only for a booking whose source is a booking site; the advance before '
  'check-in is asked of it only when the desk has unticked this.';
