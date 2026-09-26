# One Fidato platform: the PMS, the CRS and market-to-revenue

**Written 27 September 2026** by the platform-plan session, from the code of
all three systems (read-only) and the owner's answers in this chat.
**Status: PLAN. Nothing is built and nothing changed in any of the three
projects.** The owner's page for this plan: https://claude.ai/artifact/RucnfMNeQfSBQrJUvYowGa

It builds on `docs/HMS-INTEGRATION-PLAN.md` (15 September) and replaces its
Phases 2, 5 and 6 where the owner's answers of today differ. Its audits
(`docs/audits/2026-09-15-*.md`) still hold.

The owner's words, 27 September:

> In future I want one system that is all-inclusive and integrated. The CRS
> can be its own separate entity, because Fidato is split in two, hotels and
> the sales team, and the CRS is the sales team's. But I should be able to
> send reservation and booking messages on WhatsApp. If I, or the CRS, create
> a reservation, it must reflect in my PMS for the hotels I own. And I want to
> integrate the whole market-to-revenue system into this PMS: natively, built
> into the platform, not a site inside a site.

Effort: **S** up to 2 days · **M** up to 2 weeks · **L** longer. Agent time,
not calendar promises.

---

## 0 · In one page

- **Two apps, not three.** The PMS takes in the whole market-to-revenue app
  (leads inbox, WhatsApp, live inventory, marketing) as its own screens on its
  own database. The CRS stays a separate app for the sales team and talks to
  the PMS through its API (PL-1, PL-2).
- **The old app keeps working until the switch.** Its Firestore stays live; a
  one-way copy of only what changed runs into the PMS; the new screens are
  built and checked against the same data; on switch day WhatsApp points at
  the PMS and the old app goes read-only (PL-5, PL-12).
- **One WhatsApp number, one inbox** for sales and the hotels (PL-3, keeps
  D17-89). **One voucher**: the same one, sent once, whoever sends it (PL-9).
- **A CRS booking for a Fidato hotel** lands in the PMS as *waiting for the
  hotel* with the room already held; the hotel confirms; the PMS reference
  goes back to the CRS and the one voucher goes (PL-9).
- **Order:** the New booking screen with every recorded field first (PL-7),
  then the CRS bridge, then the copy, the inbox, inventory, marketing, the
  switch. Each phase is a multi-agent build run by the master, one phase
  after another (PL-8).
- **Influvate sells all of it, the CRS included** (PL-4, *not* the
  recommendation). So the CRS moves onto the PMS's server and Postgres before
  its first buyer (PL-6).
- **Two things are urgent and are the owner's:** the CRS repository is still
  public (checked today, § 7 R1), and the Meta token was due to expire about
  today (§ 7 R2).

---

## 1 · What each system does today

### 1.1 Side by side

| | **PMS** | **CRS** | **Market-to-revenue ("live inventory")** |
|---|---|---|---|
| Folder | `D:\fidato pms` (branch `cp6`) | `D:\fidato crs` | `D:\fidato tools\new live invetory` (sic), **no git** |
| Job | Runs Fidato's own hotels | Sales team sells nights at 28 partner hotels Fidato does not own | Leads inbox fed by Meta ads through WhatsApp; typed availability for six Fidato hotels; ad spend and return |
| Live | pms.fidatohotels.com, api.fidatohotels.com (release `0b4766e`; `cp6` far ahead) | crstest-9a0c5.web.app, v1.3.2 | live-inventory1.web.app (build of 24 Sep) |
| Code | React 19 + TS, Hono API, Postgres with RLS | React 19 + TS, Firestore | React 19, plain JS/JSX, Firestore |
| Server | The Oracle box: API, Postgres, n8n | None (Firebase free plan) | None; n8n on the box does the server work |
| Login | Firebase `poms-fad05` | Firebase `crstest-9a0c5` | Firebase `live-inventory1` |
| Size | 32 service folders, 145 migrations | 52 routes, 45 pages | 14 screens, 65 files, about 16,000 lines; 808-line rules |
| Hotels | 5 Elements Akkalkot live (18 rooms, D3) | 28 partner hotels, 105 room types (in Firestore) | 6 hard-coded in `src/hotels.js` |

### 1.2 What each holds that matters here (with paths)

**PMS**
- New booking: `src/modules/reservations/pages/NewBooking.tsx`; the booking
  itself `api/src/modules/reservations/book.ts`, one act for a person and a
  machine.
- **The CRS door is half built already.** A booking sent twice is one booking
  (`db/migrations/091_booking_external_ref.sql`: the sender's reference, a
  line number and a fingerprint, unique per booking source). A machine's
  booking, refused when full, and a real cancellation:
  `createChannelBooking` / `cancelChannelBooking` in
  `api/src/modules/reservations/channel.ts` (migration 111, built for the SU
  channel manager, D17-79).
- A booking *waiting* already exists in the schema: status `tentative`
  (005). It **holds a room** in availability (044) and gets **no
  confirmation message** (126).
- The one door out for every message: `api/src/sending.ts` (data as JSON to
  n8n, which writes the WhatsApp or email; `canSend()` false until the
  owner's n8n steps, `docs/briefs/n8n-sending.md`).
- Guest messages (confirmation, day-before reminder, the guest's page link):
  `api/src/modules/guest-messaging/`, built, not switched on.
- One guest across the group, Guest 360, blacklist warning, consent ticks,
  offers opt-in: CRM phase 1 (122, 127, 141).
- Marketing lists (stayed twice, not back in a year, by booking site), logic
  only: `src/modules/marketing/logic/lists.ts`.
- Revenue outlook and pickup: `src/modules/revenue-management/`.
- `leads` and `crs` are Coming soon pages only: `src/modules/leads/`,
  `src/modules/crs/`.

**CRS** (read-only survey, 27 Sep)
- Booking wizard `src/features/reservations/NewReservationPage.tsx`; save in
  `src/data/repositories/firestore/index.ts` (`reservationsRepo.create`,
  line 866). Reference `FH-{year}-{00001}` from `counters/reservations`,
  which any active user can rewrite (duplicates possible).
- **It has no availability at all.** `inventory` is read, never written;
  salespeople phone the hotel, which is why a hotel confirmation number is
  compulsory before saving (CRS-7).
- Outbound: one browser POST to an n8n webhook on `reservation.created`
  (`src/lib/webhook.ts:62`) with header `X-Fidato-Signature`. The workflow
  `docs/n8n/fidato-reservation-meta.json` emails the voucher, saves the PDF to
  Drive, sends a WhatsApp template through Meta, and writes the Supabase
  register. The secret sits in `settings/webhook`, readable by **every**
  staff account. `automationQueue` rows are never closed; cancellations are
  queued and never sent.
- The reservation already has homes for the bridge: `hotelConfirmationNumber`,
  `voucherSentAt`, `automation{status…}`; `Integration.category` includes
  `pms`.

**Market-to-revenue app** (read-only survey, 27 Sep)
- Screens (`src/App.jsx:160-221`): Dashboard, Rooms, Edit Availability,
  Inbox and lead page, Room photos, Reports, Revenue, Marketing, Admin,
  Activity.
- Leads are `conversations/{id}` with `messages`, `events`, `calls`; plus
  `contacts/{digits}`, `numberMappings`, `messageTemplates`, team rosters,
  settings, `auditLog`. Twelve statuses (`src/leads/model.js:4-19`).
  Attribution is already captured: `campaignId`, `ctwaClid`, first and latest
  touch.
- n8n workflows A to H, source in `n8n/*.js`, now aimed at
  **n8n.fidatohotels.com, the PMS's own box** (`n8n/README.md:27`): A
  inbound WhatsApp (writes Firestore with a service account), C outbound, E/F
  Meta and Google Ads spend, G/H photos and files.
- Inventory: `hotels/{id}/availability/{date}_{type}`, typed per date, no
  document means fully available, no prices. Room photos are base64 in
  Firestore.
- Consent: a do-not-contact switch per lead; STOP/START handled in workflow A;
  a guest-data lookup and erase in Admin.

### 1.3 Where they overlap today

| Thing | PMS | CRS | Market-to-revenue |
|---|---|---|---|
| Availability of 5 Elements | computed, 18 rooms (the record, D1, D3) | none | typed, 17 rooms |
| A booking | real, billed | real for partner hotels | a typed "booked" reference and value |
| A person | `guests`, one per person since 122 | `customers` (a lead is a customer with status lead) | `contacts/{phone digits}` |
| WhatsApp | guest messages via n8n, not on | voucher template via n8n | the inbox, via n8n |
| Marketing | lists; opt-in consent (D25-39) | none | campaigns, spend, return, attribution |
| Sales person | `reservations.sales_person` text (042) | `ownerId` | lead `assignedTo` |

The same hotel, three ids: `5EL`, `htl-akkalkot-5-elements-by-fidato-hotels`,
`five-elements-akkalkot`.

---

## 2 · The target shape

```
          Meta (WhatsApp, ads)                         SU channel manager
                 │                                            │ its own door (built)
                 ▼                                            ▼
     ┌──────────────────────┐   API, one key per   ┌─────────────────────────────┐
     │ n8n on the PMS box   │──── outside system ─►│            THE PMS          │
     │ (keys live here only)│◄─────────────────────│  Postgres = the record      │
     └──────────▲───────────┘                      │                             │
                │ webhook + re-read                 │  front desk · bookings      │
     ┌──────────┴───────────┐                      │  bills · night audit · POS  │
     │  CRS (separate app)  │                      │  ── market-to-revenue ──    │
     │  sales team, partner │                      │  leads inbox · WhatsApp     │
     │  hotels; later on the│                      │  live inventory board       │
     │  PMS server (PL-6)   │                      │  marketing · revenue        │
     └──────────────────────┘                      └─────────────────────────────┘
      old market-to-revenue app: live until the switch, one-way copy into the PMS,
      then read-only for a month, then off
```

| Stays separate | Becomes PMS screens on PMS data | Talks through the API |
|---|---|---|
| The CRS (the sales team's, partner hotels) | Leads inbox and lead page, WhatsApp replies, templates, routing, follow-ups | CRS → PMS bookings; PMS → CRS availability and references |
| Meta, SU (outside services) | Live inventory board for all six hotels | Meta ↔ n8n ↔ PMS (inbound messages in, sends out through `sending.ts`) |
| | Marketing: campaigns, spend, attribution, return; the existing lists | SU ↔ PMS (built on its own door) |
| | Revenue from leads, stamped from real bookings | The one-way copy from the old app, until the switch |

Rules carried from the 15 September plan: the PMS is the record for a PMS
hotel (D1); browsers never hold a PMS key (the CRS and the old app talk to
n8n, n8n to the PMS); every inbound message can be replayed without effect;
ids are mapped, never reused; no figure crosses that the source has not
agreed to (no default prices).

---

## 3 · The New booking screen against the owner's screenshot

The owner's choice: **every field that changes what a booking records, in our
layout** (PL-7). "Have" means the screen has it today; "column" means the
database has it and the screen does not.

| # | In the screenshot | Ours today | To do |
|---|---|---|---|
| 1 | Check-in date | Arrival ✓ | none |
| 2 | Check-in time | Expected check-in ✓ (064) | show the hotel's check-in time as the hint |
| 3 | Nights | shown under Departure ✓ | none |
| 4 | Check-out date | Departure ✓ | none |
| 5 | Check-out time | none | **add** expected departure time (one column); the hotel's check-out time as the hint; late check-out stays front desk's (063) |
| 6 | Room(s) | Rooms per line ✓ | none |
| 7 | Reservation type | always confirmed; `tentative` column (005) | **add** Confirmed / Waiting for the hotel. Waiting holds the room and sends nothing (044, 126). CRS bookings arrive as Waiting (PL-9) |
| 8 | Booking source | ✓ required | none |
| 9 | Business source | ✓ | none |
| 10 | Market segment | column (042); the walk-in screen has it | **add**, the walk-in's list |
| 11 | Sales person | column (042), free text on walk-in | **add as a pick from a list the owner keeps** (PL-11), sales people of the PMS and the CRS by name, "other" typed |
| 12 | Rate offered / Contract | none; the `contracts` service is Coming soon | **later**, with contract rates (O11) |
| 13 | Book all available rooms | "n left" shown per line ✓ | **add** one "all n left" button on the line |
| 14 | Quick group booking | more than one room is a group, with a group name ✓ | none |
| 15 | Complimentary room | column `is_complimentary` (020); a ₹0 rate is refused unless complimentary | **add** the tick (who may: O9) |
| 16 | Room type, rate type | room type and meal plan ✓ | none |
| 17 | Room (a number) | assigned later on the desk (`AssignRoomFlow`) | **add** an optional room pick through front desk's assign door |
| 18 | Adults, child | ✓ | none |
| 19 | Rate incl. tax per line | rate before tax; "Empty uses the calendar" ✓ | **add** the tax figure beside it, from finance's tax rules |
| 20 | Add room | Add ✓ | none |
| 21 | Add discount | none | **add**: up to 10% by hand with a reason, more only by a named promotion (PL-10, the restaurant's rule of 083) |
| 22 | Title (Mr.) | none | **add** `guests.title` |
| 23 | Name, look-up | name ✓; returning-guest suggestion ✓ (D21-20) | none |
| 24 | Mobile, email | ✓ | none |
| 25 | Address | column `address_line`, asked only at check-in for foreigners | **add** |
| 26 | PIN code | none | **add** `guests.pincode` |
| 27 | Country, city | columns (004) | **add** |
| 28 | State | none on `guests` | **add** `guests.state` |
| 29 | C Form | Form C / Form III at check-in (025, 144, D27-25) | stays at check-in; **add** nationality at booking so the desk knows a form is due |
| 30 | Email booking vouchers | guest messages' confirmation (built, off) | **add** Send voucher, once, with "sent 14:02 by …" (PL-9); WhatsApp or email by the consent ticks (D21-72) |
| 31 | Email at check-out, with a template | the reviews service asks after departure (waits on the review link) | none new; the wording lives in n8n (D17-87) |
| 32 | Access to guest portal | the guest's page `/g/:token` (114) goes with the confirmation ✓ | show the link on the booking |
| 33 | Suppress rate on registration card | **no registration card is printed today** | only after a card exists (O7) |
| 34 | Billing summary: room charges, taxes, due | accommodation before tax ✓ | **add** taxes and due, from finance's one definition of a bill |
| 35 | Bill to | `reservations.company_id` (005), `folios.bill_to` (006); the route does not write the company (CRS-12) | **add** Guest / Company |
| 36 | Tax exempt | none | **wait for the CA** (O8) |
| 37 | Payment mode (an advance) | payments only on the bill | **add** an advance with its method on the booking's bill, **after the CA's answer on advances** (SELLING-IN-INDIA C2) |
| 38 | Check-In button | the walk-in flow exists (`WalkInFlow.tsx`) | **add** "Book and check in" for today's arrivals, through front desk's door |
| 39 | Reserve button | Confirm the booking ✓ | none |

Twenty fields to add, two after the CA, two later. Migrations: one in
`reservations` (departure time), one in `guests` (title, state, PIN), one for
the sales-people list and room promotions.

---

## 4 · The CRS → PMS bridge for Fidato's own hotels

Approved in outline on 22 September (D22-26: keys per outside system, a
booking door that ignores repeats, availability for machines, one API
document; D22-27: 5 Elements only, both ways). Today's answers fill in the
voucher and the hotel's step (PL-9). Standing rules: D1 the PMS is the
record; D5 the CRS quotes, the PMS bills, the PMS reference goes back; D10 a
machine is held to stop-sell and minimum nights and may not send ₹0 unless
complimentary; D11 poll first; D14 all-inclusive refused.

### 4.1 The flow

1. A salesperson books 5 Elements in the CRS. For a hotel flagged as on the
   PMS, the CRS saves it as **waiting for the hotel** instead of demanding a
   confirmation number (CRS-7).
2. The CRS's existing webhook reaches **n8n on the box**. n8n checks
   `X-Fidato-Signature`, then **re-reads the reservation from Firestore with
   the CRS's automation account** (the secret is readable by every staff
   account, so the webhook alone proves nothing, CRS-17).
3. n8n translates by a written rule the owner confirms (extra beds, children,
   payment term, all-inclusive refused, rate ≤ 0 or rooms < 1 refused) and
   calls the PMS with **the CRS's own key** and `externalRef` = the CRS's
   **document id** (not `FH-…`, which can repeat).
4. The PMS books it through `createChannelBooking` as **tentative**: the room
   is held at once, nothing is sent, **refused if full** (D17-43). A repeat is
   answered with the first booking (091). A refusal goes back to the
   salesperson as "no room free".
5. The desk sees it on **Waiting for the hotel** and presses **Confirm**.
6. On confirm: the PMS reference returns to the CRS as
   `hotelConfirmationNumber` (n8n polls every 5 minutes, D11), and **the one
   voucher** goes to the guest through `sending.ts`. The CRS's own voucher
   workflow is skipped for PMS hotels. Both sides show "voucher sent 14:02
   by …" (`voucherSentAt` already exists in the CRS). A resend is a
   deliberate button.
7. **Availability out:** every 15 minutes n8n reads the PMS's availability
   for machines and writes the CRS's `inventory` documents for 5 Elements;
   the CRS wizard shows "n left, from the hotel".
8. **Cancelled in the CRS:** n8n drains `automationQueue` (closing its rows,
   the CRS's own open item) and calls `cancelChannelBooking`. Changed dates or
   rates stay by hand with a note to the desk (CRS-22).

### 4.2 What exists and what is missing

| Piece | State |
|---|---|
| Repeat-proof booking door, refused when full, cancel | **Built** (091, 111, `channel.ts`) |
| Waiting booking holds a room, sends nothing | **Built** (005, 044, 126) |
| The one door out, guest messages | **Built, not switched on** |
| A key per outside system, revocable in Administration → Integrations | **To build** (S), in the shape of the SU door's key |
| The CRS route over `channel.ts`: book, confirm, cancel, "changed since" list | **To build** (M) |
| Availability for machines (one definition, out-of-order subtracted, no ₹0 for unpriced, PMS-10) | **To check and fix** (S) |
| Waiting for the hotel list and Confirm on the desk | **To build** (S) |
| One voucher with its sent stamp | **To build** (S), on guest messages |
| `docs/API.md` | **To write** (S) |
| n8n workflows (booking in, references back, availability out, cancel) | **To write** (M); the owner imports them |
| CRS: PMS-hotel flag, "waiting" state, counters fix, show inventory, skip its voucher for PMS hotels | **To build in the CRS** (M), on a branch there, never pushed; nothing PMS-shaped committed to it |

Before a CRS booking can land: 5 Elements' room types in the CRS re-imported
from the PMS's (D3: 18 rooms, Superior and Deluxe), and guest messages
switched on for the voucher to go.

---

## 5 · Market-to-revenue, natively in the PMS

### 5.1 Where each feature goes

| In the old app | Home in the PMS | Notes |
|---|---|---|
| Inbox, lead page, statuses, follow-ups, calls, tags | `leads` service (today a Coming soon page) | new screens and tables; the twelve statuses kept |
| WhatsApp in (workflow A) | a PMS door n8n calls with its key | same routing: number, keyword, campaign, guest's pick; **plus** a message from a phone that has a booking goes to that booking's hotel |
| WhatsApp out (workflow C, G) | `sending.ts`, extended for replies inside the 24-hour window and templates outside it | one door, one record |
| Contacts | `guests` with the 10-digit phone rule (CRM-Q1) | a join is suggested, a person confirms (D21-2) |
| Templates, routing, team on duty, round-robin | leads settings; people from PMS staff | new roles **Sales** and **Marketing** (O3) |
| Rooms, Edit Availability, Reports | `inventory`: **one availability board for all six hotels** | 5 Elements computed; the other five typed by their GM until each runs its desk on the PMS |
| Room photos | the PMS server's files | where the PMS keeps files: settled in Phase 5 (O13) |
| Marketing: campaigns, spend (E/F), attribution, return | `marketing`, beside the existing lists | spend sync re-pointed to the PMS |
| Revenue from leads | `marketing` + `revenue-management` | a booking carries `lead_id`; expected and realised revenue stamped from the PMS, never typed (LD-1 to LD-3) |
| Guest data lookup and erase | CRM | joins the DPDP work (SELLING-IN-INDIA C4, C5) |
| Activity log, users | the PMS's change log and People | already built |
| Dashboard's enquiries today | a Dashboard tile | |

"Book" from a lead opens New booking with the name, phone and lead filled in,
source *WhatsApp lead*; staff never type a PMS reference.

### 5.2 The copy while the old app keeps working (PL-5, PL-12)

1. **Count first (S).** Documents per collection, and which carry a time
   stamp the copy can follow. Free plan: 50,000 reads a day. If a collection
   has no stamp, adding one line to that app's write is the owner's call and
   is agreed with the chat working there.
2. **One full copy**, then **only what changed**, every 5 minutes, by an n8n
   workflow on the box (it already holds that Firestore account for
   workflow A) into a PMS import door. Each row keyed on its Firestore path,
   so a replay changes nothing.
3. **Checked every night:** counts per collection on both sides, shown in
   Administration → Integrations.
4. **Not copied:** 5 Elements' typed availability (the PMS is the record; the
   app says 17 rooms, the hotel has 18). Room photos only once, at the switch.
5. **Consent carried as it is:** a do-not-contact becomes a "no"; nobody gets
   a "yes" to offers by being imported (D25-39, D26-6).

### 5.3 Switch day

Meta's webhook and workflows A and C point at the PMS; the copy stops; the
old app's rules go read-only; it stays so for a month; then its data is
exported to an archive and erased on the lawyer's retention answer.

### 5.4 WhatsApp, one number (PL-3)

- One number and one inbox for the leads, the vouchers, the reminders and
  the bills. A guest who answers a voucher reaches the same inbox, tagged
  with the hotel.
- Meta charges per message delivered since 1 July 2025. Utility templates
  (confirmation, reminder, bill) are free inside an open 24-hour window;
  marketing templates are always charged; a click-to-WhatsApp ad opens a
  72-hour free window. ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing))
- Offers go only to a phone with a yes (D25-39, D26-6), which is also Meta's
  rule for messages the business starts
  ([Meta opt-in](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in)).
- The ad click id (`ctwa_clid`) already travels with the first message; it is
  kept on the lead for attribution.

---

## 6 · Roadmap

The owner's order (PL-8): the booking screen, then the bridge, then the rest,
**one phase after another, each run as a multi-agent build by the master**:
lane sessions in their own copies, folders in parallel inside a phase, the
gates run here, the master merges, the owner looks, then the next phase.
Nothing is pushed or deployed (19 September). This starts after the queued
release and the CA's answers (HANDOVER § 3).

| Phase | What | Effort | Lanes | Needs from the owner |
|---|---|---|---|---|
| 0 | Make the CRS repository private; renew the Meta token; two-step sign-in on n8n | minutes | owner | the three actions |
| 1 | **New booking, every recorded field** (§ 3) | M | reservations, guests, finance, front-desk | the market segment list; the sales people list; the room promotions; titles; who may tick complimentary; the CA on tax exempt and advances |
| 2 | **CRS → PMS bridge, 5 Elements** (§ 4) | M | admin (keys), reservations, inventory, guest-messaging, docs, the CRS branch, n8n files | guest messages switched on (n8n steps, templates, pace); who confirms at the hotel; the translation rule; importing the workflows |
| 3 | **The copy** from the old app (§ 5.2) | M | leads (tables, import door), n8n | a yes to count; any time-stamp line in the old app |
| 4 | **Leads inbox in the PMS**, read-only on the copied data, then writing at the switch | L | leads, guest-messaging, guests, reservations (`lead_id`) | the Sales and Marketing roles; routing and follow-up rules re-confirmed; the template list |
| 5 | **Availability board**, the five hotels added as properties, typed availability, room photos | M | inventory, admin | each hotel's real rooms confirmed (the D3 lesson) |
| 6 | **Marketing and revenue**: campaigns, spend, attribution, revenue from real bookings, offers to a yes only | M | marketing, revenue-management | Meta and Google ad accounts stay connected through n8n |
| 7 | **Switch day**, a month read-only, archive and erase | S | master, owner | the day; the lawyer's retention period |
| 8 | **The CRS onto the PMS's server and Postgres**, one login | L | crs | before the first buyer who takes the CRS (PL-6) |
| 9 | **Selling it**: module switches, each buyer's own WhatsApp and Meta, Fidato out of the CRS too, n8n's licence | L | admin, all | the lawyer (R8); SELLING-IN-INDIA A14 |

**Phase 1 in short:** New booking gains check-out time, Waiting/Confirmed,
market segment, sales person from a list, complimentary, an "all left"
button, an optional room, discount (10% or a named promotion), title,
address, city, state, PIN, country, nationality, bill to, taxes and due in
the summary, Send voucher once, and Book and check in. Advance and tax exempt
wait for the CA; the registration-card tick waits for a card; contract rates
wait for contracts.

---

## 7 · Risks

| # | Risk | What to do |
|---|---|---|
| R1 | **The CRS repository is still public.** Checked 27 Sep: `github.com/hotelsfidato-ai/Crs-Test-` answers an anonymous visitor (HTTP 200); the PMS's does not (404). D22-28 (22 Sep) said private now. It holds a commission figure per hotel (marked simulated), a staff email, the register's Supabase project name, and now the code of a product Influvate sells | **The owner makes it private today** (GitHub → Settings → Danger zone → Change visibility) |
| R2 | **The Meta token** was due to expire about 27 September (D21-31: renewed at go-live; the leads inbox goes quiet until then) | the owner renews it, or confirms it is renewed |
| R3 | The CRS's webhook secret is readable by every staff account | n8n re-reads each reservation with the automation account before writing to the PMS (§ 4.1 step 2) |
| R4 | The CRS has no availability, so a salesperson can sell a full night | the PMS refuses when full and says so; availability goes to the CRS every 15 minutes |
| R5 | The CRS's reference counter can repeat | the key is the CRS document id; the counter rule fixed in the CRS |
| R6 | The free plan's 50,000 reads a day | copy only what changed; count first (§ 5.2) |
| R7 | **DPDP**: offers only with a yes (D25-39, D26-6/7); lead ids in the old app contain the phone number; nothing is erased on a schedule | the PMS uses its own ids; consent carried as a "no", never a "yes"; erasure joins SELLING-IN-INDIA C4/C5 |
| R8 | **n8n's licence** allows "your own internal business purposes"; running it inside copies Influvate sells may need n8n's commercial licence ([licence](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)) | lawyer's question; the alternative is that a buyer's copy sends WhatsApp from the PMS's own code, which is one HTTPS call to Meta |
| R9 | Selling the CRS: it runs on Firebase's free plan with a public repo and Fidato in its data | Phase 8 before its first buyer; each buyer their own WhatsApp account and Meta ads (D26-2: Influvate never uses buyers' data) |
| R10 | Three room counts for 5 Elements (18, 17, 17) | D3 stands: 18. Nothing is mapped from the other two |
| R11 | The old app has no git and another chat works in it | this plan writes nothing there; any change there is the owner's, with a backup first |
| R12 | Two messages to one guest | one voucher, recorded, never twice (PL-9) |
| R13 | The Hostinger n8n (the 15 Sep SEC-2) | the old app's docs now name the box's n8n; the Hostinger copies are not in use by these docs. Not checked on the box itself |

---

## 8 · The owner's answers (27 September) and what is still open

Numbered PL-n for the master to renumber into the day's decision list.

| # | Question | Answer |
|---|---|---|
| PL-1 | The CRS: separate app or a PMS module? | **Separate, talks to the PMS through its API** (recommended; D22-26) |
| PL-2 | The leads' WhatsApp history (D21-5 said linked, never copied) | **Move it all once and retire the app** (recommended). Replaces D21-5 |
| PL-3 | WhatsApp numbers | **One number, one inbox** for sales and the hotels (recommended; keeps D17-89) |
| PL-4 | What Influvate sells | **Everything, the CRS included.** Not the recommendation (the CRS stays Fidato's) |
| PL-5 | How the old app moves | **Keep the app and its database live until the full switch; build the screens in the PMS; copy its data one way into the PMS continuously; on switch day the old app goes read-only.** The owner's words, read back and confirmed |
| PL-6 | The CRS's database, since it is sold | **Onto the PMS's server and Postgres, later**, before the first CRS buyer (recommended) |
| PL-7 | The screenshot's Add Reservation screen | **Every recorded field, in our layout** (recommended) |
| PL-8 | What is built first | **The booking screen, then the CRS bridge, then the rest one phase after another, as a multi-agent build.** The owner's words, read back and confirmed |
| PL-9 | CRS booking messages | **The CRS booking goes to the hotel as waiting, the room held; the hotel confirms; one voucher goes, the same one whoever sends it (sales closing a lead, the CRS, or the hotel on a call or walk-in), recorded so it never goes twice.** The owner's words, read back and confirmed |
| PL-10 | Discounts on a room booking | **The restaurant's rule**: up to 10% by hand with a reason, more only by a named promotion (recommended) |
| PL-11 | Sales person on a booking | **Picked from a list the owner keeps** (recommended) |
| PL-12 | How the copy reads Firestore | **Only what changed, staying on the free plan** (recommended) |

**Open, each with a recommendation:**

| # | Question | Recommendation |
|---|---|---|
| O1 | Is the Meta token renewed? | renew it now; the inbox is quiet without it |
| O2 | The CRS repository is still public (R1) | private today |
| O3 | New PMS roles **Sales** (inbox, leads, availability board, New booking; no bills, no ID documents) and **Marketing** (campaigns, spend, reports; no guest ID) | yes |
| O4 | Who confirms a waiting CRS booking at the hotel | reception, hotel manager and GM |
| O5 | A CRS booking refused for no room | the salesperson is told in the CRS within 5 minutes; nothing is created |
| O6 | The five hotels' rooms as `src/hotels.js` has them | the owner confirms each before it is added |
| O7 | "Hide rate on the registration card" needs a registration card, which the PMS does not print | build the card with Phase 1's front-desk lane only if wanted |
| O8 | Tax exempt, and an advance at booking | wait for the CA (C2) |
| O9 | Who may tick complimentary | owner, admin and GM |
| O10 | n8n in buyers' copies (R8) | the lawyer first; send from the PMS's own code for buyers if in doubt |
| O11 | Contract rates ("Rate offered: Contract") | with the `contracts` service, later |
| O12 | Imported leads and offers | a do-not-contact becomes a "no"; nobody is a "yes" by import |
| O13 | Where room photos live in the PMS | on the server's disk with the backups; decided in Phase 5 |

---

## 9 · Sources

- Meta, WhatsApp pricing (per message since 1 July 2025; utility free in the
  window; 72-hour ad window): https://developers.facebook.com/docs/whatsapp/pricing
- Meta, phone numbers (two per new business portfolio, 20 once verified):
  https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers
- Meta, opt-in: https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- Meta, message webhook (the ad referral and `ctwa_clid`):
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text
- Firebase, managed export needs the Blaze plan:
  https://firebase.google.com/docs/firestore/manage-data/export-import
- n8n Sustainable Use License: https://github.com/n8n-io/n8n/blob/master/LICENSE.md
- The PMS: `docs/HMS-INTEGRATION-PLAN.md`, `docs/audits/2026-09-15-*.md`,
  `docs/SELLING-IN-INDIA.md`, `docs/briefs/decisions-2026-09-*.md`
