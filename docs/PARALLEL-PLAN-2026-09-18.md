# The run sheet — several chats, one repository

**What is being built** is `docs/BUILD-PLAN-2026-09-18.md`. **This** is who
builds it, in what order, and how they avoid undoing each other. The owner's
answers behind it: **four chats at a time, in two waves**; and the three
services that send WhatsApp and email are **built now and switched on later**,
on one shared sender.

**This file is kept current.** § 1 is the board as it stands; everything under
it is the rules, which do not move.

---

## 1 · Where it stands — 18 September, evening

**Thirteen services run the hotel and are live.** Purchasing is now fourteen.

| | Chat | State | What is left on it |
|---|---|---|---|
| ✅ | **purchasing** | **merged into cp6** | nothing — it goes out with the next deploy |
| 🔨 | **laundry** | server done, **no screens yet** | **take `cp6`'s new commits** — the section and the resource it stopped at are in — then the screens, gates here, hand back. **No push.** Migration → **118** |
| 🔨 | **spa** | server done, **no screens yet** | **take `cp6`'s new commits** — same two files, plus `postCharge` for D18-7 and "settle at the spa" — then the screens, gates here, hand back. **No push.** Migration → **119** |
| 🔨 | **revenue-management** | screen done, **no pickup, no week-ago pace** | **take `cp6`'s new commits** — the reports door now exports the eight names R1 asked for — then build both, gates here, hand back. **No push.** |

> **All three take cp6's new commits first.** Each stopped at a file that was
> not theirs and said so, which is the agreement working; what they asked for is
> in `cp6` as of 18 September. **Nothing is fetched from GitHub and nothing is
> pushed to it** (the owner's rule, 19 September) — the master rebases each
> copy onto the local `cp6` from the main checkout, or the chat runs
> `git rebase cp6` in its own copy, which reads the same local repository.
| ▶ | **accounting** (Tally export) | **starts now** — purchasing's slot | brief written, copy ready |
| ⏸ | **online-checkin** (the guest's page) | waits on the master's next rooms on the guest door | brief when the slot opens |
| ⏸ | **guest-messaging** | **sender built** — waits only for a slot | brief when the slot opens |
| ⏸ | **reputation** (reviews) | **sender built** — waits for a slot **and** the owner's review link | brief when the slot opens |
| ⏸ | **marketing** | **sender built** — waits only for a slot | brief when the slot opens |

**Not in a wave.** The **channel manager's** last part — turning a pushed
booking into a real one — goes back to its own chat the day SU's keys arrive,
on the booking door the master already built (`createChannelBooking`, migration
111). **Bills and vouchers in the group's layout** wait on the owner saving CRS
voucher FH-2026-00002 (D17-63). **The booking engine stays parked** (D18-1).

### The master's own lane, in order

**Three chats stopped where they were supposed to stop** — at a file that is
not theirs — and wrote down what they need. Those asks came first, because each
was holding up work that is otherwise finished. **All three are done.**

1. ✅ **Two menu sections and two permission resources** — `laundry` and `spa`,
   in `src/components/app/navigation.ts` (`SectionKey`, `SECTION_LAYOUT`, gated
   `module:`) and `src/lib/permissions.ts` (`RESOURCES`, `RESOURCE_LABELS`,
   the grants). Both services were built on the server with **no screens at
   all** without this: `SectionKey` is a typed union, so an entry naming a
   section that does not exist does not compile, and `module:` sits on the
   **section**, which is the only place a whole service hides at a property
   that has not switched it on. Granted per **D18-8** — reception and
   housekeeping — with **D18-21**'s refinement: on the spa, housekeeping
   **sees** the diary and does not book or close it.
2. ✅ **`postCharge`, the door a charge reaches a room bill through** (D18-7),
   exported from `api/src/modules/finance/index.ts`. The HTTP route's body
   moved into it and the route now calls it, so there is still **one** insert
   into `folio_postings` for a charge and the checks in front of it run for a
   service exactly as they run for the desk. `taxKind` names which tax rule the
   charge follows — `"room"` unless the service has its own, and the **spa
   does** (D18-21). It asks `app.gst_rate_or_null` **before** posting, because
   `app.gst_rate` raises where a property has set no rule and a raise aborts
   the transaction; the refusal names Settings → Tax instead.
   `api/test/modules/finance/chargeDoor.test.ts` — 7 tests, and the last one
   seen to fail with the guard taken out.
3. ✅ **The reports front door is widened** (R1): `dailyFigures`, `sumDays`,
   `firstTradingDay`, `propertyFor`, `propertyById`, `isoDateParam`, `heading`,
   the `NIGHTS` fragment and the `DayFigures` / `Property` / `StayNight` types.
   Revenue management can now build **pickup** and the week-ago column of
   **pace**, both of which it correctly refused to build rather than count
   room-nights its own way.
   **R2 is a merge-time step, not this one:** dropping `"Revenue management"`
   from `SOON` and `"listDailyStatistics"` from `KNOWN_UNREACHABLE` is only
   true once that branch is in, and doing it early turns both tests red.
   It goes in the merge commit.
4. ✅ **The shared PMS → n8n sender** — `api/src/sending.ts`, migration **117**.
   JSON and **the PDF** (D18-20: the exact A4 the desk prints, base64 inside
   the same POST — a link would have meant a public address for a private
   document and a token to expire, a second guest door built for a machine
   already on this server). Signed with `x-fidato-secret`, which lives only in
   the server's settings. **Guest messages, reviews and marketing all send
   through it and through nothing else** — no wave-2 chat calls n8n itself.
   `api/test/sending.test.ts` runs a **real HTTP server shaped like the
   workflow**, checks the secret header as step 5's node will, and decodes the
   PDF back out; the not-connected guard was taken out and seen to fail.
   **It is not switched on**: until the owner's n8n steps are done, `canSend()`
   is false, every screen says so, and **no row is written** — a record of what
   was never attempted is a log of the system's own unfinished state.
   *Wave 2 is no longer blocked on the master.*
5. **One Approvals screen** (**D18-19**, asked and answered 18 September). The
   engine is one and every service decides through it — but inside its own
   screen, so a GM cannot see everything waiting on them. One inbox, decided in
   place; the service screens keep their own buttons. **The master's**, because
   it spans every service.
6. **The guest's door, next rooms** — saving the check-in details and the ID
   photo, showing the bill once the code is answered, carrying a spa or laundry
   request. Each one a function that takes the link's hash and answers about
   one booking (migration 114). **No chat adds to that door.**
7. **Merging** — one service at a time, **a full local gate run green before
   each**, migrations renumbered per the ledger. (This said "the Action green"
   until 19 September; there are no Actions now.)
8. **Everything shared**: `server.ts`, `mount.ts`, `permissions.ts`,
   `navigation.ts`, `components/ui/`, the migrations' numbering.

### How a slot frees

**A wave-2 chat starts when a wave-1 chat has merged** — never more than four
running, because four stacked test runs exhausted this laptop's process slots
on 18 September. The order they free decides the order wave 2 starts, top of
the list first. **A chat is not finished when it commits; it is finished when
the master has run the gates on the merge, here, and merged it.**

---

## 2 · The five rules that let four chats share one repository

**1 · Your folder is your lane, and you check it yourself now.**
`src/modules/<service>/`, `api/src/modules/<service>/`,
`db/tests/modules/<service>.sql`. The pre-push hook runs `npm run lane` and
refuses a push that touches anything else.

⚠ **Since 19 September there are no pushes at all** — the owner's rule: nothing
leaves this machine. The hook is therefore not the thing keeping you in your
lane any more; **run `npm run lane -- <service>` yourself before every commit**,
and tell the master about any file outside your folder rather than committing
it quietly.

**2 · Another service is reached through its front door, never its files.**
`src/modules/<x>/index.ts` and `api/src/modules/<x>/index.ts`. If the door does
not export what you need, **tell the master what and why**. Do not edit it, and
do not write its tables. *(A charge reaches a bill through a door. Stock
arrives in a store through a door. A figure on a report comes through a door.)*

**3 · Your server door already exists.** The master made and mounted an empty
front door for every service on 18 September. Add your routers to **your**
`index.ts`. **Nobody edits `server.ts`.**

**4 · Migrations: your number is in the ledger below. Take no other.** The
master reserves it before the lane is handed out — "ask me when you need one"
failed on 18 September, when three chats each took 116 because nobody had given
them anything (MEMORY 301). **And read MEMORY 284, 293, 299 and 300 before you
write one**: every deploy replays every migration from 001, so a constraint you
rewrite must be guarded by what it adds, and a constraint another file already
defines is not yours to rewrite at all.

#### The migration ledger — a queue, not a reservation

⚠ **A NUMBER CANNOT BE HELD OPEN.** `src/test/migrationNumbers.test.ts` refuses
any gap in the sequence: 001 upwards, once each. I tried to reserve 117 and 118
for laundry and spa and take 119 for the sender, and the gate refused it inside
a minute (MEMORY 302). There is no way to book a number ahead, so this is a
**queue**, and the number is settled **at merge**, in merge order.

**What is in `cp6` now**

| | Whose |
|---|---|
| 113 | master — a time belongs to its property |
| 114 | master — the guest's own door |
| 115 | master — laundry and spa are modules |
| 116 | purchasing *(written as 115, renumbered at merge)* |
| 117 | master — what was sent, and whether it arrived *(written as 119; the gate refused the gap)* |

**The queue, in the order they merge**

| Next free | Whose | Written as |
|---|---|---|
| **118** | whichever of laundry / spa merges first | both wrote 116 |
| **119** | the other of the two | |
| 120… | accounting (probably needs none), then wave 2, one each | |

**Write the next free number you can see and say so in your commit**, as all
three chats correctly did. The master renumbers at merge. Renumbering means
renaming the file **and** changing every sentence inside the service that names
the old number — purchasing named its own in six places.

**5 · One full suite at a time on this machine, and it is the only proof
there is.** Run your service's own tests while you work — `npx vitest run
src/modules/<service>`, `npm test -- modules/<service>` — and the FULL suite
before you hand back. Until 19 September the Action ran the whole thing on
every push and was the proof; the owner has stopped all pushes, so there is no
second opinion and no Linux run. **Two full suites at once exhausted this
laptop's process slots on 18 September** — check with the master before
starting one.

---

## 3 · What a chat may not decide

**Nothing the owner has not answered.** The decisions are
`docs/briefs/decisions-2026-09-17.md` and `decisions-2026-09-18.md`. Anything
else — a word on a screen that changes what a person does, a price, who may do
something, what happens to money — goes to the owner **through the master**,
with a recommendation. Silence is not approval.

**No default prices, anywhere.** A thing nobody has priced shows "-", never 0.

**A time belongs to the property.** Write through `app.hotel_moment`, read
through `app.hotel_clock` (migration 113). The hotel's server runs in GMT, and
the API suite runs in UTC so a bare timestamp fails on your machine rather than
in Akkalkot.

**Who may see a screen is the owner's.** `src/lib/permissions.ts` is the
master's file and a grant on it widens who can open something. Ask.

---

## 4 · How a chat hands back

1. Your service's `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`.
2. `npm run lane -- <service>`, and `npm run release -- <service>`.
3. **Commit on your branch. DO NOT PUSH.** The owner's rule of 19 September:
   nothing leaves this machine — no push, no Action, no deploy. Your branch
   stays local and the master merges it locally.
4. **Run the gates HERE and quote what you actually saw.** The Action used to
   be the proof and cannot be now, so your own run is the whole of the bar.
   **One full suite at a time on this laptop.**
5. **Tell the master**: the head commit, your gate numbers as you ran them, and
   **which guards you saw fail with the fault put back.**
6. **You do not merge, and you do not deploy.**

---

## 5 · Starting a chat

Open a new chat **in that service's own copy** (`D:\fidato-<service>`) and
paste its line. Each copy is made by the master from the current `cp6`, with
its dependencies linked, before the chat is opened.

### Running now

**accounting** — `D:\fidato-accounting`
```
You are the accounting chat — the Tally export. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/accounting.md — that last one is your brief. Claim the lane with: npm run claim -- accounting "what you are doing". Every figure in the file is the figure the reports already print, read through the reports service's front door — never a fresh query of your own. Build the smallest thing that works end to end, in the brief's order. Ask the owner — through the master — before deciding anything not already answered. DO NOT PUSH — the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**laundry** — `D:\fidato-laundry`
```
You are the laundry chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/laundry.md — that last one is your brief. Claim the lane with: npm run claim -- laundry "what you are doing". Build the smallest thing that works end to end, in the brief's order. Ask the master (the repo's main chat) for a migration number before writing one, and ask the owner — through the master — before deciding anything not already answered. DO NOT PUSH — the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**spa** — `D:\fidato-spa`
```
You are the spa chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/spa.md — that last one is your brief. Claim the lane with: npm run claim -- spa "what you are doing". Build the smallest thing that works end to end, in the brief's order. Ask the master (the repo's main chat) for a migration number before writing one, and ask the owner — through the master — before deciding anything not already answered. DO NOT PUSH — the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**revenue-management** — `D:\fidato-revenue-management`
```
You are the revenue management chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/revenue-management.md — that last one is your brief. Claim the lane with: npm run claim -- revenue-management "what you are doing". This service shows and suggests and NEVER changes a price — prove that with a test. Read every figure through the reports service's front door; do not define occupancy a second time. Ask the owner — through the master — before deciding anything not already answered. DO NOT PUSH — the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

### Running now — one chat each, in its own copy

**the guest's page** — `D:\fidato-guest-page`

```
You are the the guest's page chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/guest-page.md - that last one is your brief. Claim the lane with: npm run claim -- online-checkin "what you are doing". This is the ONLY door opened by somebody the hotel does not employ, and behind it is a guest's name, their passport and what they owe: read the header of api/src/routes/guestDoor.ts before your first edit, and prove with a test that every new thing you expose is refused before the code is answered. DO NOT PUSH - the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. Ask the master for a migration number before writing one, and ask the owner - through the master - before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**accounting - the Tally export** — `D:\fidato-accounting`

```
You are the accounting - the Tally export chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/accounting.md - that last one is your brief. Claim the lane with: npm run claim -- accounting "what you are doing". Every figure in the file is the figure the reports already print, read through the reports service's front door - never a fresh query of your own. DO NOT PUSH - the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. Ask the master for a migration number before writing one, and ask the owner - through the master - before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**guest messages** — `D:\fidato-guest-messaging`

```
You are the guest messages chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/guest-messaging.md - that last one is your brief. Claim the lane with: npm run claim -- guest-messaging "what you are doing". Everything sends through api/src/sending.ts and nothing else; ask canSend() before you offer a button, because it is false until the owner finishes their n8n steps. DO NOT PUSH - the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. Ask the master for a migration number before writing one, and ask the owner - through the master - before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**reviews** — `D:\fidato-reputation`

```
You are the reviews chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/reputation.md - that last one is your brief. Claim the lane with: npm run claim -- reputation "what you are doing". The group's review link does NOT exist yet: make it a setting per property, empty until somebody fills it, and refuse to send while it is empty. Never ship a placeholder that looks real. DO NOT PUSH - the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. Ask the master for a migration number before writing one, and ask the owner - through the master - before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**marketing** — `D:\fidato-marketing`

```
You are the marketing chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/marketing.md - that last one is your brief. Claim the lane with: npm run claim -- marketing "what you are doing". A guest who has asked not to be written to is never on a list that sends - if nothing records that yet, ask the master rather than inventing a column. DO NOT PUSH - the owner's rule of 19 September is that nothing leaves this machine: commit locally, run the gates locally, and the master merges locally. Ask the master for a migration number before writing one, and ask the owner - through the master - before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

### Waiting for a slot

**online-checkin**, **guest-messaging**, **reputation**, **marketing**. Their
briefs are written when their slot opens, because three of them stand on the
master's sender and one on the guest's door, and a brief written before those
exist would describe them wrongly.

---

## 6 · What the owner owes, and what stops without it

| What | Who is waiting | What happens until it arrives |
|---|---|---|
| **The n8n steps** (`docs/briefs/n8n-sending.md`) | guest-messaging, reputation, marketing, the QR code's six-digit code | they are **built** and the screens say plainly that nothing sends yet |
| **SU's keys + SU_PUSH_KEY** | the channel manager's last quarter | that chat stays closed |
| **The group's Google review link** | reputation | it can be built but never sends a real link |
| **CRS voucher FH-2026-00002** (`D:\reports fidato\`) | bills and vouchers in the group's layout (D17-63) | they print in the plain layout |
| **Five GitHub secrets** (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_EMAIL`, `FIREBASE_SERVICE_ACCOUNT`) | the deploy button | deploys stay by hand, from this chat, with the owner's yes |

### Four answers, asked and given on 18 September

All four are now **D18-18 … D18-21** in `docs/briefs/decisions-2026-09-18.md`.

| | Asked | Answered |
|---|---|---|
| **D18-18** | Housekeeping and the front desk hold no purchasing grant, so D18-2's setting can name them and the screen still refuses | **Leave it.** D18-2's setting only ever narrows the five roles that hold it, never widens — so nothing can be switched on that the screen then refuses |
| **D18-19** | There is no Approvals **screen**; each service decides inside its own | **Build one inbox.** The master's, spanning every service |
| **D18-20** | PDF on a WhatsApp or email message, or the figures alone | **Attach the PDF** — the A4 the desk prints |
| **D18-21** | The two answers the spa chat reported but which never came through the master | **Both stand** — the spa's own GST rule per property, and housekeeping **sees** the diary without booking or closing. Finance's own comment now agrees rather than contradicting |

---

## 7 · How each service is judged done

The same bar as everything else, and no lower:

- Every gate green **on this machine**, run by you, quoted as you saw them.
  (Until 19 September this said "green in GitHub, on Linux, not only on
  somebody's laptop" — the owner has stopped all pushes, so the laptop is now
  the only place a gate can run. That is a weaker bar and it is worth knowing
  it is weaker: the Action caught things a Windows laptop does not.)
- Every guard **seen to fail** with its fault put back.
- **The screen opened** before anybody says it works, at 375 pixels as well.
- No default prices, no invented figures: a thing nobody has priced shows "-".
- The service's own `CHANGELOG.md`, `DEFECTS.md` and `MODULE.md` up to date,
  and the lane clean.
