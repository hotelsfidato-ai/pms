-- =============================================================================
-- 004_guests.sql — GROUP-LEVEL. Read this before adding hotel_id here.
-- =============================================================================
-- These tables deliberately have NO hotel_id.
--
-- A guest who stays at Agra in March and Pune in June is ONE person. Scope
-- guests per hotel and you get seven copies of them: no stay history, no
-- loyalty, no repeat-guest recognition, and — the one that actually costs you
-- money — a guest blacklisted at one property walks into another.
--
-- The LINK between a guest and a property is the reservation, which IS
-- hotel-scoped. That is the correct place for it.
-- =============================================================================


create table if not exists guests (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         citext,
  phone         text,
  nationality   text not null default 'IN',

  -- Foreign nationals require Form C filing with the FRRO within 24 hours.
  -- Storing identity here rather than on the reservation means a returning
  -- guest does not re-present their passport on every visit.
  id_type       text,
  id_number     text,
  passport_expiry date,
  visa_number   text,
  visa_expiry   date,

  address_line  text,
  city          text,
  country       text not null default 'India',

  -- Set by a manager, honoured across all seven properties.
  is_blacklisted   boolean not null default false,
  blacklist_reason text,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint guests_id_type_valid check (
    id_type is null or id_type in
      ('aadhaar', 'passport', 'driving_licence', 'voter', 'other')
  )
);

create index if not exists guests_phone_idx on guests (phone);
create index if not exists guests_email_idx on guests (email);

-- Powers the front desk "find the booking" box.
create index if not exists guests_name_idx
  on guests using gin (to_tsvector('simple', full_name));

drop trigger if exists guests_touch on guests;
create trigger guests_touch before update on guests
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- companies — corporate accounts and travel agents.
-- -----------------------------------------------------------------------------
-- Also group-level: a corporate rate is negotiated once for the whole company
-- and honoured at every property. credit_limit and credit_days are what let a
-- company be invoiced monthly instead of paying at checkout, which is the
-- bill-to-company routing the folio in 006 depends on.
-- -----------------------------------------------------------------------------
create table if not exists companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  gstin         text,
  contact_name  text,
  email         citext,
  phone         text,
  address_line  text,
  city          text,

  credit_limit  numeric(12,2) not null default 0,
  credit_days   smallint      not null default 0,

  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists companies_touch on companies;
create trigger companies_touch before update on companies
  for each row execute function app.touch_updated_at();
