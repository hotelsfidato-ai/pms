# What is left to build, and in what order — 18 September 2026

**Thirteen services run the hotel today and are live.** The channel manager is
three quarters built and waiting on SU's keys. This plan covers **the seven the
owner still wants**, in the order the owner chose (D18-1), and nothing else:
the booking engine, loyalty, contracts, guest services and room systems stay
parked, and the CRS, the leads app, CRM and payments belong to other systems.

**The rule for every one of them: the smallest thing that works end to end,
first.** A service that does one job properly and is used on Monday beats one
that does nine things nobody has tried. Extras are listed under each, and are
built only when the first version has been used.

---

## The order

| | Service | Waits on | Size |
|---|---|---|---|
| 1 | **Purchasing** | nothing | 4 days |
| 2 | **Laundry and spa** | nothing (the guest's own spa booking arrives with 3) | 4 days |
| 3 | **The guest's page** — online check-in, spa and laundry requests | the master's door (below) | 5 days |
| 4 | **Guest messages** | the owner's n8n steps | 2 days |
| 5 | **Reviews** | 4, and the group's review link | 2 days |
| 6 | **Revenue management** | nothing | 3 days |
| 7 | **Tally export** | nothing | 2 days |
| 8 | **Marketing** | 4 | 2 days |

One chat per service, each in its own folder and its own copy, as now. The
master merges one at a time, with the gates green in GitHub before each merge.

---

## 1 · Purchasing

**What it is:** a purchase request becomes an approved order becomes goods
arriving in a store. The approvals engine (076) and the suppliers, stores and
stock ledger already exist — this joins them.

**The first version**
- **Raise a request:** what, how much, which store it is for, why. Who may is a
  **setting per property** (D18-2), defaulting to the Inventory Manager, the GM,
  the owner and an administrator.
- **The GM approves** (D18-4, D17-35), in the one approvals inbox that already
  exists. Nobody approves their own.
- **An order to a supplier**, as a PDF in the group's layout (D18-3), with the
  items, the agreed prices, and where to deliver. Printed or sent by hand.
- **Delivery:** the store keeper receives it — stock arrives as a receipt in the
  Store, against the order, so what was ordered and what came can differ and
  both are on the record.
- **No price is invented.** An item with no agreed price shows "-" and the order
  cannot be sent until somebody prices it.

**Not yet:** supplier bills and payments (that is finance's, and waits on the
owner), part deliveries, a rate contract per supplier.

**Asked and answered:** D18-2, D18-3, D18-4.

---

## 2 · Laundry and spa

**What it is:** two small services behind one per-hotel switch each (D17-54),
run by reception and housekeeping (D18-8).

**Laundry, the first version**
- A **price list per property** — item by item, wash / press / dry-clean. No
  default prices: unpriced shows "-".
- A **docket**: whose it is, what is in the bag, when it was collected, when it
  came back. **Every docket says whether it is a guest's or the hotel's own**
  (D18-5) — the same screen counts the hotel's linen going out and coming back.
- A guest's docket **charges to the room** as its own line (D18-7).

**Spa, the first version**
- A **price list of treatments**, and a **day diary**: who, which treatment,
  which therapist, what time.
- Booked **by the desk on the telephone**, or **by the guest from their own
  page** (D18-6, and it arrives with 3).
- **Settled at the spa, or charged to the room** (D18-6) — both, chosen when the
  treatment is closed.

**Not yet:** therapist rosters and commissions, packages, the hotel's linen par
levels per room type.

---

## 3 · The guest's own page

**What it is:** one private page per booking (D18-9). No public page, so the
booking engine stays parked.

**Three ways in** (D18-10)
1. **The link in the confirmation** — sent on confirmation and again the day
   before (D18-11).
2. **A QR code in the room** — the guest scans it, gives their phone number, and
   a **six-digit code arrives on WhatsApp** on the number the booking carries
   (D18-13). Wrong number, no code, nothing shown.
3. **The desk sends the link** at check-in when the guest has not used either.

**What the guest can do there**
- **Check in**: their details and a **photo of the ID** (a passport for a foreign
  guest, which Form C needs). **The signature stays at the desk** (D18-10) — the
  legal register does not change; the desk stops typing.
- **Ask for the spa** — a treatment and a time (2).
- **Send laundry** — a bag, listed (2).
- **See their bill**, as it stands.

**What the master builds first, before that chat starts**
- **A fourth door.** A guest is not staff and holds no sign-in, so this needs its
  own prefix outside the staff gate — the shape `/api/channel` already took for
  SU: a link that carries a signed, expiring token for exactly one booking, a
  code to a phone before anything is shown, a limit on attempts, and nothing
  about any other booking reachable from it. **This is the master's, not a
  service chat's**, and it is the one piece of this plan that is written twice
  and checked twice.

**Not yet:** paying online, choosing a room, anything a stranger can open.

---

## 4 · Guest messages

**Waits on the owner's n8n steps** (`docs/briefs/n8n-sending.md`). Until they are
done, nothing sends — and the screens say so rather than pretending.

**The first version:** the **booking confirmation with the check-in link**
(D18-12), sent when a booking is confirmed from anywhere — the desk, the CRS, a
booking site — and again the day before arrival (D18-11). Every message sent is
recorded against the booking: what went, to which number, when, and whether it
arrived.

**Not yet, on purpose:** the bill after check-out stays a button a person
presses (D17-34, D17-91); a review request belongs to 5.

---

## 5 · Reviews

**The first version** (D18-14): after check-out, a message asking for a review
with **the group's own review link**, and a screen showing who was asked, who
has not been, and what came back. Nothing is pulled from Google or the booking
sites yet.

**Needs from the owner:** the review link.

---

## 6 · Revenue management

**The first version** (D18-15): **it shows and suggests; it changes nothing.**
- **Pickup and pace** — how this month is filling against the same month last
  year, and against last week.
- **Which dates are soft** — rooms left, at what rate, how close.
- **What it would suggest** — in words, with the reason. The GM or the owner
  makes the change on the Rates screen, as today.

**Never:** a price that moves by itself.

---

## 7 · The Tally export

**The first version** (D18-16): one screen, a date range, and **three formats to
choose from** — **Tally Prime XML**, **Tally ERP 9 XML**, and a **day-book CSV**
— so whoever exports picks what their accountant asks for. Sales, taxes and
receipts, from the same figures the reports print, so the export and the reports
can never disagree.

---

## 8 · Marketing

**The first version** (D18-17): **guest lists that can be acted on** — stayed
twice, not returned in a year, came from which site, birthdays this month —
with an export, and a send through n8n when an offer goes out. Nothing here
duplicates the leads app, which keeps the conversations.

---

## What the owner still owes the plan

Not decisions — things only they have:

1. **SU's keys and the push key** — the channel manager's last part.
2. **The n8n steps** — 4, 5, 8 and the QR's code cannot send without them.
3. **The group's Google review link** — 5.
4. **CRS voucher FH-2026-00002** in `D:\reports fidato\` — the bill and voucher
   template (D17-63).

## How each one is judged done

The same bar as everything else here, and no lower:

- Every gate green **in GitHub**, on Linux, not only on somebody's laptop.
- Every guard **seen to fail** with its fault put back.
- **The screen opened** before anybody says it works, at 375 pixels as well.
- No default prices, no invented figures: a thing nobody has priced shows "-".
- The service's own `CHANGELOG.md`, `DEFECTS.md` and `MODULE.md` up to date,
  and the lane clean.
