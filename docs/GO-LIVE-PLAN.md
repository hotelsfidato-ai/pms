# Going live — the plan

**21 September 2026. Every line here comes from the owner's answers**
(`docs/briefs/decisions-2026-09-21.md`, D21-1 to D21-76) or from a read-only
look at the live server the owner allowed the same day. Nothing is deployed
until the owner says yes on the day, and the owner types every command (D21-50).

---

## Where live stands today (read-only check, 21 September)

```
server          130.210.49.220, branch main at 79e358e (18 Sep), API healthy
disk            48% of 30 GB
backups         every night at 03:00 (database) and 03:30 (n8n), last one this morning
hotels on live  ONE — 5 Elements Akkalkot. 18 rooms (correct, D21-64)
its data        5 bookings, 6 restaurant orders: ALL TESTS (D21-52), cleared before day one
logins on live  two: the owner, and the shared demo@ login — the only one at 5 Elements
tax at 5EL      room 5% below ₹7,500, 18% from ₹7,500; restaurant 5% — accountant to confirm (D21-65)
switched on     banquet (correct, D21-66), reception can use the POS
not on live     sending (N8N_SEND_URL / N8N_SEND_SECRET unset), a provisioning key,
                the other six hotels, migrations 114 to 120
```

**Nobody uses live for real yet.** So "go-live" means two different things,
and this plan keeps them apart:

- **Deploying** — putting the new code on the server. No guest or clerk is
  affected, so it happens in the daytime when the owner is free for about an
  hour (D21-58).
- **The first real day** — 5 Elements' first real guest. It comes **after**
  every stage is deployed and a real receptionist has run a booking from
  booking to check-out alone, on live (D21-57).

---

## How the code gets to the server (D21-49)

The server pulls its code from GitHub. **On a deploy day only**, the release
is pushed to GitHub; the rule "nothing leaves this machine" lifts for that
push and nothing else, and returns straight after. Each deploy follows the
runbook shape in `HANDOVER.md` § 9: **a backup first**, then pull, then
`deploy/launch.sh` (which runs the migrations as one transaction — a failure
leaves the database as it was, and the old API keeps running), then the
website from the owner's PC, then **look at it**. The website can be rolled
back instantly in Firebase; the server's migrations cannot be undone, which
is why the backup comes first.

---

## The three stages, a few days apart (D21-55)

### Stage 1 — the menu's sizes and add-ons (D21-44, confirmed again as D21-56)

- **Built by:** the POS chat, on a copy made from `79e358e` — what is live — so
  it carries nothing else (`docs/briefs/pos.md`).
- **Deploy:** that branch merged onto `main`, pushed, pulled. No migration.
- **Then:** the owner imports 5 Elements' real menu on live (D21-43).
- **Waits on:** the POS chat finishing. Nothing else.

### Stage 2 — everything staff use

- **What:** everything on `cp6` — purchasing, accounting's day book,
  reviews, revenue management, the laundry and spa services (**switched off at
  5 Elements**, which has neither — D21-63), the banquet date fix — plus the
  CRM chat's returning-guest matching, the blacklist warning and "stayed
  before", and the check-in chat's work. Migrations 114 to 120 and theirs.
- **Waits on:** online check-in AND the CRM being built (D21-24).
- **The guest-facing parts arrive in this deploy but stay dark:** with the two
  sending settings unset nothing can be sent, no guest is sent a link, and no
  room card is printed. Stage 3 is switching them on, not a second code
  deploy (D21-76).

### Stage 3 — what guests see

- **What:** the two sending settings set on the server, n8n's WhatsApp token
  renewed (D21-31), the first real WhatsApp sent to the owner's own phone
  (D21-29), room cards printed and placed (D21-62), then confirmations begin —
  every future booking, spread out, soonest arrival first (D21-33, D21-34).
- **Only to guests who agreed:** WhatsApp goes to a booking ticked "guest
  agreed to WhatsApp" (D21-72, the CRM chat builds the tick); an unticked
  booking gets email if it has one. English only (D21-73).
- **Waits on:** Meta approving the four WhatsApp templates (D21-59,
  `docs/go-live/whatsapp-templates.md`), the privacy notice approved by the
  owner's advisor (D21-61), the sending pace from the owner (D21-34).

---

## Before 5 Elements' first real day — the checklist

**The owner**
- [ ] The four WhatsApp templates submitted to Meta, and approved
- [ ] The privacy notice checked by the advisor (the master drafts it)
- [ ] The ID-photo rule and the advisor's word on full Aadhaar (D21-11,
      D21-17) — without the first, the photo upload is simply not there
- [ ] The accountant confirms 5 Elements' GST rates (D21-65) — **and sets
      banquet's, which live does not have: banquet is on there, so its first
      bill would be refused**
- [ ] Real room rates in the rate calendar (D21-38)
- [ ] The real menu imported (D21-43)
- [ ] The GM's login made by the owner; the GM makes every staff login on
      People, each with their real role (D21-53, D21-67)
- [ ] Banquet's real halls and packages (D21-66)
- [ ] 5 Elements' own Google review link (D21-30)
- [ ] The WhatsApp sending pace (D21-34)

**The master**
- [ ] The WhatsApp template wording — **done 21 September**,
      `docs/go-live/whatsapp-templates.md`
- [ ] The privacy notice draft (D21-61)
- [ ] One-page sheets per role for 5 Elements' staff (D21-71), checked against
      the receptionist test
- [ ] The 18 rooms listed from live for the owner's final yes (D21-64)
- [ ] The test data cleared from live — a backup first, the owner's yes on the
      day (D21-52)
- [ ] demo@ switched off (never deleted) once the real logins work (D21-53)
- [ ] Finance's one definition of a bill, for the guest page

**Then, in order**
1. Stage 3 switched on.
2. **The receptionist test on live** (D21-57): somebody new, alone, books a
   guest, checks them in, takes a payment and checks them out. What they stick
   on is fixed first.
3. **The owner picks the first real day.**
4. For two weeks after it, a read-only look at the server each day the owner
   opens a chat: errors, failed messages, the last backup, disk (D21-70).

---

## After 5 Elements — one hotel at a time (D21-54)

For each hotel, when its GM is ready:

1. **Once only:** the owner makes a provisioning key on the server, the master
   guiding — none exists on live, and without one no hotel can be created.
2. The hotel is created, with its GM's login.
3. The GM sets it up on the screens that exist (D21-47), from the master's
   one-page guide: rooms, rates, tax rules, menu, its Google review link,
   whether it has a spa, laundry, banquet.
4. The owner checks it, and it opens.

One hotel's problem never reaches another's.

---

## What is NOT in this plan

- **The channel manager** — on hold (D21-32).
- **A backup of this laptop's work** — the owner chose none (D21-23). Note
  that from stage 1, what is pushed to GitHub is itself an off-site copy.
- **The ID photo**, until D21-11 is answered.
