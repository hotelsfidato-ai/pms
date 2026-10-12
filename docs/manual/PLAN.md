# The Fidato PMS manual - the plan (D27-268, 3 October)

The owner asked for a full manual, like a car's: every workflow with screenshots and
arrows, every part of the system, why each decision was taken, what was left out and
why, the edge cases, and what the tests prove. Answers (3 Oct): **two parts**, a
**printable PDF**, **planned now, written after the weekly reset (7:30 pm IST)**.

## How it is made since 9 October (D27-293)

The owner, 9 October: finish this book, restaurant chapter first, with real
screenshots and numbered arrows, kept current by a rule and a check.

- **One file per chapter**: `chapters/a0.html` … `chapters/b9.html`, the shape
  of A0. `node docs/manual/tools/build.mjs` joins the written ones, in the
  plan's order, behind a cover and contents worked out from them, into
  `manual.html` (never edited by hand; `parts/head.html` is the style).
- **Pictures**: `shots/<chapter>.mjs` lists each picture - who signs in (a test
  sign-in), the address, the steps, the numbered arrows - and
  `node docs/manual/tools/shoot.mjs <chapter>` takes them into `img/` with a
  Chrome of its own. A picture not taken yet stays a dashed `shot-plan` box.
- **Kept current**: AGENTS.md's definition of done and CLAUDE.md; and
  `src/test/manual.test.ts` - every menu screen of a written chapter's part is
  named in it (`COVERS`), `manual.html` is built from the chapters as they are,
  every picture shown exists.
- The book stays on this machine (19 Sep): it is not published anywhere.

## How it was first planned

- One print-ready HTML book in `docs/manual/` (A4 pages, chapter numbers, a contents
  page, page breaks per chapter), saved as PDF from the browser (Ctrl+P, Save as PDF).
  No new tool or package.
- Screenshots from the local demo hotel (5 Elements Akkalkot, test data only - never a
  real guest), 1280 px for desk screens and 375 px for phone screens, with orange arrows
  and numbered callouts drawn over them. Kept in `docs/manual/img/`.
- Every "why" quotes the decision number (D17-.. to D27-..) from `docs/briefs/decisions-*.md`.
- Written chapter by chapter, busiest work first; each chapter is shown to the owner
  before the next.

## Part A - the staff manual (step by step)

| # | Chapter | Covers |
|---|---|---|
| A0 | Getting started | Signing in, the three spaces (Front office, Restaurant, Settings), choosing the hotel, Find a screen (Ctrl K), desk vs phone, the offline bar |
| A1 | The front desk day | Dashboard, arrivals, in-house, departures, the room grid (stay view) |
| A2 | Bookings | New booking (walk-in, phone, group), price shown, the WhatsApp tick, the voucher; change dates, move room, cancel, no-show, cancellation terms |
| A3 | Check-in | ID and Form C, assigning a room, deposit, express check-in; online check-in (marked "later", D27-266) |
| A4 | The guest's bill | Charges, payments, discounts, corrections, split bills, company billing, invoice and credit note |
| A5 | Check-out | Normal, late, early departure; the bill printed and paid |
| A6 | Housekeeping | Room status, assignments, work orders, laundry |
| A7 | Night audit | Closing the day, what it checks and refuses, the reports it sends |
| A8 | Restaurant | Tables, the order screen (Restaurant/Bar tabs, notes, D27-267), kitchen screen and KOT, till and terminal, the bill (GST, alcohol's own VAT bill), charge to room, settle, close the day; room dining; banquet functions |
| A9 | Stores and purchasing | Stock, issues, purchases, suppliers |
| A10 | Guest messages | What goes out (the voucher on WhatsApp and email, D27-264/266), the Guest messages screen, what a failure means |
| A11 | Reports | Which report answers which question |
| A12 | Approvals, cash expenses, notifications | Who approves what |
| A13 | Spa, laundry, loyalty | Only where the hotel has them switched on |

## Part B - the owner's book (how and why)

| # | Chapter | Covers |
|---|---|---|
| B1 | The system at a glance | What runs where - website (Firebase), API and database (Oracle server), n8n, the CRS, Meta WhatsApp, email - as a diagram with arrows; one booking's journey through all of them |
| B2 | People and security | Roles, who sees what, sign-ins and devices, the audit log, each hotel's data kept apart (row security) |
| B3 | Money rules | No default prices (a dash, never a zero), taxes (room 5%/18%, restaurant 5%, alcohol VAT 10% on its own bill series), invoice numbers, the business date, rounding, why an issued invoice never changes, credit notes |
| B4 | Rooms and rates | Room types, the pricing basis and offsets, rate plans, restrictions, CRS room type mapping |
| B5 | Connections | The CRS bridge, the n8n sending workflow, the WhatsApp template, email, DigiLocker (off), the provisioning key |
| B6 | Each module in depth | What it owns, the decisions taken and why, what was left out and why (e.g. GST on advances, other currencies, automatic night audit, two-step sign-in, our own WhatsApp templates on hold, online check-in and review request later) |
| B7 | Edge cases | Per workflow: overbooking, room move mid-stay, group bills, night audit with open bills, the restaurant offline, message retries and the duplicate guard, catch-up hours, a hotel with no menu or no rates |
| B8 | Tests and checks | What each gate is (website and server tests, migrations and replay, the strip check, "no test sign-in in the build"), the counts, what they prove and what they do not |
| B9 | Running it | Releases (and the 3 October lesson: build only from the release copy, with the sign-in settings), server settings, backups and restore, what to do when something breaks |
| - | Appendices | Glossary, the decision index (number to one line), the screen index |

## Answered by the owner (3 Oct)

The chapter list as planned; screenshots show the test hotel, 5 Elements Akkalkot, with made-up guests.
