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
