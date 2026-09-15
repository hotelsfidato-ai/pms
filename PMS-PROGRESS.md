# PMS — what exists, what is missing

Audited against screenshots of the PMS Fidato runs today, screen by screen, and
checked against **this database** rather than against memory. Several things I
would have called missing already have a model and lack only a screen — those
are marked ⚠️ rather than ❌, because the distinction is days of work.

**Stage 15 is new scope, not newly-found incompletion.** Stages 4, 8 and 9 met
the targets they were given. Then the target moved. Same rule as stages 13
and 14.

---

## Where we are

```
HAVE       35 tables · reservations, folios, ledger, invoices, night audit
           room_assignments with from/to dates and a release
           reservation_groups with a lead hotel and a block code
           rates by room type x meal plan x date range
           room_blocks (maintenance) · is_complimentary · is_day_use
           cancellation terms frozen onto the booking · Form C

MODEL BUT  room move · group bookings · complimentary and day-use flags
NO SCREEN  rate ranges — nothing surfaces them the way a grid does

MISSING    void (distinct from cancel) · market segment, business source,
           sales person · stopsells, COA, COD · min and max nights
           extra adult and child rates · derived rate plans
           guest indicators (VIP, single lady, connected rooms, work order)
           inventory grid · rates grid · OTA mapping surface
```

---

## 1 · The reservation, and what you can do to it

The **More Options** menu is ten actions. We have three.

| Action | Status | Note |
|---|---|---|
| Add Payment | ✅ have | Folio payments, all methods |
| Cancel Reservation | ✅ have | With frozen terms and the no-show charge |
| Amend Stay | ⚠️ model | Dates are columns; nothing edits them with the availability re-check that must come with it |
| **Room Move** | ⚠️ model | `room_assignments` has `from_date`, `to_date`, `released_at`. A move is release-then-assign. **No UI, and no ledger consequence wired** |
| **Exchange Room** | ❌ missing | Two occupied rooms swap. Two moves that must both succeed or neither |
| **Unassign Room** | ⚠️ model | `released_at` exists |
| Stop Room Move | ❌ missing | A flag saying "do not move this guest" — honoured by the mover, not the database |
| Inclusion List | ❌ missing | What the rate includes. `meal_plans` is the start of it |
| **Void Reservation** | ❌ missing | `status` allows `cancelled`, not `void`. **They are different**: cancelled happened and was undone, void never happened. Revenue reporting must not count either, and audit must tell them apart |
| Add New Booking | ❌ missing | A second booking for the same guest, from inside the first |

> **Room move is the highest-value item here** and it is nearly free: the table
> already models it. What is missing is the screen, and the decision about what
> a move does to charges already posted against the old room.

---

## 2 · Groups

`reservation_groups` exists — `name`, `company_id`, `block_code`,
`lead_hotel_id` — and `reservations.group_id` points at it. **Nothing renders
it.**

The screenshots show what renders: the group's rooms listed by room type with a
count (*Superior (2), Deluxe (1)*), each room its own card with a sub-numbered
reference (`V43566A881D0F-1`, `-2`, `-3`), a **Group Owner** crown on the lead,
and one balance across all of them.

| Feature | Status |
|---|---|
| Group entity, block code, lead hotel | ✅ have |
| Sub-numbered references per room | ❌ missing — the reference is per reservation, with no `-1` suffix |
| Group panel grouped by room type | ❌ missing |
| Group owner indicator | ❌ missing |
| One folio across the group, or one per room | ❌ **undecided** — split billing built the machinery; nothing says which a group gets |

---

## 3 · Taking a booking

Two forms: **Quick Reservation** (a modal, minimum fields) and **Add
Reservation** (the full page with a live billing summary).

| Feature | Status | Note |
|---|---|---|
| Dates, room type, room, adults, children, rate | ✅ have | |
| **Multi-room in one booking** (*Add Room*) | ❌ missing | Today one reservation is one room type |
| Live billing summary while typing | ❌ missing | Room charges, taxes, due — recomputed as you change rooms |
| **Business Source / Market Segment / Sales Person** | ❌ missing | Three columns. Without them no source-mix report can exist, and that is the report an owner asks for first |
| Booking Source | ⚠️ partial | `source` exists; it is not the same axis as business source |
| Rate Type per room row | ⚠️ model | `rates` is room type × meal plan; the row-level picker is missing |
| **Complimentary Room** | ✅ have | `is_complimentary` |
| Day use | ✅ have | `is_day_use` |
| Book All Available Rooms | ❌ missing | |
| Tax Exempt / Bill To | ⚠️ partial | `company_id` exists; no exemption flag |
| C Form | ✅ have | Built, and blanks stay blank |
| Guest portal, booking vouchers, suppress rate on reg card | ❌ missing | Email surface we do not have at all |

---

## 4 · Inventory and rates — the two grids

This is the largest missing surface, and it is **Stage 9's** territory.

`rates` holds `room_type_id`, `meal_plan`, `price`, `valid_from`, `valid_to`.
That is genuinely the right model — the screenshots' *"Deluxe – Room Only (EP)"*
and *"Deluxe – CP (Breakfast)"* are exactly room type × meal plan. What is
missing is everything **around** it.

| Feature | Status | Note |
|---|---|---|
| Rate by room type, plan and date range | ✅ have | |
| **Inventory grid** — room type × date, with sold / available / total | ❌ missing | Derived, not stored. Correct — but nothing renders the derivation |
| **Rates grid** — rate plan × date, editable in place | ❌ missing | The single most-used screen in a revenue manager's day |
| **Stopsells** | ❌ missing | Close a room type for a date |
| **COA / COD** | ❌ missing | Closed on arrival, closed on departure |
| **Minimum / maximum nights** | ❌ missing | |
| Extra adult / extra child rates | ❌ missing | `occupancy` exists on the reservation; no pricing follows it |
| Derived rate plans | ❌ missing | "CP is EP + 400" as a rule rather than a second row |
| Import / Export | ❌ missing | A revenue manager pastes a season in from a spreadsheet |
| OTA common pool | ❌ missing | Stage 9's STAAH work |

> **No prices ship.** Every rate in the grid is entered by your team. An
> unpriced cell must render a dash, never a zero.

---

## 5 · The front desk list

| Feature | Status |
|---|---|
| Reservations / Arrivals / Departures / In-house tabs with counts | ⚠️ partial — the data exists, the tabbed list does not |
| Card view and list view toggle | ❌ missing |
| Total / Paid / Balance on each card | ✅ have — the folio knows all three |
| Export | ✅ have |

---

## 6 · House status

Closest to done of anything here. Stage 6 built the assignment table this screen
needs.

| Feature | Status |
|---|---|
| Room type grouping, room status, arrival and departure | ✅ have |
| **Assigned To** — a named housekeeper | ✅ have — `housekeeping_assignments`, migration 035 |
| Inline Dirty / Clean change | ⚠️ partial — the status changes; not from a dropdown in a table row |
| Pax per room | ❌ missing on this screen |
| **Audit Trail** button | ⚠️ model — `audit_log` and `room_status_log` both exist, unsurfaced |
| Print / Export / Settings | ⚠️ partial |

---

## 7 · Indicators

A legend of nineteen marks. We have the underlying state for about half and
render none of them as icons.

| Group | Have | Missing |
|---|---|---|
| Booking status | Arrived, Checked Out, Confirmed, Stayover, Dayuse | **Due Out**, Maintenance Block *(model exists)* |
| Booking indicators | Payment Pending *(balance is known)* | **VIP Guest**, **Single Lady**, Group Owner, Group Booking, Stop Room Move, Split Reservation |
| Room indicators | Dirty, Clean | **No Smoking / Smoking**, **Connected Rooms**, **Work Order** |
| Other | Unassigned Room *(model)* | Inventory, Unconfirmed Bookings |

> **VIP and Single Lady are one column each** and both change how a front desk
> behaves. Connected Rooms is a room-to-room relation and matters for families.
> Work Order is maintenance, which we do not have at all.

---

## 8 · OTA detail

The Booking.com reservation carries a voucher number, a room ID, a rate ID, the
booker's name, and the OTA's own cancellation text — and shows
**"Default Unmapped Rate"** where the mapping is absent.

| Feature | Status |
|---|---|
| `ota_reference` on the reservation | ✅ have |
| Voucher number, OTA room ID, OTA rate ID | ❌ missing |
| Booker distinct from guest | ❌ missing |
| OTA cancellation text carried verbatim | ⚠️ partial — we freeze *our* terms; the OTA's own wording is not kept |
| **Unmapped-rate indicator** | ❌ missing — and this is the one that silently costs money |

---

## What I would build, in order

| # | Work | Size | Why here |
|---|---|---|---|
| 1 | **Room move + unassign** | small | The table already models it. Highest value per day of work on this page |
| 2 | **Void, distinct from cancel** | small | One status value and a report change. Audit cannot currently tell them apart |
| 3 | **Business source, market segment, sales person** | small | Three columns. Unblocks the source-mix report an owner asks for first |
| 4 | **VIP, single lady, no-smoking, due-out indicators** | small | Four columns and an icon row. Changes front-desk behaviour immediately |
| 5 | **Group panel** — rooms by type, sub-numbers, one balance | medium | Model exists; this is the screen |
| 6 | **Inventory grid** | medium | Derived from what we hold. No new tables |
| 7 | **Rates grid, editable in place** | medium | The revenue manager's daily screen |
| 8 | **Stopsells, COA, COD, min/max nights** | medium | One table, four rules. Do it with the grid |
| 9 | **Multi-room booking + live billing summary** | medium | Changes the reservation model from one room type to several |
| 10 | **Amend stay with availability re-check** | medium | Dangerous without the re-check, which is why it is not already done |
| 11 | **Extra adult / child pricing, derived plans** | medium | Only once the grid exists |
| 12 | **Work order / maintenance** | large | A module, not a field |

## Not worth building, at this stage

- **Guest portal, booking vouchers, marketing email** — an email product
- **Waiter devices, LED display, feedback** — infrastructure for a business shape you do not have
- **Currency conversion** — one country, one currency
- **Language profiles** — until there is a second language

---

*Audited 2 September 2026 against `cp6`, every claim checked against the live
schema. 35 tables. The ⚠️ rows are the point of this document: six features are
one screen away from working, and calling them "missing" would have bought
six migrations nobody needed.*
