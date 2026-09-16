-- =============================================================================
-- 093 — the Revenue Manager
-- =============================================================================
-- The owner, 16 September: a person — "like a revenue manager" — who changes
-- prices and pushes them to the booking sites when the owner, admin and GM are
-- not there. SU, the channel manager, is only the system interface; it does not
-- set prices. The owner approved exactly what the role may do:
--
--   CAN     set prices (Pricing, Rate calendar, Rate plans); set restrictions
--           (stop sell, minimum nights, closed to arrival or departure); see
--           availability, every booking, occupancy and ADR, OTA commission
--   CANNOT  bills, payments, invoices; guest details and identity documents;
--           staff and roles; property and room setup; check-in and check-out;
--           the POS
--
-- WHAT THE ROLE MAY DO LIVES IN `src/lib/permissions.ts`, not here. This file
-- does one thing: lets the database accept `revenue_manager` as a role a person
-- can be given. `app.assignable_roles()` is the authority every staff grant is
-- checked against (078), and `api/test/roles.test.ts` fails if this list and
-- the interface's disagree — so the role cannot exist on one side only.
--
-- Named Revenue Manager and not Channel Manager so the person is never confused
-- with the channel manager SERVICE, which is the wire to SU.
--
-- Re-runnable, like every migration here: `create or replace` on a function
-- whose signature does not change.
-- =============================================================================

create or replace function app.assignable_roles()
returns text[]
language sql
immutable
as $fn$
  select array[
    'owner',            -- unrestricted; sole authority over roles and settings
    'admin',            -- runs the platform day to day, including accounts
    'gm',               -- the whole book at their properties; approves; sets prices
    'hotel_manager',    -- one property, below the GM
    'revenue_manager',  -- prices and restrictions; no money taken, no guests, no staff (093)
    'front_desk',       -- shown as Reception
    'housekeeping',
    'kitchen_manager',
    'chef',
    'pos',              -- a till identity, shown as Till Operator
    'stores',           -- shown as Store Manager
    'finance',          -- shown as Accountant
    'read_only'         -- shown as Viewer
  ]
$fn$;

comment on function app.assignable_roles() is
  'Every role a person may be given. The one authority: staff grants are '
  'checked against it (078) and the interface is held equal to it by '
  'api/test/roles.test.ts. revenue_manager added 16 September 2026 (093).';
