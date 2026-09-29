# Loyalty

Returning guests rewarded: points on their stays at every hotel of the
group, taken off their room charges.

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

---

## Built — 30 September (D27-178, D27-179)

**Folder name:** `loyalty`, in all three places:

```
src/modules/loyalty/               the Loyalty screen, the member card, the menu entry, the address
api/src/modules/loyalty/           the routes, and earnAtCheckOut for the front desk
db/migrations/174_loyalty.sql      numbered for now; the master settles it at merge
db/tests/modules/loyalty.sql       one check per rule (L3-L16)
```

### Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Loyalty | `/h/:code/loyalty` | `pages/Loyalty.tsx` | whoever sees guests (`customer`), Sales and marketing, in nobody's working menu |
| (a card on Guest 360) | `/crm/guests/:id` | `MemberCard.tsx`, exported from `index.ts` | the owner, an administrator, the GM |

The Loyalty screen: who is in house with their points; **Join** (the
programme's own words read to the guest, and their tick, L4), **Use points**
(from 500, one key per press), **Leave** (what is left lapses, L5); **The
rules** (name, points per ₹100; whoever sets the group's name); **Points by
hotel** in a month, in rupees (managers, L18). The member card: points,
the statement at every hotel, an adjustment with a reason, Leave.

### The server

```
GET    /:code/loyalty                     the screen                      customer view
PUT    /:code/loyalty/rules               name, points per ₹100            app.sets_group_settings
POST   /:code/loyalty/guests/:id/join     {agreed: true}                   customer edit
POST   /:code/loyalty/guests/:id/leave                                     customer edit
POST   /:code/loyalty/stays/:id/redeem    {points}, idempotency-key        invoice create
GET    /:code/loyalty/guests/:id          the card                         app.loyalty_card: managers
POST   /:code/loyalty/guests/:id/adjust   {points, reason}                 app.is_crm_manager
GET    /:code/loyalty/by-hotel?month=     earned and used by hotel         app.is_crm_manager
```

`earnAtCheckOut(client, stayId)` is the front door the check-out calls, once,
after the stay is checked out (`front-desk/operations.ts`).

### The database (migration "loyalty")

- `group_settings.loyalty_name`, `.loyalty_points_per_100`: no default. No
  rate, nothing earns and the screen says so.
- `hotel_modules`: `loyalty`, off until turned on in Settings → Modules.
- `loyalty_members`: the guest record, where, who, when, the words agreed.
  A person is `app.guest_standing`, so joined records share one balance.
- `loyalty_points`: append-only (`forbid_mutation`); `earn` once per stay,
  `redeem` pointing at its discount line, `adjust` with a reason, `lapse`.
  A redemption whose discount line was reversed (↺) counts for nothing:
  the points come back by themselves.
- Points off a bill are a `discount` folio line per bill and GST rate,
  earliest nights first, taxed at the nights' rate (CA-L1). **The CA's
  answer lands in `app.loyalty_redeem`** (a ponytail note marks the line).

### Left open

- **L17, expiry after 24 months with no stay: not built.** No point can
  lapse before October 2028; write the lapse row before then.
- **Guest 360's card is not placed**: `crm` is claimed by the contracts
  lane. The two lines are in Requests below.
- The CA's six answers (CA-L1 to CA-L6).
- A code to the member's phone before points are used (L16), once sending
  is switched on.

---

## Rules that bind it

- **No decision without the owner** (`HANDOVER.md` § 5). The rules above are
  the owner's (D27-179); anything else is asked.
- **Never invent a figure; a missing one is a dash or a sentence, never a
  zero.**
- **Reach other services only through their `index.ts`**
  (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b --force`, `npx vitest run src/modules/loyalty
src/components/app/navigation.test.ts`, `cd api && npm test` (its
`test/modules/loyalty/` and `roleGate.test.ts`), `bash db/tests/run.sh`
(`db/tests/modules/loyalty.sql`).

---

## Requests from other services

- **30 September, loyalty to crm:** Guest 360 shows the member card. In
  `src/modules/crm/pages/Guest360.tsx`, `import { MemberCard } from
  "@/modules/loyalty";` and, after the "Every stay, at every hotel" card,
  `<MemberCard hotelId={hotelId} guestId={g.id} />`. Not done by this lane:
  crm is claimed by the contracts lane; the master decides who adds it.
