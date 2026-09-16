# Defects — equipment

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `EQ-1`, `EQ-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — that file is the
master's, so it goes to the master to write. Fixed entries stay here: they are
the reason the fault does not come back.

Until 16 September this folder described door locks and room phones and had no
code; it had no defects. Those notes moved to `room-systems`.

---

## Open — not fixed

### EQ-2 · Deleting an untraded property with a register fails with the wrong reason

**Found** 16 September, reading `066_delete_untraded_property.sql` while writing
the register's own test clean-up.

`app.forbid_hotel_delete()` refuses to delete a property that has traded and
names what it found — reservations, folios, postings, invoices, payments,
orders, events, audits, shifts, work orders. **Equipment is not on the list**
(nor is the Store's `stock_movements`). A property with a register and nothing
else passes the check; the cascade then reaches `equipment_history`, whose
append-only trigger refuses with *"equipment_history is append-only. Post a
reversing entry…"* — refused, which is right, for a reason nobody at an
administration screen can act on.

**Not fixed: 066 is the master's.** Written as a request in `MODULE.md`. The fix
is one line in the evidence list: equipment items (and, for the Store, stock
movements).

**The rule:** an append-only table that cascades from `hotels` is evidence of
trading, and belongs in `forbid_hotel_delete`'s list the day it is created.

### EQ-3 · Two migrations at once on the local Postgres collide

**Found** 16 September, by causing it. `cd api; npm test` was migrating its
scratch database when `DB=fidato_equipment ./db/migrate.sh` started on mine.
The API run stopped at `029_provisioning_key.sql`:
`ERROR: tuple concurrently updated` — both runs executed
`alter role pms_provisioner …` at the same instant, and a role belongs to the
whole cluster, not to one database. No test ran; nothing was damaged.
Re-run alone: 120 passed.

**Not fixed, and not this service's:** every chat shares the one Postgres on
port 55432, and every `migrate.sh`, `db/tests/run.sh`, `rerun.sh` and API `npm
test` runs the migrations. Two chats gating at the same moment can fail each
other's run at random, in a way that looks like a broken migration. Reported to
the master for the root `MEMORY.md`.

**The rule:** a gate that runs the migrations is not isolated by its scratch
database — roles are cluster-wide. One migration run at a time per Postgres.

---

## Fixed

### EQ-1 · Every new category was refused with "permission denied"

**Found** 16 September by this service's own API tests, before anything was
committed: adding an item with a category nobody had used returned 500, *"permission
denied for table equipment_categories"*.

The route made a category with `insert … on conflict … do update set name =
name` — an upsert, to return the row either way. **An upsert needs UPDATE on the
table**, and the migration deliberately grants the application only select and
insert on categories. So the privilege that makes a category unchangeable also
made every new one fail.

**Fixed:** `on conflict do nothing`, then read the row back if nothing came
from the insert (`categoryFor`, `api/src/modules/equipment/equipment.ts`). The
grant was kept narrow. `register.test.ts` adds a new category, and one in
different capitals that must land on the same row.

**The rule:** `on conflict do update` is an UPDATE. On a table the application
may only insert into, use `do nothing` and read back.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
