# What gets built next — 17 September 2026

**The owner's plan:** finish what is in flight, deploy, then the owner runs QA
testing, then everything QA finds is fixed. This file is the order. Nothing in
tiers 3–5 starts without the owner's go; anything marked **ASK** waits on an answer.

Sizes are rough: **S** an afternoon · **M** one or two days · **L** a week or more.

---

## Tier 1 — before QA (the master, then one deploy)

Everything here is decided already (`docs/briefs/decisions-2026-09-17.md`) or is a
request a chat handed the master. It makes the system agree with itself, so QA
tests the real thing instead of finding what we already know.

| # | What | From | Size |
|---|---|---|---|
| M1 | **Main, Kitchen and Bar stores at every hotel**, and at every new one | D17-3 | S — **the Store chat waits on this** |
| M2 | Hotel Manager and Inventory Manager may add places and suppliers | D17-1 | S |
| M3 | **The numbers that disagree:** one "In house" (checked in now) on every screen; one status per booking; one balance per stay | D17-10, critique #1 | M |
| M4 | Out of service follows the dated block on Rooms, the property count and the admin list | D17-11 (INV-6) | M |
| M5 | A stay with no bill shows a dash, not ₹0; the In House balance column | D17-16 (FIN-2), FIN-3 | S |
| M6 | Words: Room types heading, "Owed by guests, less refunds", the no-rooms message | INV-2, REP-6, FD-5 | S |
| M7 | Chats' requests: one shared "could not load" message; the offline sentence for a function bill; Tables keeps the chosen function in its draft; broken audit-log links (ADM-4); one wrong word on the Channel manager page | banquet, POS, admin, guests | S–M |
| — | **Deploy**, then a QA checklist per role for the owner | D17-25 | — |

## Tier 2 — the Store, phase 1A (Store chat, after M1)

| What | Size |
|---|---|
| Stock held per place; the stock already recorded sits in the Main store (D17-2) | M |
| Minimum levels per place, and the list of what is below | S |
| The count sheet: count, compare, one correction per difference | M |
| Gas by cylinder: refill price per full cylinder, deposits tracked, empties counted back (D17-4) | M |

## Tier 3 — stock and equipment, phase 2 and 3 (after tier 2 is merged)

| What | Who | Size | Needs |
|---|---|---|---|
| **2A** Crockery and cutlery: breakage with who and where, in use per outlet, the monthly count | Store chat | M | — |
| **2C** Purchasing: request → approval → order to a supplier → delivery lands in the Store or the equipment register | a new Purchasing chat | L | **ASK:** the amount above which the owner approves, not the GM (S11) |
| **3A** Reports: stock value, use per outlet, wastage and breakage, equipment and repair cost | Reports chat | M | after 2A and 2C |
| 3B Supplier bills and payments | — | — | later, with Tally (S10) |
| 3C A dish sold uses its ingredients (recipes) | — | — | later (S9) |

## Tier 4 — reports and documents in the group's own layout (ASK first)

| What | Size | Needs from the owner |
|---|---|---|
| Reports laid out like the eZee exports, PDF and Excel on every report, the Manager report's five missing sections, the printed four-page Night Audit report (HANDOVER 3.4) | L | Real `.xlsx` or CSV? PDF made in the browser or on the server? |
| Bills and vouchers on the voucher template, sent by WhatsApp and email (HANDOVER 3.5) | L | The voucher file saved to `D:\reports fidato\`; the registered name and GSTIN as printed; bank details per hotel; policies and times; send through n8n or a direct service |
| Room charges posted one night at a time by the night audit, not the whole stay at arrival | M | **ASK:** it moves every in-house balance |

## Tier 5 — the big programmes (the owner's go, one at a time)

| Programme | Plan | Blocked on |
|---|---|---|
| **One hotel system:** the CRS, the live inventory and WhatsApp leads, a channel manager, a central CRM | `docs/HMS-INTEGRATION-PLAN.md` | 14 decisions; D1, D2 and D4 first |
| **Apps:** desktop (Tauri), a locked kiosk tablet, a phone staff app (Expo) | `docs/APPS-PLAN.md` | its decisions in § 7 |
| The Coming soon services: booking engine, online check-in, revenue management, Tally export, contracts, guest messages, guest services, laundry, spa, room systems, loyalty, marketing, reviews (payments stays excluded) | `docs/briefs/coming-soon.md` | which the group actually wants |

---

## Open questions from the chats (no build until answered)

- **Admin:** may the GM open Settings and the module switches? ADM-2: Settings still shows an old tax — fix it?
- **Housekeeping:** a repair cannot be closed while its request waits for approval — keep that? Should the room assignee dropdown on every card change?
- **Night audit:** keep or remove the unused "can run" check?
- **Front desk:** FD-7, the "Today" button runs off a phone screen — fix now or with the next layout pass?
- **HK-1**, the board refreshing itself — deferred by the owner.

## Owner actions — not code, and some are urgent

1. **The Meta WhatsApp token expires about 27 September.** Renew it.
2. **Backups sit on the same disk as the database** (P0). A copy must live somewhere else.
3. **Rotate the Firebase Admin key** — it once passed through a chat.
4. **The CRS repository is public** and carries a commission figure per hotel.
5. The n8n update to 2.39.6.
6. For QA on the live site: one test account per role (reception, housekeeping, kitchen, Inventory Manager, GM…) created on the People screen.
