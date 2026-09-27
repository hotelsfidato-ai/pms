# The owner's decisions, 27 September 2026

| # | Question | Answer |
|---|---|---|
| D27-1 | Five small bugs found by the sessions: GUE-2 (the Form C due list's long dash for a missing room); a GM's "No such order" on a restaurant order the owner opened; the Night audit report's restaurant lines without outlet or order; an outside till's void of a corrected ticket answering an error; a refusal naming "customer" | **Fix them in one session, medium effort**, each with a test that fails without it |
| D27-2 | Cash-limit gaps: the outside till's door not asked the ₹2 lakh rule; two same-second cash payments for one guest could both pass | **Close both**: the same rule at the outside till's door; one guest's cash payments take turns |
| D27-3 | The FSSAI number read live on every invoice view | **Frozen on the invoice when it is issued**, like the GSTIN |
| D27-4 | A desk payment larger than the bill | **Warn, then allow**: "This is ₹X more than the bill; it will be held as the guest's credit", confirmed by the desk |
| D27-5 | The refusal RequireAccess shows (asked by the five bugs session) | **It names the screen's menu entry**, e.g. "You are signed in as Reception, which does not include Guest 360." |
| D27-6 | An outside till's void of a bill already taken off at the hotel | **"Bill {ref} has already been taken off the guest's bill at the hotel. Nothing to void."** |
| D27-7 | An outside till's lines on the Night audit report | **"Outlet: X" only** (no order number) |
| D27-8 | A person's name the reader may not see on a restaurant bill | **"Served by -"** |
| D27-9 | Close restaurant day: cash paid in or out that the owner recorded is missing from a GM's list (till.ts day end joins staff; MEMORY 283's fault), found by the five bugs session | **Fix it the same way**: the list shows every movement, "-" where the name is hidden; with a test. Given to the cash and invoice session |
| D27-10 | The outside till's door (/api/pos/tickets) and the ₹2 lakh rule (half of D27-2), asked by the cash and invoice session | **Nothing added there**: that door only puts a restaurant bill on a guest's room bill; no cash changes hands, and that bill's cash is asked the rule at the desk when it is paid |
| D27-11 | How the desk confirms a payment larger than the bill (D27-4) | **A tick in the Settle dialog: "Hold it as the guest's credit"** (like "Form 97 taken"); Take payment stays off until it is ticked |
| D27-12 | A payment held as the guest's credit: does it ever carry past check-out? | **No: refunded at check-out, as built**; no money is held for guests who have left |
| D27-13 | When the release goes (everything from 22 to 27 Sep; database changes 125 to 145) | **Now**: the owner types the steps (D22-13), fresh from the master, each labelled with where it runs |
| D27-14 | The new product name (D25-32) | **Suggest some names**: short, trade-markable names for a hotel system, as a shortlist for the owner and the lawyer's search |
| D27-15 | Audit work needing no CA or lawyer answer | **Start now, one session**: backups off the server and a health watch (A9), cyber-security basics under CERT-In (A8), an open-source notices file (A15) |
| D27-16 | The 5 Elements GM's login details | **Not ready yet** |
| D27-17 | The new product name (D25-32, D27-14): the owner's picks after a first screen (docs/selling-in-india/product-name.md) | **Tomai, Yadou, Kyado** — an invented, Japanese-sounding word of 4 or 5 letters, standalone (no "Influvate"), easy in any Indian language. To the lawyer's trade mark search (classes 9, 42; 35 optional). Tomai is risky ("TomAI", AI software); Yadou and Kyado screened clean. Not a legal clearance |
| D27-18 | Where backup copies go off the server (A9, asked by the operations session) | **Oracle Object Storage in Fidato's own account (Mumbai)**, through an upload-only link; only the owner reads them, in the console |
| D27-19 | How long copies are kept off the server | **30 days** (the server keeps its own 14 as before) |
| D27-20 | How the owner is told a backup failed or the site is down | **WhatsApp through n8n**, and (the session questioned n8n watching its own box) **a free outside backstop: UptimeRobot by email** for "server or n8n unreachable" |
| D27-21 | How long logs are kept (A8) | **1 year** (CERT-In 180 days now; DPDP 1 year from 13 May 2027) |
| D27-22 | The CERT-In point of contact | **The owner, for both Fidato Hotels and Influvate** (two forms) |
| D27-23 | The n8n alert workflow | **The owner builds it from the written steps**; no import file |
| D27-24 | The operations work (backups off the server, logs, clock, notices): in tonight's release or separately | **Separately, after**: tonight's release stays as checked; ops/basics-27sep is merged after the owner has pushed it and has made the Oracle bucket and the n8n alert, then a small second release applies it |
| D27-25 | Form C replaced by Form III (Immigration and Foreigners Act 2025, in force 1 Sep 2025; the audit's A3): arrival and departure each within 24 hours, more details | **Start a session now, high effort**; it re-reads the Act and Rules and asks the owner anything unclear |
| D27-26 | Redesign every screen with the fidato-design skill (the look approved as D22-47 to D22-51) | **Start a session now**: shared parts first, then screen group by group, each shown to the owner before the next; screens keep their words, figures and behaviour; the Form III screens wait until that lane merges |
| D27-27 | The CRS and the PMS (the platform plan's PL-1) | **The CRS stays a separate app and talks to the PMS through its API** |
| D27-28 | The leads and WhatsApp history (PL-2) | **Moved into the PMS once, and the old app retired**. Replaces D21-5 "linked, never copied" |
| D27-29 | WhatsApp numbers (PL-3) | **One number, one inbox for sales and hotels** (keeps D17-89) |
| D27-30 | What Influvate sells (PL-4) | **Everything, the CRS included** (the master had recommended the CRS stay Fidato's) |
| D27-31 | The transition (PL-5) | **The old app and its Firestore stay live until the full switch**; the screens are built natively in the PMS; a one-way continuous copy runs Firestore → PMS; on switch day the old app goes read-only |
| D27-32 | Where the CRS runs (PL-6) | **Moves onto the PMS server and Postgres later, before its first buyer** |
| D27-33 | The New booking screen (PL-7) | **Takes every recorded field of the owner's Add Reservation screenshot, in our layout** |
| D27-34 | Order of work (PL-8) | **The booking screen first, then the CRS bridge, then the rest one phase after another**, built by parallel sessions |
| D27-35 | A CRS booking for an owned hotel (PL-9) | **Arrives WAITING (tentative) with the room held; the hotel confirms; then ONE voucher goes** — the same voucher and template whoever sends it (sales, the CRS, or the desk), recorded so it never goes twice |
| D27-36 | Room discounts (PL-10) | **The restaurant's rule**: 10% by hand with a reason, more only by a named promotion |
| D27-37 | Sales person on a booking (PL-11) | **Picked from a list the owner keeps** |
| D27-38 | The Firestore → PMS copy (PL-12) | **Reads only what changed**, staying on the free plan |
| D27-39 | Redesign order (the redesign session) | **Shared parts, then Dashboard / Rooms / Calendar, front desk, bookings, housekeeping, finance, restaurant, then the rest; the guest page and the Form III screens last.** New booking waits for Phase 1 |
| D27-40 | Text sizes in the redesign | **15 → 14 and 13 → 12 everywhere, onto the D22-51 type ladder; typing boxes stay 16px on a phone.** Replaces the "body text 15px or more" test |
| D27-41 | Buttons | **Capsule buttons everywhere, colours unchanged** |
| D27-42 | The business date line | **"Business date · Tuesday, 25 August 2026" above the title on Dashboard, Rooms and Calendar only** |
| D27-43 | Dashboard, "Today's run" (redesign group 1) | **Built, and its counts come only from what the system holds**: check-ins of today's arrivals, check-outs of today's departures, clean empty rooms of all empty rooms |
| D27-44 | Dashboard, the room strip | **Built**, over the six counts |
| D27-45 | Section notes | **Behind an (i), same words** |
| D27-46 | Rooms, the group summary line | **Dropped** |
| D27-47 | Week arrows | **On the Calendar only**, not on Rooms. (Group 1 held for the owner's approval after their audit, 27 Sep) |
| D27-48 | Stay colours on the lists (redesign group 2) | **In house blue everywhere; Due in orange, like Arriving.** Phase 1 asks the owner the colour of "Waiting for the hotel" |
| D27-49 | Words on Walk-ins and Arrivals (redesign group 2) | **"Stay view" becomes "the Calendar"** |
| D27-50 | Arrivals and In house tabs | **A segmented switch in the title row** |
| D27-51 | Redesign group 2, and what next | **Group 2 approved as it stands; housekeeping next while the bookings screens wait for Phase 1** |
| D27-52 | Printed documents (redesign, finance group) | **Every bill and document looks like the CRS voucher** (`D:\fidato crs\src\features\reservations\voucher.ts`, renderVoucherHtml): logo masthead, orange-barred title and number, fact strip, two columns, 2px ink rule, totals, orange-edged panels, footer, in its sans. Content unchanged. Finance now (tax invoice and credit note, VAT bill and its credit note, BillPrint); the restaurant bill and reports with their groups. Supersedes DESIGN.md's Georgia print font |
| D27-53 | The logo on bills | **One logo for the whole group, chosen in Settings, printed on every bill. A setting, not code (D21-27):** this Fidato copy fills it with the Fidato SVG by upload; a buyer's copy starts empty and prints the hotel's name. The logo never goes in a migration |
| D27-54 | The Tappable Rule (DESIGN.md) | **Keep every screen simple. Anything tappable looks tappable (buttons, orange links, an arrow on a tile or row that opens something); anything not tappable never looks like a button (status pills and counts stay flat)** |
| D27-55 | Market segments on New booking (Phase 1) | **The walk-in's five, as they are** |
| D27-56 | The sales people list | **Starts empty; the owner adds the names** |
| D27-57 | Room promotions | **Start empty** |
| D27-58 | Guest titles | **Mr, Ms, Mrs, Dr, or none** (a database CHECK) |
| D27-59 | Who may tick complimentary, and keep the two lists | **Owner, admin and GM; the server refuses anyone else** |
| D27-60 | Confirming a waiting booking | **A "Confirm the booking" button, for anyone who may make a booking** |
| D27-61 | The booking summary's tax and due | **What the bill will carry: the first night's price for every night, as the night audit posts it** (the old sum of each night's calendar price, RES-4, fixed) |
| D27-62 | Typed rates and the discount | **Typed rates stay as today; the 10% rule binds the Discount box** |
| D27-63 | "Waiting for the hotel" on the booking lists | **Grey (neutral)** |
| D27-64 | Cancelling a waiting booking (RES-5) | **Cancel it directly**: the room frees at once and nothing is sent, for the same people who may cancel a confirmed booking |
| D27-65 | The bills' masthead | **The property's name, and under it "by <group name>"** (e.g. "5 Elements Akkalkot / by Fidato Hotels"), chosen over a logo above the name. The group's name comes from the same group setting as the logo (D27-53, D21-27); nothing in the code names Fidato |
| D27-66 | Reviewing the rest of the redesign | **One review at the end, not group by group** ("do the updates, will give all things in one shot"). The redesign session runs helpers, three at a time in their own copies, on screens only; the owner approves everything together |
| D27-67 | Who may change the group's name and logo (the logo session) | **The owner, an administrator or the GM, at any hotel.** Against the recommendation (group administrators only); the risk was put to the owner: any hotel's GM changes every hotel's bills. Every change is audited |
| D27-68 | The logo's size limit | **200 KB**, PNG or SVG (an SVG with script refused); the name at most 80 characters, blank clears it |
| D27-69 | Cancelling a waiting booking: a charge? | **No charge; it was never confirmed** |
| D27-70 | How much a cancel takes | **Every waiting room of the booking**, as Confirm does |
| D27-71 | A reason | **A short reason is required and kept on the booking**, with the clerk's name |
| D27-72 | Form III: the guest's photo (the Form III session) | **Taken on the portal, not kept in the PMS** (the lawyer's view on keeping a copy is still asked, with D21-11) |
| D27-73 | Form III: signatures | **The guest signs a printed card on arrival and on departure** (Rule 17(7)(b): a thumb impression counts) |
| D27-74 | Form III: next destination | **Asked at check-out** |
| D27-75 | Form III: companions | **A warning on the register, and one portal number per person** (a companion's own details not built) |
| D27-76 | Form III: walk-ins | **Asked what check-in asks** |
| D27-77 | Form III: which fields | **Every portal field is recorded; the law's fields are required at check-in** (visa or OCI number and type, phone in India, arrived from, purpose, previous place of stay); the rest can be completed later |
| D27-78 | Form III: names on screen | **"Form III" and "Form III register"** |
| D27-79 | Form III: departure | **A departure also needs a portal number** (the same one if the portal gives no new one) |
| D27-80 | Form III: the owner's reference screen | **Add the portal's other three numbers** (mobile in India, phone and mobile outside India); **no** guardian name, age, or next destination split into place, state and city; one full name |
| D27-81 | The redesign, the owner's one review (D27-66) | **Approved as a whole: "Approve, take all 21"** |
| D27-82 | The helpers' 21 recommendations, all taken | (1) long section notes behind an (i), same words; the guest page's instructions and "why a button is missing" notes stay on the page; (2) Properties' "Stay view" becomes "Calendar"; (3) Rate calendar's Inventory/Rates tabs and Approvals' tabs become a segmented switch in the title row; (4) cancelled and no-show red everywhere; (5) one group uses the lists' status words; (6) the Approvals pill says "Approved" / "Refused"; (7) dates in the short form (one group, Cashiering); (8) a long dash on one purchase becomes "-"; (9) All bookings keeps one search box; (10) fix Groups' room type, which never shows; (11) Terminal: "Send to the kitchen" the one orange button, "Charge to a room" outlined; (12) every browser tab shows its screen's name (Charges to rooms' second heading, Invoices' "Issued", the invoice and VAT bill); (13) Rate plans' "0.00" placeholder becomes "-"; (14) a group's money owed turns orange and a purchase's unpriced-line note is a yellow tile while there is something to do; (15) drop Rate plans' current-season wash, Rate performance gets the grey weekend wash; (16) Tables tiles get arrows; (17) Spa "Charge to room" stays the dialog's primary; (18) kitchen wait times in the readable shades; (19) keep the 80mm restaurant bill, New booking's larger boxes, report names in capitals on print, diaries as rows; (20) the laundry docket gets a Print button and a document header (logo and group from the group setting); (21) store categories get a count pill |
