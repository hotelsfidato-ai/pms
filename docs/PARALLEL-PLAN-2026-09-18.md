# Running the chats side by side — 18 September 2026

**What is being built** is `docs/BUILD-PLAN-2026-09-18.md`. **This** is how
several chats build it at the same time without undoing each other. The owner's
two answers behind it: **four at a time, in two waves**; and the three services
that send WhatsApp and email are **built now and switched on later**, on one
shared sender.

---

## The two waves

| Wave | Chat | Its folder | Waits on | Migration |
|---|---|---|---|---|
| **1** | **purchasing** *(running, mid-build)* | `purchasing` | nothing | its 115 becomes **116** at merge |
| **1** | **laundry** | `laundry` | nothing — the switch is made (115) | asks the master |
| **1** | **spa** | `spa` | nothing — the switch is made (115) | asks the master |
| **1** | **revenue-management** | `revenue-management` | nothing | should need none |
| **2** | **accounting** (the Tally export) | `accounting` | nothing | should need none |
| **2** | **online-checkin** (the guest's page) | `online-checkin` | the master's door — built (114) | asks the master |
| **2** | **guest-messaging** | `guest-messaging` | the master's sender | asks the master |
| **2** | **reputation** (reviews) | `reputation` | the master's sender | asks the master |
| **2** | **marketing** | `marketing` | the master's sender | should need none |

**A wave-2 chat starts when a wave-1 chat has merged** — never more than four
running. The order they free up decides the order wave 2 starts, top of the list
first.

**Not in a wave:** the **channel manager's** last part (turning a pushed booking
into a real one) goes back to its own chat when SU's keys arrive, on the booking
door the master built (`createChannelBooking`, migration 111). **Bills and
vouchers on the group's template** wait on the owner saving CRS voucher
FH-2026-00002 (D17-63).

---

## What the master does while they run

1. **The shared sender** — the PMS → n8n door (D17-87, D17-91): JSON and the
   PDF, signed with a secret that lives only in the server's settings, tested
   against a fake receiver so it is proved before n8n is connected. **Guest
   messages, reviews and marketing all send through it and through nothing
   else.** Built before wave 2 starts.
2. **The guest's door, next rooms** — saving the check-in details and the ID
   photo, showing the bill once the code is answered, and carrying a spa or
   laundry request. Every one is a function that takes the link's hash and
   answers about one booking (migration 114). **No chat adds to that door.**
3. **Merging** — one service at a time, the Action green before each, and
   renumbering migrations at merge.
4. **Everything shared**: `server.ts`, `mount.ts`, `permissions.ts`,
   `navigation.ts`, `components/ui/`, the migrations' numbering.

---

## The five rules that let four chats share one repository

**1 · Your folder is your lane, and a push refuses by itself.**
`src/modules/<service>/`, `api/src/modules/<service>/`,
`db/tests/modules/<service>.sql`. The pre-push hook runs `npm run lane` and
refuses a push that touches anything else. `git push --no-verify` is for a
change **the owner has cleared and the master is reviewing** — say so when you
use it.

**2 · Another service is reached through its front door, never its files.**
`src/modules/<x>/index.ts` and `api/src/modules/<x>/index.ts`. If the door does
not export what you need, **tell the master what and why**. Do not edit it, and
do not write its tables. *(A charge reaches a bill through a door. Stock arrives
in a store through a door. A figure on a report comes through a door.)*

**3 · Your server door already exists.** The master made and mounted an empty
front door for every service on 18 September. Add your routers to **your**
`index.ts`. **Nobody edits `server.ts`.**

**4 · Migrations: ask for your number.** Take none yourself. The master gives
you the next one and renumbers at merge if two chats land together. **And read
MEMORY 284, 293 and 299 before you write one**: every deploy replays every
migration from 001, so a constraint you rewrite must be guarded by what it adds,
and a constraint another file already defines is not yours to rewrite at all.

**5 · One full suite at a time on this machine.** Four chats share one laptop,
and stacked test runs exhausted its process slots on 18 September. Run **your
own** tests locally — `npx vitest run src/modules/<service>`,
`npm test -- modules/<service>` — and let **the Action** run the whole thing on
every push. The Action is the proof; your machine is for finding out fast.

---

## What a chat may not decide

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

---

## How a chat hands back

1. Your service's `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`.
2. `npm run lane -- <service>`, and `npm run release -- <service>`.
3. Commit on your branch and **push** — the Action runs on it.
4. **Tell the master**: the head commit, your gate numbers as you ran them, and
   **which guards you saw fail with the fault put back.**
5. **You do not merge, and you do not deploy.**

---

## Starting a chat

Open a new chat **in that service's own copy** (`D:\fidato-<service>`) and
paste the line for it. Each copy is made by the master from the current `cp6`,
with its dependencies linked, before you open it.

### Wave 1

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

### Wave 2

Their briefs are written when their slot opens, because three of them stand on
the master's sender and one on the guest's door, and a brief written before
those exist would describe them wrongly.
