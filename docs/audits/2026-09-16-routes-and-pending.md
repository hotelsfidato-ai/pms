# Every route, every screen, and what was pending — audit, 16 September 2026

Run on branch `coming-soon` (`59ce389`), against the **local** API and
database (`127.0.0.1:8787`, Postgres 55432) with the local demo data, and
read-only against production for the facts in § 5. Nothing was changed in
production. Locally two things were written on purpose and undone: the
banquet module switch (on, then off) to prove two routes, and probe requests
that created nothing (each was refused; checked afterwards that no row
appeared).

What the audit answers: **do the routes work, is anything unreachable, and
what of `PENDING.md` is still true.**

---

## 1 · The numbers

| | |
|---|---|
| Server routes registered | **214** — 92 GET, 92 POST, 13 PATCH, 10 PUT, 7 DELETE (asked of the running app, not counted from the source) |
| GET routes proven answering | **81** as the owner; **69** as a reception clerk |
| GET routes that refused, correctly | 2 (`/attachments` without a record, `/tariff` without a room type) |
| GET routes that answered wrongly | **1** — `GET /api/hotels/rate-plans` (§ 2.1) |
| GET routes not proven | 8 (§ 2.2) |
| Routes with no caller in the website | **13**, plus 5 that are called by something else on purpose (§ 3) |
| Screen addresses | **89**; **86 opened and rendered**, 3 not proven (§ 4) |
| Console errors during the screen sweep | 0 |

---

## 2 · The server's routes

### 2.1 The one that answers wrongly — INV-1, confirmed by running it

```
GET /api/hotels/rate-plans   →  404  {"error":"No such property."}
```

The route exists (`api/src/modules/inventory/rates.ts`), but `GET /api/hotels/:code`
is registered first and takes the word "rate-plans" for a property code. It
was found by reading on 15 September (PENDING § 2a, INV-1) and is now
confirmed live. Nothing calls it, so nothing is broken by it today.

**Fix:** delete the route, or move it above `/:code` — the second is a change
to the mount order, so deleting is safer.

### 2.2 The 8 GET routes this audit could not prove

Not failures — there is nothing in the local data to ask for, or they need a
credential this audit does not hold:

```
/api/hotels/:code/live                       a stream that stays open by design
/api/pos/rooms, /api/pos/tickets/:ref        need an outlet key, not a person
/api/hotels/:code/banquet/events/:id         no event in the local data
/api/hotels/:code/till/orders/:id            no open order in the local data
/api/hotels/:code/till/orders/:id/kot/:no    same
/api/hotels/:code/stores/items/:id/movements no stock item in the local data
/api/hotels/:code/attachments/:id/file       nothing has ever been attached (§ 3)
```

The API test suite covers the till and banquet paths (359 tests, `api/test/`);
this sweep did not re-run them.

### 2.3 What a reception clerk can read

The same sweep as a clerk: **69 of 92 answered**. Only the two
`/api/admin/*` routes refused by role. Everything else a clerk could read.

Three of those have **no screen a clerk may open** — the menu and the route
guard refuse them, the API does not:

| Route | What it carries | The screen |
|---|---|---|
| `GET /:code/audit-log` | 28 KB: who did what at the property | refused (no `audit_log` grant) |
| `GET /:code/settings` | the property's configuration | refused (no `setting` grant) |
| `GET /api/admin/staff` | staff — **scoped by the database to their own row only** | the People screen (see § 4.2) |

The roster and the password routes are safe: row-level security hides other
people's rows from a clerk's session, so
`POST /api/admin/staff/:id/password` answers "No such person" for the owner's
and the GM's ids, and `POST /api/admin/staff` is refused outright ("Only a
group administrator may provision a property"). **Both were probed; nothing
was created or changed.** What is left is a real but smaller gap: a clerk can
read the audit log and the settings through the API although both screens are
closed to them.

---

## 3 · Routes nothing calls

Built by enumerating the running app's routes and matching them against every
`/api/...` path the website builds, then checking each candidate by hand
(three of the first candidates turned out to be called through helpers — the
method alone is not proof).

**By design, called by something other than the website (5):**
`GET /health` (the deploy check and monitoring), and the four POS-bridge
routes an outside till calls with its own key (`GET /api/pos/rooms`,
`GET|POST /api/pos/tickets…`, `POST /api/pos/tickets/:ref/void` —
`docs/POS-INTEGRATION.md`).

**Unreachable — nothing anywhere calls them (13):**

| Family | Routes | Already recorded? |
|---|---|---|
| Attachments | `GET /:code/attachments`, `GET /:code/attachments/:id/file`, `GET /:code/attachments/awaiting-mirror`, `POST /:code/attachments`, `POST /:code/attachments/:id/mirrored` | PENDING § 3 "parked, needs architecture" — 5 routes, and **0 rows in production** |
| Approvals | `GET /:code/approvals`, `POST /:code/approvals/:id/:decision`, `GET /:code/approval-rules`, `PUT /:code/approval-rules/:kind` | PENDING § 4, defect 222 — 4 routes, **0 rows in production** |
| Night audit | `GET /:code/night-audit/can-run`, `GET /:code/night-audit/runs` | PENDING § 2a (NA), noted by the brief |
| Restaurant add-ons | `POST /:code/till/addons/:id/on`, `POST /:code/till/addons/:id/off` | **NEW — not in any list.** Menu items can be switched on and off from the Menu screen; add-ons (the extras on a dish) cannot be switched from any screen |

This is the gate PENDING § 5 says does not exist ("needs real work rather than
a regex"). It now exists as a script and can become a test: enumerate
`app.routes` at run time, match against the web's paths, and fail when the
list of known-unreachable routes grows. Same shape as `KNOWN_UNREACHABLE` in
`repositories.test.ts` (10 seam functions today).

---

## 4 · The screens

All 89 addresses come from `App.tsx` and the services' `routes.tsx`.

### 4.1 What opened

**86 of 89 rendered** as the owner, each with its heading, and **no console
errors**: 27 group-level screens (dashboard, reports, administration,
properties, people, guests, companies, notifications, design system), 38
property screens, 18 Coming soon pages, the invoice document, and the sign-in
screen. Not proven: `/h/:code/banquet/:id`, `/h/:code/till/bill/:id` and
`/h/:code/till/orders/:id/kot/:no` — the local data has no banquet event and
no open order.

As a reception clerk: `/admin/audit-log`, `/admin/settings`, `/admin/users`,
`/coming-soon/spa` and `/h/:code/channels` were **refused** with "This page is
not part of your role" — the guard works, including on the new pages.

### 4.2 Found: the People screen has no route guard

`/people` opens for a reception clerk and shows **Add somebody · Give a
property · Password · Edit · Deactivate**. Its menu entry needs the `user`
grant, which reception does not have, so the entry is hidden — but
`src/modules/admin/routes.tsx` mounts the page without `RequireAccess`, and
`mayReach` is only consulted by that guard.

What a clerk actually gets: their own row and nothing else (the database
scopes it), and every button the server refuses. So this is not a leak; it is
the project's own rule broken — the screens and the guard must agree, and a
door that cannot be used should say so rather than open.

**Fix:** wrap the route in `RequireAccess path="/people" resource="user"`,
one line, and the existing test in `App.test.tsx` then covers it.

### 4.3 Headings that do not match their menu entry — confirmed live

| Menu | Heading the screen shows |
|---|---|
| Diary | Banquet |
| Room types | The house |
| Rate calendar | Inventory and rates |
| All reports | Reports |
| Companies and agents | Booking sources |

All five were recorded on 15 September (PENDING § 2a) and are unchanged.
**Also found: the Kitchen screen has no heading at all** — it opens with its
two columns ("Ordered", "On the fire"). Every other screen carries a
`PageHeader`; this one is a wallboard, so it may be deliberate, but it is the
only screen with no `h1`.

---

## 5 · PENDING.md, item by item

Checked against the code, the local run, and production read-only.

| Item | Status on 16 September |
|---|---|
| § 1a security fix (088), deployed | **Live.** `REPLACE@fidato.in` is present and **inactive** — deactivated, not deleted, as MEMORY 271 requires |
| § 2 walk-in channel (242), deployed | Live |
| § 2 refusal after a write (243) | **Still true, and worse than written**: the booking route commits the guest, the group and the first room type's rooms before it refuses a later line (the readiness audit's PMS-4, by reading) |
| § 2 every backup on one disk (P0) | **Still true.** Owner's decision; nothing changed |
| § 2 the configuration is still the demo's | **Still true in production**: Deluxe ₹3,699, Superior ₹4,099; `companies` still holds 5 channel names (Agoda, Booking.com, Expedia, Fidato Hotels, go-MMT) |
| § 2 `demo@fidatohotels.com` holds owner at 5EL | **Still true**: active, owner role at 5EL |
| § 2 owner-side items (key rotation, n8n account, DNS) | Unchanged; `n8n@fidatohotels.com` still does not exist |
| § 2a RES-1 … FIN-1 (10 items) | **All still true.** INV-1 now confirmed by running it (§ 2.1); the five heading mismatches confirmed on screen (§ 4.3) |
| § 2b the move | Built, verified, **still not merged or deployed** |
| § 3 housekeeping never refreshes (218) | Still true, deferred by the owner |
| § 3 attachments parked | Still true — 5 routes unreachable, 0 rows in production |
| § 3 channel manager, payment gateway excluded | Now have Coming soon pages (16 September); still not built |
| § 4 approvals engine (222) | Still true — 4 routes unreachable, 0 rows in production |
| § 4 twelve seam functions with no caller | **Ten today**, not twelve (`KNOWN_UNREACHABLE`); the list has shrunk as the gate requires |
| § 5 no reachability gate for API routes | **Now possible** — this audit built it (§ 3); worth turning into a test |
| § 5 `mayReach` fails open | Still true, and § 4.2 is exactly what it allows: a route with no guard is open to every signed-in role |
| § 5 no gate for a refusal after a write | Still true |
| § 6 rough edges | Unchanged. Two "in house" numbers, the till's empty-list-on-error, the Manager report's empty City ledger, `app.stay_room()` not adopted in seven queries, three tables owned by `postgres`, promotions without dates, no commission totals, the address line, nothing emailed |

**New findings from this audit**

1. **The People screen has no route guard** (§ 4.2) — one line to fix.
2. **Two restaurant add-on routes are unreachable** (§ 3) — decide whether
   add-ons should be switchable from the Menu screen, or delete the routes.
3. **A clerk can read the audit log and the property settings through the
   API**, though both screens are closed to them (§ 2.3).
4. **The Kitchen screen has no heading** (§ 4.3).

---

## 6 · What I would do, in order

1. **The People guard** — one line, with the test already written. Same
   deploy as anything else.
2. **RES-1** (a refused booking leaves records) — before any machine feed;
   already on the integration plan's step 0.6.
3. **`GET /api/hotels/rate-plans`** — delete the shadowed route.
4. **The route-reachability test** — turn this audit's script into a gate, so
   the next unreachable route fails a run instead of waiting for an audit.
5. **Decide the three "unreachable by design?" families** — attachments
   (parked), approvals (the owner's decision: build the callers or delete the
   engine), add-ons. Each is the owner's call, not a bug to fix quietly.
6. **The clerk's reads** — decide whether the audit log and the settings
   should be refused by the API to a role whose screens are closed.
7. **The headings** (5) and the Kitchen heading — a half-day of copy, no risk.

---

## 7 · How to re-run this

```
# the owner's PC, PowerShell — the local database, then the two dev servers
D:\fidato-pg\pgsql\bin\pg_ctl.exe -D D:\fidato-pg\data -l D:\fidato-pg\pg.log start
```

The scripts used are kept with this audit's working files (the route list is
read from the running app; the GET sweep calls every read route as a chosen
test identity; the caller check matches routes against the website's paths).
They are not in the repository yet — item 4 above is to make the useful half
of that a test that runs with the suite.
