# Loyalty

Returning guests recognised, rewarded and offered a member rate.

> **30 September — D27-178: build it.** The programme's rules are the
> owner's. The questions below went to the owner through the master on
> 30 September.
>
> **THE OWNER'S ANSWERS, 30 September (D27-179):** everything as
> recommended, except
> - **L8:** the earn rate (points per ₹100) is **system configuration**, a
>   setting with **no default**: unset, nothing earns and the card says so.
>   1 point = ₹1 is the unit, not a setting.
> - **L12: no tiers** at the start.
> - **CA-L1 to CA-L6** went to the CA list. Until the CA answers, points
>   reduce the taxable value as a discount does (CA-L1's recommendation).

## The programme's rules — questions for the owner (30 September)

A simple, conventional programme for a small Indian hotel group. **Rec** is
the lane's recommendation, not a decision.

**Who and how they join**

- **L1 · Name.** What is the programme called? It is a group setting, never
  hard-wired (D21-27). Rec: "Fidato Rewards" for this group.
- **L2 · Hotels.** Which hotels take part? Rec: a switch per hotel, off until
  you turn it on; 5EL first.
- **L3 · Who may join.** Rec: any guest aged 18 or over with a mobile number
  (DPDP s.9: under-18s need a parent's verifiable consent). Free. One member
  per person across the group (D21-22, the one-guest record); two records
  joined as one person share one balance, and an undo splits it back.
- **L4 · Consent.** Rec: its own tick — "Join <name>: we keep your stays and
  points to give you rewards. I am 18 or over." — separate from "May we send
  you offers?" (D25-39, D26-7): joining is NOT a yes to offers. Kept with who
  recorded it, when, at which hotel and the words shown. English now; the
  notice's other-language copy and the privacy contact (s.5, s.6(3)) before
  13 May 2027.
- **L5 · Leaving.** Rec: a member may leave at any time, as easily as they
  joined; unused points lapse; the points history stays with the bills (tax
  records are kept 72 months).
- **L6 · Who does what.** Rec: Reception enrols and redeems (the guest is at
  the desk); owner, admin and GM also see the member card and statement on
  Guest 360 and may add or take points by hand with a reason.

**Earning**

- **L7 · What earns.** Rec: everything on the stay's bills (room, restaurant
  charged to the room, spa, laundry), before GST and after any discount —
  not GST or VAT, not alcohol, not the part paid with points. A restaurant
  bill paid at the till by a non-resident: not in phase 1.
- **L8 · Rate.** Rec: 5 points per ₹100, and 1 point = ₹1 off — 5% back.
  Whole points, rounded down per stay.
- **L9 · When.** Rec: at check-out, usable at once. Not changed afterwards
  except by a manager's adjustment (L6).
- **L10 · Bookings that do not earn.** Rec: OTA and travel-agent bookings
  earn on extras only, not on the room; complimentary and house-use stays
  earn nothing; a company-paid stay earns for the guest who stayed.
  Several rooms on one booking: each room earns for its own guest only.
- **L11 · Past stays.** Rec: none. Points start with the stay during which
  the guest joins.

**Tiers**

- **L12 · Tiers.** Rec: three, by nights checked out in the last 12 months,
  worked out at each check-out: Member (on joining) 5 points per ₹100;
  Silver (10 nights) 6; Gold (25 nights) 8. Other perks (late check-out,
  a welcome drink) shown on the card for the desk to offer, not applied by
  the system. The simpler option: no tiers at the start, one rate for all.

**Redeeming**

- **L13 · What redeems.** Rec: points come off the ROOM charges of the
  member's own stay, while checked in: from 500 points, up to the room
  charges on the bill. A "free night" is simply enough points to cover one
  night: the night stays on the bill at its price and the points appear
  under it as a discount line — never a zero price.
- **L14 · Where.** Rec: at any participating hotel, direct bookings only
  (not an OTA-prepaid stay), never for cash, never on somebody else's bill,
  not transferable.
- **L15 · The 10% rule.** D27-36 allows 10% by hand and more only through a
  named promotion. Rec: points count as a named promotion, so a redemption
  is not capped at 10%.
- **L16 · Proof it is the member.** Rec: the member is the stay's own guest,
  and signs the bill; a code to the member's phone once sending is switched on.
- **L17 · Expiry.** Rec: all points lapse after 24 months with no stay.
- **L18 · Who pays for a redemption.** Points earned at one hotel may be spent
  at another. Rec: the hotel that gives the discount carries it on its own
  invoice; a monthly report of points earned and spent per hotel, in rupees,
  so you can settle between hotels outside the system.

**Tax — for the CA (the master's CA list)**

- **CA-L1.** Points redeemed shown on the tax invoice as a discount on the
  room charge: does that reduce the taxable value under CGST s.15(3)(a), GST
  charged on the reduced value (Rec, and how the till already treats a
  discount, 038)? Or is GST due on the full value because the points were
  earned by paid stays?
- **CA-L2.** A night that falls to ₹7,500 or below after the points: does it
  move from 18% to 5% (the slab follows the value of supply;
  `docs/selling-in-india/gst.md`)?
- **CA-L3.** A night paid wholly with points: taxable value nil — no GST? At
  an 18% hotel, must input credit be reversed for it?
- **CA-L4.** Are points "vouchers" under s.2(118) and Circular
  243/37/2024-GST of 31 December 2024 (not a supply when issued; breakage not
  taxable)?
- **CA-L5.** Points outstanding: a liability to be provided for, and in which
  hotel's books when earned under one GSTIN and spent under another? Does a
  settlement between two hotels need an invoice?
- **CA-L6.** The restaurant's ₹7,500 test for the next year: values before or
  after points discounts?

**NOT BUILT. A Coming soon page only.** On the list of what every comparable system has; the owner chose on
16 September to give every missing service a folder and a Coming soon page.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `loyalty` — the word the other two places will use when it is
built:

```
src/modules/loyalty/               the Coming soon page, its menu entry and its address
api/src/modules/loyalty/           does not exist
db/tests/modules/loyalty.sql       does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

Membership, points or stay counts, and a member rate (`PROGRESS.md`,
item 14). It needs one guest to be one record first — the central CRM.

---

## Where it stands, and where that comes from

- **What comparable systems ship as standard** — `PROGRESS.md`, "What a
  market-leading HMS has that this does not", item 14. Domain
  knowledge about the category, not a decision by the owner.
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** A returning guest is not recognised: each booking creates a new guest record.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Loyalty | `/coming-soon/loyalty` | `pages/Loyalty.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "membership", "points", "repeat guest", "member rate", "rewards". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. The programme's rules: points or stays, and what a member gets.
2. The central CRM, so one guest is one member across hotels.
3. How the member rate is set.

---

## What it would lean on

- **crm** — one member across hotels.
- **inventory** — the member rate.
- **guests** — the guest record.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Loyalty.tsx` with the real screens, at their real addresses.
- Move the menu entry out of the Coming soon section into the section it
  works in, with the working menus it belongs to (`navigation.test.ts` pins
  every role's list, and the Coming soon list).
- If not every hotel has it, a module switch per hotel: one migration on
  `hotel_modules_known` (`041`, `087`) and the two lists in
  `api/src/modules/admin/moduleSwitches.ts`.

---

## Gates

`npx tsc -b --force` and `npx vitest run`, judged by the exit code —
`src/test/boundaries.test.ts` fails if this folder loses its `index.ts` or
this `MODULE.md`; `src/components/app/navigation.test.ts` pins the Coming
soon section.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
