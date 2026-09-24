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

### SPA-1 · The Spa switch is on the Settings screen and the server refuses it

**Found** 18 September, reading `api/src/modules/admin/moduleSwitches.ts`
against `src/modules/admin/pages/Admin.tsx` while looking for the switch
migration 115 made.

`GET /:code/modules` lists six modules — `pos`, `banquet`, `reception_pos`,
`channel_manager`, `laundry`, `spa` — and the Settings screen draws a live
switch for every one it is given, with the copy for Spa and Laundry already
written (`MODULE_COPY`). **`POST /:code/modules/:module` accepts three:**

```js
if (!["pos", "banquet", "reception_pos"].includes(module)) {
  return c.json({ reason: `There is no "${module}" module.` }, 409);
}
```

So Spa, Laundry **and the channel manager** are drawn as working switches and
answer 409 when pressed. D17-54 says each shows only where it is switched on;
today it cannot be switched on anywhere. That file's own comment describes this
exact fault in its previous form — banquet's switch disabled with stale copy,
found by the owner "trying to turn banquet on and watching nothing happen" —
and `moduleSwitchesAreLive` guards only one direction: that no module the API
accepts comes back disabled. Nothing asks the reverse, which is the direction
that broke.

**Not mine to fix** — `api/src/modules/admin/` is the admin lane. Reported to
the master 18 September. **Not blocking this service's build:** the tests and
the database suite switch the module on by writing `hotel_modules` directly.
It blocks the owner using it.

**The rule:** a guard on a list of names checks BOTH directions — that nothing
offered is refused, and that nothing accepted is hidden. One direction is half
a guard, and the half that was missing is the half that broke.

---

## Fixed — the solution is here; do not work it out again

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
