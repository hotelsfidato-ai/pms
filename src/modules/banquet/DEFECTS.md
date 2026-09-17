# Defects — banquet

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `BQ-1`, `BQ-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — check that file
for the next free number before taking one. Fixed entries stay here: they are
the reason the fault does not come back.

---

## Open — not fixed

### BQ-1 · A restaurant bill cannot be charged to a banquet function — banquet's half DONE, the till's half open

**Found** — 15 September, writing the brief, by reading.

Nothing in the till sets `pos_orders.event_id`, so food ordered for a function cannot land on its bill. `PROGRESS.md` says it can.

**Decided** — the owner, 17 September (D17-21): **build it**, banquet first, then the POS chat. And which functions the till may offer: **confirmed, bill open, running on the business date** (from its first day to its last).

**What was done — banquet's half, 17 September**
- The function's screen lists every open and settled restaurant order attached to it (outlet, table, time, amount, status), says an open one is not in the total until settled, and leaves abandoned ones out. The money line "From the till" became "Restaurant orders" — the same words as the list.
- The rule is written once, in `api/src/modules/banquet/attach.ts`: `GET /:code/banquet/attachable` for the till's screen, and `whyNotAttachable` for the till's server, which refuses in a sentence that says which part of the rule failed.
- Exported through both front doors (MODULE.md, "Front door").
- `api/test/modules/banquet/attach.test.ts` — seen to fail with the status filter removed (a cancelled function offered), with the midnight rule removed (a function that ended at midnight offered the next day), and with abandoned orders let through.

**Still open** — the till attaching an order (the POS chat). Until it ships, `PROGRESS.md`'s claim is still untrue, and `getAttachableFunctions` has no caller: `repositories.test.ts` Rule 2b fails on it, correctly (MODULE.md, Requests).

**The rule** — A document that claims a feature the code does not have is a defect in the document.

### BQ-6 · A function's reference has no lock, and cuts long numbers

**Found** — 17 September, by reading the register route while fixing BQ-7. Measured: `select lpad('10000', 4, '0')` is `1000`.

`POST /:code/banquet/events` makes `BQ-<YYMM>-<n>` as `lpad((max + 1)::text, 4, '0')` with no lock — the two faults 092 fixed for bookings (root `MEMORY.md` 280). Two functions registered at the same moment read the same maximum, and `be_reference_unique` refuses the second with a database message. After the 9,999th function at one property, every new number is cut to four digits and refused as a duplicate.

**Decided** — the owner, 17 September: record it, fix later. Rare today (one GM registers functions), and the fix needs a migration — a per-hotel lock like 092's.

**The fix, when it is done** — a locked, non-cutting reference maker in a migration, and the route switched to it.

**The rule** — `lpad` is a formatting call with a length limit, not a padding call; and a "max + 1" without a lock is a duplicate waiting for a busy minute.

---

## Fixed

### BQ-2 · Diary opens a screen headed "Banquet" — FIXED 17 September

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

The menu said "Diary"; the page said "Banquet".

**What was done** — the owner decided (D17-22): the heading is the menu name. The Diary is headed "Diary" in all three of its states, which also sets the browser tab. `banquet.test.tsx` "is headed with the menu's word" — seen to fail with the old heading put back alone.

**The rule** — A screen's heading is the menu entry that opened it.

### BQ-3 · A failed load said "This property has no banquet hall" — FIXED 17 September

**Found** — 16 September, by reading, while listing the screens for the owner.

`getBanquetDiary`, `getBanquetEvent` and `getBanquetSetup` ended in `catch { return null }`, and each page read `null` as "the module is off". So a server error, an expired sign-in or no network drew **"This property has no banquet hall"** on the Diary and on Halls and packages, and **"No such function"** on a function that exists. Same shape as root `MEMORY.md` 251 and the critique's `/stay` P0.

**What was done** — the owner chose the restaurant's words (POS-4). The reads throw. Each screen tells refused (the server's own sentence, which is how "no banquet hall" now arrives — only when it is true), unreachable and failed apart, with Try again; a read React Query paused offline counts as unreachable; a failed refresh keeps what was shown under "Not up to date". `components/ReadProblem.tsx` is a named copy of the till's (MODULE.md, Requests). `banquet.test.tsx` — every failed-state test seen to fail on the old pages.

**The rule** — A read that turns every error into "nothing" gives a wrong reason, and a wrong reason is worse than none.

### BQ-4 · One function's screen called its account a "bill" and a "folio" — FIXED 17 September

**Found** — 16 September, by reading `pages/BanquetEvent.tsx`.

Confirming toasted "The hall is held, and a bill is open."; the money card said "A folio is open for this function."

**What was done** — the owner chose "bill": "A bill is open for this function." `banquet.test.tsx` asserts no "folio" on the screen.

**The rule** — One thing, one name, everywhere.

### BQ-5 · The Diary printed raw dates, and each page formatted dates its own way — FIXED 17 September

**Found** — 16 September, by reading.

The Diary read "Nothing confirmed between 2026-09-16 and 2026-10-16."; the pages carried their own 24-hour formatters.

**What was done** — the owner chose the shared formats, 12-hour times included: `dateShort`, `timeOnly` and `dateTime` from `src/lib/format.ts` — "between 16 Sep 2026 and 16 Oct 2026", "14 Nov 2026, 6:00 PM → 11:00 PM". The API now sends "Registered at" as `YYYY-MM-DDTHH:MM` rather than a sentence, so the screen can format it.

**Not covered** — sentences the SERVER writes still carry their own times: the clash warning on registering ("… 14 Nov 18:00 to 14 Nov 23:00") and the confirm refusal from `app.confirm_banquet_event` (060). Changing the second is a migration.

**The rule** — A date on screen goes through `format.ts`.

### BQ-7 · A function the owner registered opened as "No such function" for the GM — FIXED 17 September

**Found** — 17 September, by reading `GET /:code/banquet/events/:id`, then measured: signed in as the GM, the `staff` rows readable were agra, desk and gm — not the owner's; as a desk clerk, only their own.

The function route joined `staff` for "Registered by", and `staff` is row-secured (027). Where the viewer could not read that person's row, the join returned nothing and the WHOLE FUNCTION came back 404. The catering list joined `staff` for "Added by" the same way, so a course a colleague added vanished while the total still counted it. The diary's "Registered by" came back blank for the same reason. Root `MEMORY.md` 283's fault, in this service.

**What was done** — the owner chose to fix it and keep the names. No join to `staff`: the names come from `app.colleague_name` (096), which answers for anybody rostered at the property or a group administrator, and null (a dash) otherwise. `api/test/modules/banquet/names.test.ts`, run as the GM and as a clerk — on the old route both got 404 and the diary no name.

**The rule** — Never join a row-secured table for a label. Test a screen as the role it is for, not as the owner, who sees every row.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **120** · A teardown that cleared the table instead of cleaning up after itself
- **121** · A shared action bar that could not wrap
- **214** · A switch that said "not built yet" about something that was built
- **250** · Any clerk could switch a hotel's modules on or off
- **280** · Postgres `lpad` does not only pad — it cuts (BQ-6 is the same fault)
- **283** · A join to `staff` silently hides rows for most roles (BQ-7 is the same fault)

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
