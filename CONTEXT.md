# Context — what this project is, and what is actually true

Everything an agent needs to know that is not visible in the code.

---

## The business

**Fidato Hotels**, an Indian hotel group. Two systems exist:

| | |
|---|---|
| **CRS** — `D:\fidato crs` | Live at `app.fidatohotels.com`. Central reservation system across **32 properties**, most of them partner hotels. In production. Not ours to change. |
| **PMS** — `D:\fidato pms` | This project. Property management for the **7 owned** properties. Being built. |

They share a design system. `theme.css` is byte-identical across both, verified
by MD5 — and `src/components/ui/` here is **ported from the CRS, not written**.

---

## The property

Only **one** of the seven is confirmed. Everything below came from eight real
exports in `D:\reports fidato`, generated 25–26 August 2026.

```
5 Elements By Fidato Hotels · Akkalkot, Solapur District, Maharashtra

Rooms          17 sellable · 18 physical (308 normally out of service)
Numbers        201–210 (Superior) · 301–308 (Deluxe)
Room types     Superior · Deluxe
Rate plans     CP · Room Only · EP · MAP
Rack rates     Superior ₹4,099 · Deluxe ₹3,699
Tax            CGST 2.5% + SGST 2.5% = 5%
Financial year 1 April → 31 March
OTAs           Agoda · Booking.com · Expedia · go-MMT
Payments       Cash · UPI · Credit Card · Debit Card · GoMMT · Google Pay · Room Posting
POS outlet     Sattva — Food, Beverages
Banquet        Pancham Hall
Invoice series 5EFH-prefixed AND plain zero-padded numeric — two in play
```

**August 2026 actuals**, the demo data is calibrated to these:

```
431 available room-nights · 132 sold · 30.63% occupancy   ← 1–25 Aug (PTD, 25 days)
ADR ₹3,178.63 · RevPAR ₹973.50 · room revenue ₹4,19,578.77
318 adult / 28 child · 152 confirmed · 13 walk-ins · 10 comps · 0 no-shows
Daily occupancy swings from 0% to 100% — several empty days, two full ones
```

### What is NOT known

**Six of the seven properties have no confirmed name or room count.** Do not
invent them. An honest placeholder — `Property Two · awaiting confirmation` —
is a correct answer.

**The 175-room group total is unverified.** It must not appear in any screen,
document or conversation outside the project. It is also not the same number as
the 175 nights sold in 2026.

---

## The system it replaces

**eZee**, running today at 5 Elements. `docs/ezee-analysis.html` is the
functional reference, built from screenshots of the live system.

**eZee tells you what a screen must contain. `brand/` tells you what it looks
like.** Where they disagree on appearance, the design system wins. Where they
disagree on what information a screen carries, eZee wins — it runs a real hotel.

**POS is already live** at Sattva — ₹1,44,849.37 PTD, with a `Room Posting`
payment method already pushing restaurant charges onto guest folios. Stage 7 is
therefore a **migration off a running system**, not a greenfield build.

---

## The commercial question, still open

The alternative is buying eZee at roughly **₹1 lakh per property**.

**Under about ₹4 lakh a year for the group, buying wins and this project should
stop.** That has not been revisited since the numbers changed, and it is the
single largest open decision. Everything built so far — a verified schema and a
shared component library — has value either way.

A STAAH channel manager offer sits alongside it at ₹50/room/month plus ~₹5,000.

---

## What already exists and must not be rebuilt

### The database — `D:\PMS FIDATO\db`

**Built and verified, not planned.** It is ahead of the stages that consume it.

```
17 migrations   applied clean under ON_ERROR_STOP against PostgreSQL 17.6
22 tables       13 property-scoped · 9 group-level
32 RLS policies zero tables unprotected
51 assertions   all passing in db/tests/run.sh
```

Verified by execution: a clerk resolves to exactly one property, cross-property
writes are refused, self-grant into `staff_hotels` is refused, the ledger is
append-only, retried postings are rejected, closed business dates are refused,
and a deactivated group admin loses everything.

`staff.firebase_uid` exists and `app.current_user_id()` already accepts a
Firebase uid alongside a uuid — migration 017 did the Stage 3 groundwork.

**Still open on the database:** concurrency testing (all 51 assertions ran
serially) and WAL archiving / backup, logged as finding C3.

### The component library — `src/components/ui/`

Thirteen modules, ~100 exports, **ported from the CRS**. Pure presentation: no
Supabase, no Firebase, no feature imports. See `MEMORY.md` for the two live
accessibility defects porting it uncovered.

### The reports — `docs/REPORTS-SPEC.md`

Eight reports, specified from the real exports. Every column name, section
heading and formula is copied rather than invented.

```
Night Audit · Manager Report · City Ledger · No Show
Monthly Occupancy · Monthly Statistics · Yearly Statistics · Lodging Tax
```

---

## Decisions that shaped the code

Full log in `docs/DECISIONS.md`. The ones that surprise people:

**Stage 1 ships ONE property.** A data decision, not an architecture one.
Property id stays in the URL, `hotelId` stays in every query key and every
repository signature, and the switcher exists showing one entry. **Never
`properties[0]`, never a hardcoded id, never a branch on `length === 1`** —
adding six more must be a fixture edit, not a component rewrite.

**Room 308.** The Manager Report says 17 rooms; Monthly Statistics says 18
available on 8–13 August. Both are true — an 18th room exists and is normally
out of service. `BASE_ROOM_COUNT` derives from the sellable count.

**A `success` colour was added to the brand palette.** The guide has five warm
colours and nothing for "this went well". *Confirmed*, *paid* and *reconciled*
are among the most frequent states in an operational system. `#1f6f5c`,
deliberately muted and slightly teal. Flagged for brand review — do not "fix" it.

**Georgia survives in exactly one place.** The brand guide specifies Georgia +
Arial, which reads dated in a dense interface. Inter Variable is used
throughout, and Georgia is kept for printed and print-preview documents only,
via `.print-serif`.

**Role is a preview control, not identity.** Stage 1 has no auth, but the
navigation and Rule 6's `{ allowed, reason }` both need a role to read. When
real auth lands, `useUi(s => s.role)` becomes `useSession(s => s.role)` and
nothing else changes.

**Firebase is initialised but not wired.** Auth is Stage 3. `src/lib/firebase.ts`
starts the app and analytics and exposes `auth` — nothing reads application data
through it. Config in `.env`; those values are not secrets, a Firebase web
config identifies the project rather than authorising anything.

---

## The twelve stages

```
1   Frontend shell and screens        ← HERE. CP0–CP5 done, CP6 in progress
2   Repository layer behind the seam    landed early, inside CP3
3   Auth bridge — Firebase to session   Firebase initialised only
4   Front desk + folio, end to end
5   Night audit
6   Housekeeping, mobile, offline       the board already exists from CP5
7   POS bridge                          a MIGRATION — Sattva is live today
8   Billing, GST, Form C
9   Rates, availability, STAAH
10  Group dashboard and reports         spec already written
11  CRS bridge
12  Hardening and go-live
```

Roughly 15–20% by stage count, further by effort: the two hardest foundations —
a verified multi-tenant schema and a design system shared with production — are
done and need no revisiting.

---

## Five questions that still need a human

1. **The four keyboard checks.** Press Tab through `/h/:code/stay`: is there a
   visible focus ring on buttons or only inputs? Brand ring or browser default?
   Does Escape close the Dialog and Drawer? Does focus return to the trigger?
   Focus *trap* is confirmed working; ring rendering and key handling are not
   measurable from a script.
2. **Names and room counts for the other six properties.**
3. **Is Pancham Hall typical across properties, and sold by night, day or session?**
4. **What are the two icons beside each room number in the live Stay View?**
5. **Does the accessibility fix ship to the CRS now, or go to its backlog?**
