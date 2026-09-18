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

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
