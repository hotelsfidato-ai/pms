# The guest's own page — the brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.

**Read `docs/briefs/README.md` first**, then this. Your decisions are
**D18-9, D18-10, D18-11, D18-12, D18-13** in `docs/briefs/decisions-2026-09-18.md`.
The plan is `docs/BUILD-PLAN-2026-09-18.md` § 3.

**You own** `api/src/routes/guestDoor.ts`, `src/modules/online-checkin/`, and
one migration the master will number for you.

---

## 21 September — the half behind the code. Read this first

**The owner has answered everything this needs.** The design is
`docs/architecture/online-checkin.md`; the answers are D21-6 to D21-19, D21-25
and D21-29 in `docs/briefs/decisions-2026-09-21.md`. Two went against the
master's recommendation and are the owner's: **one fixed QR card per room**, and
**a full Aadhaar number accepted**.

**Bring your copy up first.** In `D:\fidato-guests` (Git Bash): `git merge cp6`.
Since your last commit the master routed your page in `App.tsx` (it was
unreachable for two days — root MEMORY 310), made `src/lib/api.ts` read a
refusal's `message` (so your OCI-1 workaround can go), and answered your
"Waiting on the master" list in `MODULE.md`.

**Build in this order. Each step lands with a test that it is REFUSED before
the code, and one that it WORKS after (root MEMORY 308).**

0. **Your two open faults (D21-25).** "Send me the code" is offered when
   nothing can send — the page must ask first, and `GET /api/guest/:token` can
   say whether codes can be sent. And the rate-limited answer has a different
   shape from the normal one, so the page shows a blank line: one shape.
1. **The unlock is per phone, not per link (D21-6).** Today `verify` sets
   `guest_links.verified_at` and the link alone opens everything for its whole
   life. Make `verify` hand back a second secret — stored only as a hash,
   short-lived, held by the page for the open tab — and make every function
   behind the code take BOTH hashes. The proving test: answer the code, then
   call with the link alone, and be refused. **Nothing else is built before
   this.**
2. **The room card (D21-7, 14, 15, 16).** One fixed card per room. Its token
   (hash only, like every other) names a ROOM, and every call resolves the room
   to the stay checked in there at that moment — never a booking stored on the
   card. Before the code: the hotel and the room number only. Nobody checked
   in: "This opens once you're checked in", with the hotel's name. The code
   goes only to that stay's phone. The desk can reprint a room's card and the
   old one dies at once. Tests: the next guest's scan reaches nothing of the
   last guest's; a checked-out stay is not found; a reprinted card's old token
   is refused.
3. **The check-in details, as a submission (D21-8, D21-19).** ID type, ID
   number, address; for a foreign guest, passport and visa with their expiry
   dates. Nothing else. They wait until a clerk compares them with the ID and
   presses one button — only then are they written to `guest_documents`, under
   the clerk's name. `guest_documents` is ONE row per person, shared by the
   group, and Form C reads it live: that is why. **Aadhaar (D21-17, 18): the
   full number is stored; every screen shows the last four; only the printed
   registration card shows it whole.**
4. **The bill (D21-10)** — exactly the interim bill the desk prints, and "pay
   at the desk". **Do not write your own query over `folio_postings`.** Finance
   owns the one definition of a bill; ask the master for it (one function
   finance exposes, callable only by definer functions), and wrap it with the
   token check.
5. **Spa and laundry requests (D21-9)** — a small table of requests; the desk
   confirms them through the spa's and laundry's own screens. Never write to
   their tables.
6. **NOT the ID photo.** It waits on the owner's rule for how long it is kept
   (D21-11).

**The desk's side lives in YOUR folder:** replace the Coming soon page in
`src/modules/online-checkin/` with a staff screen — room cards (print,
reprint), details waiting to be confirmed, guest requests. A link into it from
the check-in flow is front-desk's file: ask the master.

**Sending (D21-29):** a stand-in sender on this laptop, as your tests already
do. The first real WhatsApp goes out at go-live, to the owner's phone.

**One migration**, for everything above. Numbers are not reserved (root MEMORY
302): write it as the next free number in your copy; the master renumbers at
merge if another lane took it.

**Nothing new names Fidato** (D21-27, `README.md`).

**Added by the go-live interview (D21-59 to D21-63, D21-72):**
- **Spa and laundry requests appear only where that module is switched on.**
  5 Elements, the first hotel live, has neither (D21-63).
- **A privacy notice before the first question** — what is asked, why, who
  sees it, how long it is kept. The master drafts the words and the owner's
  advisor checks them (D21-61); leave a place for them.
- **Room cards come out as a printable sheet per hotel** — hotel name, room
  number, the QR — which the owner prints however they choose (D21-62).
- **The link stays on pms.fidatohotels.com** for now (D21-60), read from the
  server's settings as today, never written into the code.
- **The six-digit code is NOT held back by the booking's WhatsApp tick**
  (D21-75): the guest asking for it is their own request.

---

## ⚠ READ THIS BEFORE ANYTHING ELSE

**This is the only door in the system opened by somebody the hotel does not
employ**, and behind it is a guest's name, their passport and what they owe.
The build plan calls it *"the one piece of this plan that is written twice and
checked twice."* It has already had two defects found by audit (MEMORY 303,
304). Read `api/src/routes/guestDoor.ts` top to bottom — its header comment is
the specification — and read migration 114 beside it.

**The five properties that must survive everything you add:**

1. **A token names ONE booking.** There is no session, no account, no guest
   role. Every function takes the link's HASH and reaches data only through
   that link's `reservation_id`. Nothing you add may take a booking id from
   the caller.
2. **Only the hash reaches the database.** The API hashes what arrived, so a
   query log is not a set of keys.
3. **Nothing behind the code is readable before the code is answered.** Ask
   `verified` ON THE SERVER for every new thing you expose. A screen deciding
   what to show is not a guard.
4. **A wrong phone and a right one are indistinguishable** — same status, same
   words, same shape. "That is not the number on the booking" lets a stranger
   find the number by trying.
5. **Every refusal takes the same shape**, so what is refused cannot be told
   apart from what does not exist.

## What is already built

- `GET /api/guest/:token` — the booking, and whether the guest has proved who
  they are. Name, dates, and the last four digits of the number — what a clerk
  would say across the counter. **Not the bill.**
- `POST /:token/code` — a six-digit code to the number THE BOOKING carries,
  sent through `api/src/sending.ts`, the one door out. Five wrong guesses and
  it is dead.
- `POST /:token/verify`.
- The desk's side: `POST /api/hotels/:code/stays/:id/guest-link`.

## The first version, and nothing more

1. **Check-in details and a photo of the ID** (D18-10) — a passport for a
   foreign guest, which Form C needs. **THE SIGNATURE STAYS AT THE DESK.** The
   legal register does not change; the desk stops typing. Attachments already
   have a home — read `api/src/storage.ts` and `api/src/routes/attachments.ts`,
   and ask the master before inventing a second one.
2. **Their bill, as it stands** — only once the code is answered.
3. **A spa or laundry request** — both services are built; reach them through
   their front doors (`api/src/modules/spa/index.ts`,
   `api/src/modules/laundry/index.ts`), never their tables.
4. **The screens** in `src/modules/online-checkin/`. One page per booking, no
   public page, nothing a stranger can open. **375px is the primary size** —
   this is the one screen that is mostly used on a phone.

## Not in the first version

Paying online, choosing a room, anything a stranger can open, and anything that
changes the legal register.

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
`src/components/app/navigation.ts`, `src/components/ui/`, `api/src/sending.ts` —
**the master's**. Ask for a migration number; take none.

## The gates

**They run HERE and nowhere else.** Your own full run before you hand back is
the whole of the proof.

```powershell
npx tsc -b --force
npx vitest run src/modules/online-checkin src/test
cd api; npm test -- guestDoor
bash db/tests/run.sh
```

**A guard is not a guard until it has refused something** — and here that means
proving, with a test, that each new thing you expose is refused before the code
is answered, and that a wrong number still cannot be told from a right one.

## When you finish

`CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- online-checkin`.
**You do not merge, you do not deploy, and you do not push.** Commit locally
and send the master the head commit, your gate numbers, and the guards you saw
fail.
