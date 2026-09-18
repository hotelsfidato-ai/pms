# The owner's decisions — 18 September 2026

The rule stands: **nothing here was decided by an agent.** Each line is the
owner's answer, in their terms, with the question it answers. Anything not on
this list, or on `decisions-2026-09-17.md`, is still open and is asked before it
is built.

---

## The order, and purchasing

| # | Question | Answer |
|---|---|---|
| D18-1 | In what order the seven remaining services are built | **Money first:** purchasing → laundry & spa → online check-in & guest messages → reviews → revenue management → Tally → marketing |
| D18-2 | Who may raise a purchase request | **A setting, per property**, so it can be changed at any time without a deploy. **Default: the Inventory Manager, the GM, the owner and an administrator**; department heads (kitchen, housekeeping) can be switched on when the owner wants |
| D18-3 | How a purchase order reaches the supplier | **A printed / PDF order**, sent by hand. Nothing waits on n8n |
| D18-4 | An amount above which the owner must approve | **No limit — the GM approves every purchase** (confirms D17-35) |

## Laundry and spa

| # | Question | Answer |
|---|---|---|
| D18-5 | What laundry covers | **Both the guest's laundry and the hotel's own linen**, in one place, with **every docket saying whose it is** — a guest's, or the hotel's |
| D18-6 | Spa | The guest can **book online, from their own page, or by telephone to the desk**; and can either **settle at the spa** or **have it charged to the room** |
| D18-7 | How a laundry or spa charge reaches the bill | **Straight onto the room bill** as its own charge line, as Extra Charges already reads them. Not through the restaurant till |
| D18-8 | Who runs those screens | **Reception and housekeeping.** No new staff roles |

## The guest's own page

| # | Question | Answer |
|---|---|---|
| D18-9 | Where a guest books the spa or checks in online | **One private page per booking.** No public page anybody can open — the booking engine stays parked (D17-53) |
| D18-10 | What online check-in captures, and the ways into it | **Details and a photo of the ID; the signature stays at the desk.** Three ways in: **(1)** the link in the booking confirmation, **(2)** **a QR code in the room** the guest scans, **(3)** the desk sending the link at check-in when the guest has not done it. Whichever way, the guest's details end up in the system rather than typed by a clerk |
| D18-11 | When the link is sent | **On confirmation, and again the day before arrival** |
| D18-12 | Which messages the system sends by itself | **The booking confirmation with the check-in link.** Bills stay a button somebody presses (D17-34, D17-91); a review request comes with the reviews service, if the owner wants it then |
| D18-13 | How the QR proves it is that guest | **A six-digit code to the phone on the booking, over WhatsApp** (through the group's own n8n). A stranger who scans the QR sees nothing |

## The business services

| # | Question | Answer |
|---|---|---|
| D18-14 | Reviews, first version | **Ask the guest after check-out and record who was asked**, with the group's own review link. Pulling reviews in from Google and the booking sites comes later, if it is wanted |
| D18-15 | Revenue management | **It shows and suggests; it never changes a price by itself.** Pickup and pace, which dates are soft, what to consider — the GM or the owner makes the change |
| D18-16 | The Tally export | **All three on the screen, as options:** Tally Prime XML, Tally ERP 9 XML, and a day-book CSV. Whoever exports picks what their accountant wants |
| D18-17 | Marketing, first version | **Guest lists that can be acted on** — stayed twice, not returned in a year, came from which site — with an export, and a send through n8n when an offer goes out |

## Asked the same evening, once purchasing was merged and the three chats had reported

| # | Question | Answer |
|---|---|---|
| D18-18 | Who may raise a purchase request **at all** — housekeeping and the front desk hold no purchasing permission today, so D18-2's setting can name them and the screen still refuses | **Leave it as it is.** The five roles that hold it today. D18-2's setting only ever narrows that list, never widens it — so nothing can be switched on that the screen then refuses |
| D18-19 | There is no Approvals **screen** — the engine is one, but each service decides inside its own screen and a GM cannot see everything waiting on them | **Build one Approvals screen.** One inbox, everything waiting on you, decided in place. The service screens keep their own buttons. *The master's, not a service chat's* |
| D18-20 | Whether a WhatsApp or email message carries the PMS's own **PDF**, or only the figures | **Attach the PDF** — the exact A4 document the desk prints. The sender fetches it and n8n forwards it |
| D18-21 | Confirming the two answers the **spa** chat reported but which never came through the master | **Both stand:** a treatment bills under the **spa's own GST rule per property**, and **reception books and closes while housekeeping only sees** the diary. *Finance's own comment says laundry and the like follow the ROOM rate; that comment is made to agree rather than contradict* |

---

## Still the owner's to give

Nothing below is a decision; they are things only the owner has.

- **SU's keys and the push key**, for the channel manager's last part.
- **The n8n steps** in `docs/briefs/n8n-sending.md` — until they are done, nothing
  sends: no confirmation, no code to a phone, no bill.
- **The group's Google review link**, for the reviews service.
- **CRS voucher FH-2026-00002** in `D:\reports fidato\`, for the bill and
  voucher template (D17-63).
