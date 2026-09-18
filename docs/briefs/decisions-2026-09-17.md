# The owner's answers — 17 September 2026

**Every service chat reads this before its next write.** The owner answered all
open questions in one interview on 17 September. These are decisions: build to
them, do not re-ask them. Anything they do not cover is still a question for the
owner, with a recommendation.

Where two chats touch one feature, the split is written under it. Migration
numbers: the next after cp6's highest when you write the file; the master
renumbers at merge if two collide.

---

## Store and equipment

| # | Question | Answer |
|---|---|---|
| D17-1 | Who may add places and suppliers | **Owner, admin, GM, Hotel Manager and Inventory Manager.** Everyone else reads. *(Master: `api/src/routes/places.ts`)* |
| D17-2 | Stock already recorded, which has no place | **It sits in the Main store.** *(Store chat, in its stock-per-place migration)* |
| D17-3 | Main store, Kitchen store, Bar store | **Created automatically at every hotel, and at every new one.** More can be added; an unused one is switched off. *(Master: migration, before the Store chat's)* |
| D17-4 | How a gas cylinder is priced | **Refill price per full cylinder received, AND the deposit held on each cylinder with the supplier is tracked.** Empties are counted going back. *(Store chat)* |

## Equipment repairs — phase 2B *(Housekeeping chat)*

| # | Question | Answer |
|---|---|---|
| D17-5 | Who may record a repair cost | **Hotel Manager, Inventory Manager, GM, admin, owner.** |
| D17-6 | Does a repair cost need approval | **No approval — but a cost is recorded only WITH PROOF attached: a photo or screenshot of the bill, the payment or the transaction.** Use the shared attachments (`api/src/routes/attachments.ts`, migration 077). A cost with no proof is refused, in a sentence. |
| D17-7 | Opening and closing a repair | **Opening a repair sets the item "Under repair"; closing it sets "In use" again — automatically.** The equipment tables are the equipment service's: go through `src/modules/equipment/index.ts` / its server front door; anything missing is a request to the master. |

## Housekeeping board *(Housekeeping chat)*

| # | Question | Answer |
|---|---|---|
| D17-8 | The three icons on a room card | **Words under them: "Clean", "Inspected", "Repair"**, and a greyed one says why when tapped — e.g. "Room 202 is already inspected." |
| D17-9 | A "Needs cleaning" section | **Not now.** Do not build it. |

## Counting and the night *(Master unless named)*

| # | Question | Answer |
|---|---|---|
| D17-10 | What "In house" counts, everywhere (FD-1) | **Guests checked in now:** rooms with a guest who has checked in and not checked out. Today's arrivals who have not come are not counted until they check in. One definition, named the same on every screen. *(Master)* |
| D17-11 | Which record says a room is out of service (INV-6) | **The dated block** (from a date, with a reason). The Rooms screen, the property's room count and the admin list follow it. *(Master)* |
| D17-12 | Two presses of Run night audit (NA-3) | **Idempotent.** A day already closed is not run again: a second press — at the same moment or later — changes nothing and **shows the record that was made**. Any **correction to a closed day's record needs the GM.** *(Night audit chat)* |
| D17-13 | The unused night-audit history (NA-1) | **Show a history of closed days** on the Night audit screen: who ran it, rooms posted, revenue, no-shows. *(Night audit chat)* |

## Administration and money

| # | Question | Answer |
|---|---|---|
| D17-14 | The audit log's "admin" on every entry (ADM-1) | **Record and show the real person.** *(Admin chat)* |
| D17-15 | The server answering what the screen hides (API-2) | **Refuse it, like the screen**, for every role without the grant. *(Admin chat)* |
| D17-16 | A stay with no bill (FIN-2) | **A dash, never ₹0.** *(Finance chat)* |
| D17-17 | "Owed by guests" on the Dashboard (REP-6) | **"Owed by guests, less refunds"** — same number. `src/lib/glossary.ts` says the same. *(Master)* |

## Restaurant and banquet

| # | Question | Answer |
|---|---|---|
| D17-18 | Kitchen slip from Tables (POS-5) | **Tables opens the kitchen slip on every send, like the Terminal.** *(POS chat)* |
| D17-19 | Dish add-on switches (POS-2) | **On/off switches for add-ons on the Menu screen**, like dishes have. *(POS chat)* |
| D17-20 | Dates on Close restaurant day (POS-7) | **"Tuesday, 25 August 2026" — and the hotel's name with it**, so each property's close is easy to tell apart (the button too). *(POS chat)* |
| D17-21 | Restaurant food on a banquet bill (BQ-1) | **Build it.** Split: the **Banquet chat** makes the function's bill show its restaurant orders and exports, through its front door, the functions an order may be attached to; the **POS chat** then lets staff attach an order to one of those functions when ordering (`pos_orders.event_id` exists). Banquet goes first. |

## Words on screens

| # | Question | Answer |
|---|---|---|
| D17-22 | Headings that differ from the menu | **The heading is the menu name:** Diary (BQ-2, *Banquet chat*), Companies and agents (GUE-1, *Guests chat*), Room types (INV-2, *Master*). |
| D17-23 | A hotel with no rooms (FD-5) | **"No rooms set up yet. Add them in Room types."** *(Master)* |

## Release

| # | Question | Answer |
|---|---|---|
| D17-24 | The Store's STO-2 to STO-11 | **Merge now.** *(Master)* |
| D17-25 | Deploy | **Today, after the Store merge** — the master gives the steps. |

---

# The second interview — 17 September, evening

The owner's goal, in their words: **build everything up to and including the
channel manager, then QA.** The order is `docs/NEXT-BUILD-PLAN.md`.

## What to build, and in what order

| # | Question | Answer |
|---|---|---|
| D17-26 | The first big build | **Reports and bills in the group's own layout** |
| D17-27 | After that | **The channel manager** — then QA. Reviews and marketing come after the channel manager |
| D17-28 | The master record | **The PMS** is the record for rooms, availability, prices and bookings; the CRS and the live inventory show copies (plan D1) |
| D17-29 | Where logins and WhatsApp workflows live | **n8n on the PMS server** (plan D2) |
| D17-30 | The channel manager | **A vendor such as STAAH**, not direct OTA connections |

## Reports and bills

| # | Question | Answer |
|---|---|---|
| D17-31 | Excel | **Both: a real .xlsx AND a CSV** on every report |
| D17-32 | PDFs | **Made on the server** |
| D17-33 | Room charges | **Keep the whole stay posted on arrival.** Do not change to nightly |
| D17-34 | Sending bills, invoices, vouchers | **WhatsApp and email through the n8n on the PMS server** |

## Settings, purchasing, housekeeping, small fixes

| # | Question | Answer |
|---|---|---|
| D17-35 | Purchase approvals (S11) | **The GM approves every purchase.** No owner limit |
| D17-36 | The GM and Settings | **The GM may open Settings; the module switches stay owner and admin only** |
| D17-37 | ADM-2, the old tax on Settings and Properties | **Show the tax actually used**; a dash where nothing is set |
| D17-38 | Closing a repair while its request waits | **Refused, as built** |
| D17-39 | HK-1, the board refreshing itself | **Build it now** |
| D17-40 | The assignee dropdown on each card | **Keep as is** |
| D17-41 | FD-7, "Today" off a phone screen | **Fix now** |
| D17-42 | The unused night-audit "can run" route | **Remove it** |

## Channel manager, CRS, leads

| # | Question | Answer |
|---|---|---|
| D17-43 | A booking for a room no longer free | **Refuse it and tell the channel.** Never overbook automatically |
| D17-44 | Cancelling an OTA booking | **The OTA's policy for OTA bookings**; the hotel's terms for direct ones |
| D17-45 | Which hotels go on the channel manager first | **Left open** — build it so each hotel is switched on separately |
| D17-46 | A CRS booking at a PMS hotel | **The PMS prices it, bills it and sets the tax** (plan D5) |
| D17-47 | The CRS repository being public | **The owner handles it. Do not touch** |
| D17-48 | The long dash "—" | **Banned everywhere** in what a person reads |
| D17-49 | A figure nobody has set | **A short hyphen "-"** (the no-zero rule stands) |
| D17-50 | All-inclusive bookings | **Add the all-inclusive meal plan now** |
| D17-51 | The live inventory's three frozen parts | **Each may change once**, those three only (plan D6) |

## Apps, and the services still to come

| # | Question | Answer |
|---|---|---|
| D17-52 | Apps | **Wait until the system is fully built.** Recorded for then: shared core first (A1), Android Management API for the kiosk (A4) |
| D17-53 | Guest-facing | **Online check-in and guest messages** — a confirmed booking sends the online check-in link by email and WhatsApp. No booking engine or loyalty for now |
| D17-54 | Hotel services | **Laundry and spa, each behind a per-hotel on/off switch** — it shows only where switched on. Not guest requests or room systems |
| D17-55 | Business | **Tally export (designed later — which Tally is decided then), revenue management, reviews and marketing.** Not contracts |
| D17-56 | Revenue management | **Suggestions only**; a person sets the price |
| D17-57 | Online payments | **Still excluded** |

---

# The third interview — 17 September, night

| # | Question | Answer |
|---|---|---|
| D17-58 | How fresh money figures must be (FIN-3) | **Re-checked every time a screen is opened or brought back into view** *(Master)* |
| D17-59 | Who removes the long dash | **Each working chat in its own folder, as part of its next job; the master does the shared core and every service with no chat working.** Nobody pauses |
| D17-60 | What replaces it | **Inside a sentence: a spaced hyphen " - "** (e.g. "Room 308 - out of service"). **A figure nobody has set: "-"** (D17-49). Code comments are not screens and may keep theirs. A date range's short dash "–" is not the long dash |
| D17-61 | Deploy | **Wait: one deploy after the Store's stock per place and the dash pass** |
| D17-62 | Which reports | **Every report, in the format the owner gave** — the eight in `docs/REPORTS-SPEC.md`, from the eZee exports in `D:\reports fidato\` |
| D17-63 | The bill and voucher template | **The owner saves CRS voucher FH-2026-00002 into `D:\reports fidato\`**; bills follow its look |
| D17-64 | Paper | **A4** for hotel bills and tax invoices; the restaurant keeps its thermal slips |
| D17-65 | WhatsApp and email in n8n | **Need setting up** — the master gives the owner the n8n steps; nothing sends until they are done |
| D17-66 | The channel manager | **SU** (Su channel manager). API documents: https://suissu.gitbook.io/su-api-documentation/su-channel-manager . **Build the connection** in the channel-manager service |
| D17-67 | Purchasing | **Starts after the Store's stock per place is merged** |
| D17-68 | All Inclusive | **Covers everything charged to the room** |
| D17-69 | Crockery and cutlery (phase 2A) | **The Store chat goes straight on to it** after stock per place |

---

# Answered in the Reports chat — 17 September, night (relayed to the master)

| # | Question | Answer |
|---|---|---|
| D17-70 | Reports matching the eZee PDFs | **Follow the eZee LAYOUT, with the group's own BRANDING** (Fidato's colours and type, `src/styles/theme.css`, not eZee's navy and maroon). Figures come from the system's own data; the demo cannot match the exports line by line |
| D17-71 | Room charges on reports | **Spread over the stay's nights, as eZee does:** Today is tonight's rent; monthly and yearly statistics show nights booked ahead at the booking's rate. Posting itself stays whole-stay on arrival (D17-33) |
| D17-72 | Complimentary rooms | **Count as sold, as eZee does**, on every report and the Dashboard: occupancy and ADR include them. `src/lib/glossary.ts` says so |
| D17-73 | Card payments | **Record Credit Card and Debit Card separately** — the Finance chat's (today one `card`). Reports print one "Card" row until it lands |
| D17-74 | The City ledger: what Debit is | **Debit (the Manager report's "Charges Raised") is bills transferred to the account** ("Bill to company", payments of method `city_ledger`) in the period. **Opening, Credit ("Payment Received") and Closing print "-"** until Finance can record a company's payment. The by-source figures are replaced. `getCityLedger` keeps its name and row type, so Finance's Billing screen does not break |
| D17-75 | Outstanding commission | **Prints "-"** until commission paid to OTAs is recorded |
| D17-76 | Folio No. on the Night audit report | **Prints the booking reference, headed "Booking"** |
| D17-77 | Dates on reports | **25/08/2026 (DD/MM/YYYY)** on screen, PDF and Excel, as eZee; **timestamps "25/08/2026 04:12:43 PM"** in the property's time. Shared formatters: `dateReport` and `dateTimeReport` in `src/lib/format.ts`, with the server renderer's copy held to them by a test |
| D17-78 | The printed Night audit report | **A report in All reports** ("Night audit report", under The day, found by search), not part of the night-audit service's screen |

---

# The fourth interview — 17 September, late night

| # | Question | Answer |
|---|---|---|
| D17-79 | How SU bookings reach the PMS | **Push: SU sends each booking to the PMS** the moment it happens (the owner: "the push architecture, they send to me, not the pull one"). A public address on the API for SU alone |
| D17-80 | An OTA booking with no room free (D17-43) | **Not created in the PMS.** Receipt confirmed to SU (else it resends for an hour); **0 rooms left sent at once** for that room type and dates; listed on a Channel bookings screen as **"Refused: no room free"** for the GM to cancel on the site and call the guest |
| D17-81 | A date with no price in the PMS | **Sent to SU as closed** for that meal plan (SU cannot take a price back), without a person pressing anything |
| D17-82 | A booking priced night by night | **Keep each night's price** as sent. A reservations change: today one agreed rate per stay |
| D17-83 | Card number and CVC in an SU booking | **Never kept:** dropped on arrival, never stored, logged or shown |
| D17-84 | Commission on an OTA booking | **SU's amount when it sends one, else the % recorded for that source, else "-"** |
| D17-85 | Who opens the SU setup screen | **The owner and an administrator.** The GM sees the status page |
| D17-86 | Company accounts (Finance) against the City ledger report | **Bills transferred, as the report counts them** (D17-74): one definition |
| D17-87 | How the PMS hands a bill or voucher to n8n (D17-34) | **The PMS sends the data as JSON to n8n; n8n completes and sends the message** |
| D17-88 | The email account | **Set up in n8n already.** The PMS sends only the guest's email address |
| D17-89 | The WhatsApp number | **The number the leads app uses** (its Meta token expires about 27 September) |
| D17-90 | Which database the demo, reset and retire-staff scripts use (CM-1, MEMORY 287) | **The copy's own database, from its own settings; with none, refuse to run** |

---

# The fifth interview — 18 September, small hours

| # | Question | Answer |
|---|---|---|
| D17-91 | The bill sent to n8n | **The PMS attaches its own PDF** as well as the JSON, so the guest gets the A4 document the desk prints (D17-64) |
| D17-92 | SU and the rack rate (P3-b) | **Send the rack rate** where a meal plan has no price of its own, instead of closing the date. Breakfast then sells at the room-only price until somebody prices it |
| D17-93 | Yearly statistics before go-live | **Available room-nights start at the property's first trading day**, as the eZee export does. Earlier months show nothing |
| D17-94 | The Night audit report before the audit closes (REP-11) | **Leave the not-yet-arrived booking in Room Charges.** It agrees with the Manager report, the footnote says the rule, and it goes when the audit marks the no-show |
| D17-95 | "Rate Type" on reports | **The meal plan the booking carries** (CP, EP, MAP, RO, All Inclusive). No separate rate-plan names to maintain |
| D17-96 | Extra Charges on reports | **By what the desk posts** — the eleven kinds — not a configured list somebody maintains |
| D17-97 | Daily Sales, the three eZee rows | **All three readings confirmed:** Incidental Sales is a banquet function's bill; Direct Room Sales is a bill with no stay behind it; Cancellation Sales has nothing to count, so it prints "-" |
| D17-98 | Block Room against the eZee export | **Keep this system's count** (the GM's NC room is blocked and is counted). The old export differs by that room, on purpose |
| D17-99 | Lodging tax, CGST and SGST columns | Read as **room rent less its discount**, everything else on those bills in Other Bills. **The group's accountant confirms before anything is filed from here** |
