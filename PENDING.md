# What is left

Written 9 September 2026, at the end of phase 2. This file is the answer
to "what is pending" — it replaces asking, and it is meant to be edited
rather than appended to.

Anything **decided against** is here too, with the reason. A gap nobody
recorded a decision about is a gap somebody rediscovers and re-argues.

---

## 1 · Not deployed yet

Phase 2 is on `cp6` and on GitHub. It is **not on either running
environment.**

```
pms.fidatohotels.com     Firebase          behind by phase 2
api.fidatohotels.com     Oracle, Mumbai    behind by phase 2
```

Two migrations have to reach the server before the API will start
cleanly against it:

```
082_booking_sources.sql   booking_sources, booking_source_rates,
                          reservations.booking_source_id + commission_pct,
                          app.booking_source_label()
083_promotions.sql        pos_promotions, pos_orders.promotion_id,
                          app.pos_freehand_discount_cap()
```

`deploy/launch.sh` applies migrations, runs the preflight and restarts
the service. Its two upgrade-path defects (211 TLS, 212 peer auth) were
fixed and pushed, so this is the first upgrade that should survive
itself — **it has not been exercised on the real box yet.**

---

## 2 · Deferred by the owner, on the record

### Housekeeping never refreshes itself — defect 218

The board shows the morning as it was when the page loaded. A housekeeper
marks 204 clean on a stairwell landing and the supervisor's screen does
not change until somebody reloads.

Measured: five requests, no duplicates, all under 15 ms. **It is not
slow. It has no refresh of any kind.**

The fix is known and small: extend the Postgres `NOTIFY` trigger from
075 to housekeeping changes, and add `useLiveOrders`-style invalidation
to that screen. The live channel already reaches Floor, Kitchen and Till.

> Deferred on 8 September at the owner's instruction — *"leave this for
> now and keep this in the upcoming files."*

### Attachments — parked, needs architecture

All four uses are in scope eventually. 077 built the table. Nothing
reaches it. **Parked deliberately**, not forgotten: the storage question
(where the bytes live, who may read them, what happens to them when a
guest checks out) has not been decided, and building the screen first
would decide it by accident.

### Channel manager — excluded for now

The **foundation for it is built**: `booking_sources.channel_code` is
what a channel manager will send, unique across the group, and the
source-mix report already counts by source. Connecting one is out of
scope until the owner asks.

### Payment gateway — excluded for now

Said plainly by the owner on 8 September.

---

## 3 · Built and still unreachable

The project's signature defect. Each of these is real work nobody can
use. **They are listed rather than quietly counted as done.**

### The approvals engine — defect 222

```
076_approvals.sql        approvals, approval_rules,
                         app.request_approval(), app.decide_approval()
api/routes/approvals.ts  the queue, the decide endpoint, the rules
─────────────────────────────────────────────────────────────────────
callers of request_approval   NONE
screens showing the queue     NONE
```

`approvals.ts` opens by saying it exists *because* the engine would
otherwise be unreachable. The routes were added; the callers never were,
so the fault moved up a level instead of closing.

Phase 2 was going to wire discounts into it. **The owner replaced that
design with promotions** — a free hand up to 10%, named promotions
beyond it — which is better and is built. So the engine is still
unreachable, and its remaining kinds (`purchase`, `cash_expense`,
`stock_adjustment`) have no path either.

**Decision needed before this is worth building:** does the owner want
purchase and expense approvals at all? If not, the engine should be
deleted rather than left looking finished.

### Thirteen seam functions with no caller

Listed in `KNOWN_UNREACHABLE` in
`src/data/repositories/repositories.test.ts`. All are helpers overtaken
by later screens — no capability among them since `setOutletClosed` came
off. The list can only shrink: the gate fails if an entry gains a caller
and stays.

---

## 4 · Gates that do not exist yet

### No reachability gate for API routes — the gap defect 224 names

`repositories.test.ts` fails when a function on the frontend seam has no
importer. It cannot see an **API route with no caller**, which is exactly
how four admin endpoints sat unreachable for months and how the whole
approvals engine still does.

Not built because the route table is not a static list the way
`export function` is — Hono registers them at runtime, so this needs
real work rather than a regex.

### No gate for `app.*` SQL functions with no caller

Same shape, one layer further down. `app.request_approval` is the live
example.

---

## 5 · Known rough edges, small

- **`pos_promotions` has no validity dates.** A promotion runs until
  somebody switches it off. Deliberate — dates were not asked for and
  inventing scope is how a feature stops matching what was wanted — but
  a seasonal offer will want them.
- **The source-mix report does not show commission totals yet.** The data
  is there (`reservations.commission_pct`, stamped at booking). Nothing
  sums it.
- **`hotels.address_line` duplicates city and state** in the demo data —
  the Akkalkot card reads "Akkalkot, Solapur District, Maharashtra
  413216, Akkalkot, MH". Data, not code, and now editable on
  `/properties`.
- **`companies` contains channels.** "Walk-in", "Fidato Hotels" and
  "Walk-In" are rows in the corporate-accounts table, left over from
  when the booking form put the companies list in the channel box. They
  are harmless and still offered as Business source. Cleaning them up
  means checking nothing points at them first.
