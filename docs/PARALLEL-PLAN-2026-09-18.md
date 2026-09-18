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
| 🔨 | **laundry** | built, committed in its copy | push, Action green, hand back |
| 🔨 | **spa** | built, committed in its copy | push, Action green, hand back |
| 🔨 | **revenue-management** | built, committed in its copy | push, Action green, hand back |
| ▶ | **accounting** (Tally export) | **starts now** — purchasing's slot | brief written, copy ready |
| ⏸ | **online-checkin** (the guest's page) | waits on the master's next rooms on the guest door | brief when the slot opens |
| ⏸ | **guest-messaging** | waits on the master's sender | brief when the slot opens |
| ⏸ | **reputation** (reviews) | waits on the sender **and** the owner's review link | brief when the slot opens |
| ⏸ | **marketing** | waits on the sender | brief when the slot opens |

**Not in a wave.** The **channel manager's** last part — turning a pushed
booking into a real one — goes back to its own chat the day SU's keys arrive,
on the booking door the master already built (`createChannelBooking`, migration
111). **Bills and vouchers in the group's layout** wait on the owner saving CRS
voucher FH-2026-00002 (D17-63). **The booking engine stays parked** (D18-1).

### The master's own lane, in order

**Three chats stopped where they were supposed to stop** — at a file that is
not theirs — and wrote down what they need. Those asks come first, because each
one is holding up work that is otherwise finished.

1. **Two menu sections and two permission resources** — `laundry` and `spa`, in
   `src/components/app/navigation.ts` (`SectionKey`, `SECTION_LAYOUT`, gated
   `module:`) and `src/lib/permissions.ts` (`RESOURCES`, `RESOURCE_LABELS`,
   the grants). **Both services are built on the server and have no screens at
   all** without this. `SectionKey` is a typed union, so a nav entry naming a
   section that does not exist does not compile; and `module:` sits on the
   **section**, so it is the only place a screen can be hidden at a property
   where the switch is off. D18-8 already answers who may use them.
   *One change unblocks two chats.*
2. **A front door on finance for posting a charge to a room bill** (D18-7).
   `api/src/modules/finance/index.ts` exports no in-process function today, and
   neither laundry nor spa may write `folio_postings` themselves. The posting
   already exists as an HTTP route in `finance/postings.ts` — the door is that
   route's body lifted into one exported function, so there is still one
   insert, not two.
3. **Widen the reports front door** (revenue management's R1): `dailyFigures`,
   `sumDays`, `firstTradingDay`, `propertyFor`, `isoDateParam`, the `NIGHTS`
   fragment and the `DayFigures` / `Property` types. Without them that service
   cannot build **pickup** or the week-ago column of **pace**, and it correctly
   built neither rather than counting room-nights its own way. Plus R2: two
   one-line deletions in shared test files that this service's existence makes
   wrong.
4. **The shared PMS → n8n sender** (D17-87, D17-91) — JSON and the PDF, signed
   with a secret that lives only in the server's settings, proved against a
   fake receiver before n8n is connected. **Guest messages, reviews and
   marketing all send through it and through nothing else.** *Three wave-2
   chats are blocked until this exists.*
5. **The guest's door, next rooms** — saving the check-in details and the ID
   photo, showing the bill once the code is answered, carrying a spa or laundry
   request. Each one a function that takes the link's hash and answers about
   one booking (migration 114). **No chat adds to that door.**
6. **Merging** — one service at a time, the Action green before each,
   migrations renumbered per the ledger.
7. **Everything shared**: `server.ts`, `mount.ts`, `permissions.ts`,
   `navigation.ts`, `components/ui/`, the migrations' numbering.

### How a slot frees

**A wave-2 chat starts when a wave-1 chat has merged** — never more than four
running, because four stacked test runs exhausted this laptop's process slots
on 18 September. The order they free decides the order wave 2 starts, top of
the list first. **A chat is not finished when it commits; it is finished when
its Action is green and the master has merged it.**

---

## 2 · The five rules that let four chats share one repository

**1 · Your folder is your lane, and a push refuses by itself.**
`src/modules/<service>/`, `api/src/modules/<service>/`,
`db/tests/modules/<service>.sql`. The pre-push hook runs `npm run lane` and
refuses a push that touches anything else. `git push --no-verify` is for a
change **the owner has cleared and the master is reviewing** — say so when you
use it.

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

#### The migration ledger

| Number | Whose | State |
|---|---|---|
| 113 | master — a time belongs to its property | **in cp6** |
| 114 | master — the guest's own door | **in cp6** |
| 115 | master — laundry and spa are modules | **in cp6** |
| 116 | purchasing | **in cp6** (written as 115, renumbered at merge) |
| **117** | **laundry** | written as 116 — **rename to 117 at merge** |
| **118** | **spa** | written as 116 — **rename to 118 at merge** |
| **119** | reserved: master — the sender's record of what was sent | not written |
| **120** | reserved: accounting | probably not needed; the Tally export reads |
| **121–124** | reserved: online-checkin, guest-messaging, reputation, marketing | one each, not written |

Renumbering a file means renaming it **and** changing every sentence inside the
service that names the old number. Purchasing named its own number in six
places.

**5 · One full suite at a time on this machine.** Run **your own** tests
locally — `npx vitest run src/modules/<service>`, `npm test -- modules/<service>`
— and let **the Action** run the whole thing on every push. The Action is the
proof; your machine is for finding out fast.

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
3. Commit on your branch and **push** — the Action runs on it.
4. **Wait for the Action.** A push is not finished until it is green
   (MEMORY 300). Red on the lane check alone is expected when the master
   cleared a file outside your folder — say which files and why.
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
You are the accounting chat — the Tally export. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/accounting.md — that last one is your brief. Claim the lane with: npm run claim -- accounting "what you are doing". Every figure in the file is the figure the reports already print, read through the reports service's front door — never a fresh query of your own. Build the smallest thing that works end to end, in the brief's order. Ask the owner — through the master — before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**laundry** — `D:\fidato-laundry`
```
You are the laundry chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/laundry.md — that last one is your brief. Claim the lane with: npm run claim -- laundry "what you are doing". Build the smallest thing that works end to end, in the brief's order. Ask the master (the repo's main chat) for a migration number before writing one, and ask the owner — through the master — before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**spa** — `D:\fidato-spa`
```
You are the spa chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/spa.md — that last one is your brief. Claim the lane with: npm run claim -- spa "what you are doing". Build the smallest thing that works end to end, in the brief's order. Ask the master (the repo's main chat) for a migration number before writing one, and ask the owner — through the master — before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
```

**revenue-management** — `D:\fidato-revenue-management`
```
You are the revenue management chat. Read CLAUDE.md, then docs/briefs/README.md, then docs/PARALLEL-PLAN-2026-09-18.md, then docs/briefs/revenue-management.md — that last one is your brief. Claim the lane with: npm run claim -- revenue-management "what you are doing". This service shows and suggests and NEVER changes a price — prove that with a test. Read every figure through the reports service's front door; do not define occupancy a second time. Ask the owner — through the master — before deciding anything not already answered. When you commit, report the head commit, your gate numbers, and which guards you saw fail.
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

### Four answers, asked 18 September

Each one widens what a person can do, so none of them is the master's to make.

1. **May housekeeping and the front desk raise a purchase request?** Today
   neither holds any purchasing grant at all, so D18-2's per-property setting
   can name them and the screen still refuses them.
2. **One Approvals screen, or keep deciding inside each service's own screen?**
   The engine is one (migration 076) and both equipment and purchasing decide
   through it, correctly. But there is no screen that lists everything waiting
   on a GM, and the build plan said there was.
3. **Does a WhatsApp or email message carry the PMS's own PDF, or the data
   alone?** Recommended: attach it — a guest whose company pays needs the
   document, not a summary.
4. **The spa's two answers.** The spa chat reports the owner answered, on 18
   September, that a treatment bills under the spa's **own** GST rule per
   property, and that **reception books and closes while housekeeping only
   sees** the diary. Neither came through the master, and finance's own code
   says the opposite about tax — that laundry and the like follow the **room**
   rule. Confirm both before that service merges.

---

## 7 · How each service is judged done

The same bar as everything else, and no lower:

- Every gate green **in GitHub**, on Linux, not only on somebody's laptop.
- Every guard **seen to fail** with its fault put back.
- **The screen opened** before anybody says it works, at 375 pixels as well.
- No default prices, no invented figures: a thing nobody has priced shows "-".
- The service's own `CHANGELOG.md`, `DEFECTS.md` and `MODULE.md` up to date,
  and the lane clean.
