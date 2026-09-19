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
