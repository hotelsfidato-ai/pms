# Channel manager — your brief

## ⚠ 17 SEPTEMBER: BUILD IT — the owner's D17-66. This overrides everything below.

The owner chose **SU** (Su channel manager) and gave its API documents:
**https://suissu.gitbook.io/su-api-documentation/su-channel-manager** (the full
index is `llms.txt` beside it). Read `docs/briefs/decisions-2026-09-17.md`
(D17-28 to D17-30, D17-43 to D17-46, D17-66) and step 4 of `docs/NEXT-BUILD-PLAN.md`.

**What to build — SU's mandatory set, in this order:**
1. **Token authentication.** The token lives in the server's environment
   (`api/.env` on the server, set by the owner) — never in the repo, a screen, a
   test file or a chat. Until the owner has SU's test credentials, build against
   recorded example requests and responses from the documents.
2. **Content:** the property, its room types and its rate plans, mapped from the
   PMS (which is the record, D17-28). A mapping table per hotel.
3. **Rates and availability:** push availability, prices and restrictions from the
   PMS (read through inventory's front door) whenever they change, and on demand.
4. **Reservations:** pull from SU, or receive SU's webhook — new, modified,
   cancelled. A booking lands through reservations' front door (the booking door is
   idempotent, RES-3), with its OTA source and commission.

**The owner's rules:** a booking for a room no longer free is **refused and SU is
told** (D17-43) — never an overbooking; an OTA booking follows **the OTA's
cancellation policy**, a direct one the hotel's terms (D17-44); **each hotel is
switched on separately** (D17-45), none by default.

**Your folders:** `src/modules/channel-manager/`, `api/src/modules/channel-manager/`
(its `index.ts` exists, empty and already mounted by the master), and
`db/tests/modules/channel-manager.sql`. Your migration takes the next number after
cp6's highest. Anything you need from inventory, reservations or guests is their
front door; what is missing is a request to the master. Clean the long dash from
your folder (README).

**Stop and ask the owner** before: anything that would change a price or close a
room without a person, anything about money SU collects, and the first live push.

---

*What follows was written on 16 September, when the channel manager was not yet
defined. Keep it as history; the section above wins.*

**Read `docs/briefs/README.md` and `docs/briefs/coming-soon.md` first.** This
service was **not built**, and the rules for a not-built service are in that
second file.

---

## What you own

```
src/modules/channel-manager/          a status page, a nav entry, MODULE.md
api/src/modules/channel-manager/      DOES NOT EXIST
db/tests/modules/channel-manager.sql  DOES NOT EXIST
```

`src/modules/channel-manager/MODULE.md` is 162 lines and was written from the
code. **Read all of it before anything else.**

---

## Where it actually stands

- **Excluded by the owner, 8 September:** *"Channel manager and payment
  gateway: excluded for now."*
- **15 September, the owner:** the channel manager is being **defined**, to be
  finalised. Nothing has been supplied since.
- It is the **largest gap** between this system and a finished one. Today every
  booking-site reservation is typed in by hand, and every closed room is closed
  by somebody logging in to each site separately.
- It is part of the 17 of 228 go-live units still open, with the CRS bridge.

**So: no vendor, no contract, no credentials, no API documents. You cannot
build this, and you must not pretend the shape is known.**

---

## What the PMS already has that it will stand on — check each one

This is the useful work. Every item below either exists and is ready, or exists
and is **wrong for a machine caller**, and knowing which is what makes the
build cheap when it starts.

| It will need | What exists today | Your job |
|---|---|---|
| Availability to push | `app.sellable_rooms`, the inventory grid, `GET /:code/inventory` | Confirm the numbers a channel would receive match the grid a person sees |
| Prices to push | `app.rate_for` / `app.price_for` (migration 090), `GET /:code/rate-grid` | **INV-3 is open: two routes turn an unpriced room into `Number(null)` = ₹0.** A channel fed from either would push **₹0 to Agoda**. That defect is inventory's to fix — confirm it is fixed before anything pushes |
| Restrictions | migration 044 — stop sell, closed to arrival/departure, min/max nights | D10 says restrictions **are** enforced for machine callers. Check they actually are |
| Bookings to pull in | `bookingSources` (migration 082) with commission per source, `walk_in_channel` (085) | Check a booking can be created carrying its source, its commission and the price the guest was quoted |
| A price a machine sends | D10: a machine caller **may** send the price; 0 is refused unless complimentary | Confirm the route refuses 0 |
| Not booking the same room twice | migration 062 idempotency — **only work orders and banquet use it today** | Say what happens if a channel sends the same booking twice. This is the single most expensive thing to get wrong |
| A key, not a person | migration 029 provisioning key; PMS-2 says **the server enforces no role on writes** | Say how a channel authenticates, and what that key may and may not do |

**`docs/HMS-INTEGRATION-PLAN.md` § 2 and D10, D11 and D12 are about exactly
this.** D11 already decides poll first, an outbox later. Read them; they are the
owner's decisions and are not yours to revisit.

---

## What to produce

**Not code. A decision sheet the owner can answer in ten minutes**, in
`src/modules/channel-manager/MODULE.md`, each item with your recommendation and
what each answer would cost:

1. Which channel manager — a vendor (STAAH, eZee, RateGain…) or direct
   connections? The PMS's side is nearly the same either way; the difference is
   who maintains eighteen OTA quirks.
2. Which properties, and which room types on each — all seven, or 5 Elements
   first?
3. What happens when a channel sends a booking for a room that is no longer
   free. Refuse, or accept and overbook? **This one is a business decision and
   it is the reason channel managers are hard.**
4. Who owns the price: does the PMS push and the channel obey, or may an OTA
   hold its own? (D1 already says the PMS is the record — so this is really
   "what do we do when they disagree".)
5. Cancellations: the OTA's clock or the property's terms (migration 036/037)?

**Then stop.** Do not open a migration, a route or a screen.

---

## What you may not touch

Everything in `docs/briefs/README.md` § "What NOBODY but the master may
change", and in addition **every service this one will one day read from**:
`inventory`, `front-desk`, `reservations`, `finance`. You read them through
their front doors, and today you are only reading.

**The status page is yours** — if it says something that is no longer true,
fix the words and say so.
