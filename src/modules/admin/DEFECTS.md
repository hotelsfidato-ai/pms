# Defects — administration

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `ADM-1`, `ADM-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### PEO-1 · The People screen has no route guard

**Found** — 16 September, opening `/people` as a reception clerk in the local copy.

`src/modules/admin/routes.tsx` mounts `/people` without `RequireAccess`, so any signed-in person can open it; the menu entry needs the `user` grant, which reception does not have, so the entry is hidden and the page is not. The clerk sees their own row only (row-level security) and every button is refused by the server — nothing leaks — but the screen and the guard disagree, which is the fault `mayReach` exists to remove.

**The fix, when it is done** — Wrap the route: `<RequireAccess path="/people" resource="user">`. One line. `App.test.tsx`'s "every guarded route is one the navigation knows" then covers it.

**The rule** — A hidden link is not a guard. The route says who may open it.

### ADM-1 · The Audit log names "admin" as the person behind every entry

**Found** — 15 September, writing the brief, by reading.

Every row is attributed to "admin" rather than to whoever acted, so the log answers what happened and not who did it.

**The fix, when it is done** — Record the acting staff id on the row (`app.current_user_id()`) and show that person's name.

**The rule** — An audit log that cannot name the person is a list, not an audit.

### ADM-2 · Settings and the Properties cards show a tax the database no longer uses

**Found** — 15 September, writing the brief, by reading.

Both print a flat 2.5% + 2.5% GST, which migration 067's tax rules replaced, and Settings appends "— demo, not a real GSTIN" to every property's GSTIN.

**The fix, when it is done** — Read the property's tax rules; print the GSTIN as stored, and a dash when it is not set.

**The rule** — Never show a figure the database has stopped agreeing with.

### API-2 · A clerk can read the audit log and the property settings through the API

**Found** — 16 September, the route audit: the same sweep as `dev-desk` answered 69 of 92 read routes.

`GET /:code/audit-log` returned 28 KB and `GET /:code/settings` answered, though reception holds neither the `audit_log` nor the `setting` grant and both screens refuse them. The roster and the password routes are safe — row-level security hides other people's rows and staff creation is refused.

**The fix, when it is done** — The owner's call: should the API refuse what the screens refuse? If yes, a role check on those two routes; if no, record that reads are hotel-wide by design.

**The rule** — A screen that refuses and an API that answers are two different answers to one question.

### ADM-3 · Every deploy re-creates the placeholder administrator once it is deleted

**Found** — 9 September, deleting it; it came back on the 15 September deploy. Root MEMORY 271.

Migration 008 inserts `REPLACE@fidato.in` with `on conflict (email) do nothing`, so a deleted row is re-created by the next replay — active, and a group administrator.

**The fix, when it is done** — It is deactivated in production now (checked 16 September: present, inactive) — **deactivate, never delete**. The guard still to write: make 008 skip the seed when the deployment already has a real administrator.

**The rule** — Deactivate, do not delete: a deleted row comes back on the next deploy.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **7** · A read grant leaked an `/admin` path to the front desk
- **45** · The owner could not see who worked for him
- **46** · A recursion cycle that was already there, waiting
- **47** · Assertions about RLS, written where RLS does not apply
- **59** · Every member of staff could list every property
- **60** · A read-only admin section, underneath as well as on top
- **61** · A custom header that fails as "the server is down"
- **63** · The system shipped prices nobody at the hotel had chosen
- **108** · I planned to build a screen that already existed
- **148** · A SECURITY DEFINER that could not escape its own policy
- **153** · A group administrator nobody owned
- **184** · Three roles the screen offered and the database refused
- **185** · My own: guarded endpoints, and a write that matched nothing
- **186** · A THIRD list of roles, in the picker that exists to choose them
- **214** · A switch that said "not built yet" about something that was built
- **215** · Adding a user shipped nowhere, and the fix nearly shipped a trap
- **216** · A screen that explained why it could not do the thing
- **217** · I audited `/admin/*` and concluded a capability was missing. It was on `/people`. — The rule: audit by capability, never by location.
- **224** · Four admin endpoints, written and tested, with no way in
- **225** · There were two Properties screens and the one in the menu could do less
- **226** · A line-range replacement ate three screens I never looked at — The rule:
- **227** · Deleting a menu entry opened an admin route — the guard fails open
- **229** · Adding somebody wrote a row and stopped. There was no password anywhere.
- **230** · `app.is_manager()` was sitting right there and is not the gate
- **231** · A refusal returned as HTTP 200, in three routes
- **232** · I deleted three unrelated things with a range replacement. Again.
- **250** · Any clerk could switch a hotel's modules on or off
- **263** · Any hotel manager could take over the owner's login — SECURITY, live 9–15 September — The rules:
- **264** · My proof run created two accounts on the LIVE sign-in service — The rules:
- **271** · Every deploy re-creates the placeholder administrator once it has been deleted — The rules: where migrations replay, a seeded row cannot be deleted, only switched off. And a pre-deploy check asks what the replay will INSERT, not only what it will change.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
