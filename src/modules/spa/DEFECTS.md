# Defects — spa

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `SPA-1`, `SPA-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None, 25 September.

---

## Fixed — the solution is here; do not work it out again

### SPA-3 · A treatment booked for a day the guest is not here, and "Charge to room" before they arrive — FIXED 28 September (round E)

**Found** — the QA of 28 September (QA BQ-2): a treatment booked today for a guest arriving tomorrow, and Charge to room offered for it.

**Fixed** — the owner's D27-136: a treatment is booked for a day from the guest's arrival to their departure, on the property's clock (tomorrow's arrival may still be booked for tomorrow); "Charge to room" is refused until the guest is checked in. A treatment's price of 0 is kept only when ticked Free (D27-120).

**Proved** — `api/test/modules/spa/spa.test.ts` "a guest still to arrive (BQ-2)"; the file's own bookings now fall on the stay's own days. On screen: Vikram Desai, arriving 26 Aug, booked for 25 Aug, refused with the sentence.

**The rule** — a room charge needs a guest in the room, and a booking needs a day the guest is here.

### SPA-1 · The Spa switch is on the Settings screen and the server refuses it — FIXED 19 September

**The entry is admin's now** - `src/modules/admin/DEFECTS.md`, under Fixed,
"LAU-3 / SPA-1": the fault was in `api/src/modules/admin/moduleSwitches.ts`,
and the laundry chat found the same one the next day. Its whole text, and this
entry's rule (a guard on a list of names checks both directions), are there.
Fixed by the master on 19 September (`41c0990`): one `SWITCHABLE` list, read by
both ends; proved by `api/test/modules/admin/moduleSwitches.test.ts`, "accepts
every module it offers". Moved 25 September.

### SPA-2 · The permissions matrix and the server disagree about who sees the diary

**Found** 19 September, building `nav.ts` and asking which roles the Spa
section should be shown to.

`src/lib/permissions.ts` grants `spa` to eight roles — and two of them,
`finance` (`["view", "export"]`) and `read_only` (`["view"]`), are **not in
`SPA_READ_ROLES`** in `api/src/modules/spa/spa.ts`, which is
`owner, admin, gm, hotel_manager, front_desk, housekeeping`. The owner's answer
of 18 September named those six and no others.

So `canAccess(role, "spa")` — the menu's default test — would have put a Spa
section in the accountant's and the viewer's sidebar, and every screen in it
answers **403** with "The spa diary is open to reception, housekeeping, the
manager, an administrator and the owner."

**Worked around, not fixed.** `nav.ts` asks `SEES_THE_DIARY` in
`src/modules/spa/data/spa.ts`, which is the menu's copy of the server's list
and says so. Nobody is offered a door that would refuse them. **The matrix is
the master's file** (`src/lib/permissions.ts`) and widening or narrowing a
role's grants is the owner's decision, not this chat's — reported, not touched.

**Fixed** 23 September (the owner's D22-9, branch `admin/hotel-admin-menus`):
the `spa` grant is off `finance` and `read_only` in `api/src/permissions.ts`,
so the matrix names the server's six. `SEES_THE_DIARY` is gone; the diary's
menu entry reads the matrix again (`resource: "spa"`). **Proved:**
`api/test/modules/spa/spa.test.ts` holds `canAccess(role, "spa")` equal to
`SPA_READ_ROLES` (failed with the two grants put back), and
`navigation.test.ts` refuses the diary to the accountant and the viewer
(failed with the grants back and the workaround gone).

**The rule:** when a service's own role list is narrower than the shared
matrix, the MENU follows the service and the matrix is reported. A menu that
follows the wider list hands somebody a screen that refuses them, which reads
as a broken system rather than as a permission.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
