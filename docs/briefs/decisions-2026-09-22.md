# The owner's decisions, 22 September 2026

| # | Question | Answer |
|---|---|---|
| D22-1 | Where the project's working copies and local tools live, and how parallel work runs | **Nothing about this project lives outside `D:\fidato pms`.** The owner gives orders in ONE main chat; the main chat sends helper agents, each working in its own copy inside the project (`.claude\worktrees\<service>`), and merges their work. The local Postgres moved from `D:\fidato-pg` to `.local\pg`, the screenshots to `.local\screenshots`, the gate script into `scripts\gates.sh` (its logs to `.local\gates\`). 22 finished service copies went to the Recycle Bin (every branch was already merged into `cp6`; all 46 branches stay in the history) and their 22 test databases were dropped, with a backup of each in `.local\pg\backups\service-copies-2026-09-22\`. The two copies still in use (guest messaging, online check-in) moved into `.claude\worktrees\`. `D:\fidato-crs-backups` belongs to the CRS project and was left alone |
| D22-2 | May a GM give the Admin role? (a GM could, and an Admin sets the module switches — round D17-36) | **No. Only the owner or an admin makes an admin.** A GM gives every other role |
| D22-3 | A GM cannot add staff on People (refused, against D21-67) | **People works for the GM, for their own hotel only** |
| D22-4 | Two menu fixes from POS-15 | **A tax-heading picker on each menu section: yes.** "Section's rate" first on the add-dish form: **not chosen** — the form keeps its 5% choice |
| D22-5 | The other chat writing in the main folder (UI transformation briefs) | **The owner's separate research chat, not part of this work: leave its files alone** (the master never commits them) |
| D22-6 | A screen to set up a hotel's restaurant till and tables | **Yes, before the second hotel** |
| D22-7 | The desk's printed bill says "Tax Invoice" with no number | **"Interim bill" before check-out**, as on the guest's page |
| D22-8 | CRM-2 and CRM-3 | **Both:** a "not the same person" answer on the same-person list; a warning on Arrivals and at check-in when a booking-site guest is blacklisted |
| D22-9 | Start the queued fixes when helpers free up | **The master's recommendation: all four** — one rule for In house / Empty (D21-36/37); FD-8 and the three finance rule-breakers; MKT-1, SPA-2, ADM-3; the services' notes brought up to date |
| D22-10 | REV-3, a group asked for a review once per room | **Once per group, at the lead guest's room** |
| D22-11 | PUR-1, housekeeping and purchase requests | **Housekeeping may view and raise purchase requests** |
| D22-12 | City ledger tile's words, three design one-offs, lanes pointed at DESIGN.md | **The master's recommendation: all three** ("Shows a dash until company payments are recorded.") |
| D22-13 | When the next release goes | **After the three running helpers are merged and every check passes** |
| D22-14 | RM-Q3, what counts as soft | **14 days, 50% soft, 85% filling well — as built**; review after a month of real bookings |
| D22-15 | RM-Q2, the price shown on a soft date | **The achieved rate** |
| D22-16 | RM-Q1, where Revenue outlook sits | **Under Rooms and rates, as built** |
| D22-17 | MKT-3 and MKT-2 | **Marketing's lists: owner, admin and GM only. The birthdays list is dropped** (no date of birth is kept) |
| D22-18 | A screen to correct a closed day | **Yes, a GM screen**: a reason is required, and the old and new figures are both kept |
| D22-19 | Missing menu entries | **Store in the kitchen manager's menu; Rooms in housekeeping's menu** |
| D22-20 | A store issue and its outlet | **Yes: an issue records the outlet it went to** |
| D22-21 | The shared demo owner login and two stray logins (left on 15 Sep) | **Switched off before 5 Elements' first real day**, with the owner's go-ahead on the steps |
| D22-22 | Laundry in working menus, where a hotel has it on | **Housekeeping, reception, GM and hotel manager** |
| D22-23 | Rooms board kept on the desk computer after a reload with the server down (`PERSISTED`) | **Yes, like Arrivals and In house** |
| D22-24 | Roles per hotel | **No: one list of roles for the whole group** |
| D22-25 | The demo companies and agents on the live site | **Cleared before the first real day; the owner or GM adds the real ones** |
| D22-26 | The CRS connection plan (21 Sep: keys per outside system, a booking door that ignores repeats, availability for machines, one API document) | **Yes, after this release** |
| D22-27 | How far the first CRS connection goes | **5 Elements only, both ways**: the CRS books in, availability goes back |
| D22-28 | The CRS repository is public (D8) | **The owner makes it private now**; the master checks the result, read-only |
| D22-29 | The channel manager (SU) | **Stays on hold** until 5 Elements runs on the PMS for real |
| D22-30 | PMS-2: the matrix against D21-47 and the commission route | **The GM creates and edits room setup** (room types, rooms, imports, front-desk hours, banquet halls and packages); **admin and GM edit commission** — in the matrix itself, and the by-name exceptions go |
| D22-31 | PMS-2: people who lose writes they have today by calling the server | **Refused, as the role list says** (hotel manager, reception, revenue manager: room setup, GST, hours, commission; reception, hotel manager, accountant: menu edits and taking a dish off) |
| D22-32 | Who sets GST and the VAT rate | **Owner, admin, GM and accountant** |
| D22-33 | Who issues a credit note | **Owner, admin, GM and accountant** — no longer reception or the hotel manager |
| D22-34 | Who updates a repair and reports a room repair | **Owner, admin, GM, hotel manager, Inventory Manager and housekeeping** |
| D22-35 | The revenue manager and the POS menu | **Kept out of the menu**: the revenue manager sets room prices only |
| D22-36 | Who runs the night audit | **As it is**: owner, admin, GM, hotel manager, reception, accountant |
| D22-37 | The accounting export's "Excel" (a CSV today) | **Both: the CSV and a real .xlsx** |
| D22-38 | The Store's second part (par levels, count sheet, gas by cylinder) | **After the queued fixes** |
| D22-39 | Guest messages: the day-before reminder's hour | **10:00, hotel time** |
| D22-40 | A booking made the day before arrival | **One message: the confirmation** (it carries the link); no reminder within a day of it |
| D22-41 | Several rooms booked by one guest | **One confirmation per group, to the lead guest** |
| D22-42 | Switch-on day: catch-up confirmations for older bookings | **Only between 09:00 and 21:00, hotel time**; new bookings are confirmed at once, any hour |
| D22-43 | Soft drinks and snacks sold at a bar that serves alcohol | **GST, as built**: the menu section decides; a dish in an Alcohol section with its own rate stays GST at that rate |
| D22-44 | A separate VAT bill for alcohol? | **Yes, a separate VAT bill** — issued at the same moment as the GST document for the same sale (restaurant settlement; check-out for drinks on the room bill); **its own series per hotel, restarting each 1 April** (e.g. VAT/5EL/2026-27/0001), never sharing numbers with GST invoices; the GST invoice names the VAT bill and the VAT bill names the GST invoice; **cancelled like a credit note, with a reason, by owner, admin, GM and accountant** |
| D22-45 | The Lodging tax report's "Other bills" includes alcohol | **Take alcohol and its VAT out** |
| D22-46 | "Alcohol" as a section's tax heading in the menu import | **Yes**, with the heading picker (D22-4); only where the hotel serves alcohol |
