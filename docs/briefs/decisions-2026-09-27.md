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
