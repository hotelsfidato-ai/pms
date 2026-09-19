# Guest messages — the brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.

**Read `docs/briefs/README.md` first.** Your decisions are **D18-11, D18-12** in
`docs/briefs/decisions-2026-09-18.md`, and **D17-34, D17-87, D17-91** before
them. The plan is `docs/BUILD-PLAN-2026-09-18.md` section 4.

**You own** `src/modules/guest-messaging/`, `api/src/modules/guest-messaging/` (front door
made and mounted, empty — add your routers to it; **never touch
`server.ts`**), and `db/tests/modules/guest-messaging.sql`.

---

## What this service is

**The booking confirmation with the check-in link** (D18-12), sent when a
booking is confirmed **from anywhere** — the desk, the CRS, a booking site -
and **again the day before arrival** (D18-11).

## The one door out — you do not call n8n, you call this

`api/src/sending.ts`, exported as `send()` and `canSend()`. Every message this
hotel sends leaves through it and through nothing else: a second caller is a
second set of rules about what may be sent, a second place the secret lives,
and a second record of what went.

- `canSend()` is **false** until the owner finishes their n8n steps
  (`docs/briefs/n8n-sending.md`). **Ask it BEFORE you offer to send**, and show
  `NOT_CONNECTED` where it is false — never a button that was never going to
  work.
- `send(client, message)` answers `{ok:true,id}` or `{ok:false,reason}` and
  never throws for a refusal. It records the attempt itself in `messages_sent`
  (migration 117) — **you do not write that table.**
- **Nothing is recorded when nothing was attempted.** Do not "log" a send that
  could not happen.
- The PDF rides inside the message (D18-20) as `file`; values a particular
  KIND of message needs go in `data`, and n8n reads them from there.

**The wording lives in n8n**, where the owner changes it without a deploy. You
send the data; you do not write the sentence the guest reads.

## The first version, and nothing more

1. **On confirmation**: the booking's details and **the guest's own link**. The
   link is made by the guest door's staff-side route
   (`api/src/routes/guestDoor.ts`). Reach it there and ask the master before
   reaching further — that file is the one piece of this system written twice
   and checked twice.
2. **The day before arrival**: the same link again (D18-11).
3. **A screen showing what was sent against each booking** — what went, to
   which number, when, whether it arrived. `messages_sent` (migration 117)
   holds all of it. **Read it; do not write it.**
4. **Where nothing can send yet, say so plainly.** That is the state this ships
   in, and the screens must be honest about it rather than look broken.

## Not in the first version, on purpose

The bill after check-out stays a button a person presses (D17-34, D17-91). A
review request belongs to the reputation service. Nothing here sends an offer.

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `api/src/sending.ts`,
`src/lib/permissions.ts`, `src/components/app/navigation.ts`,
`src/components/ui/` — **the master's**. Ask for a migration number; take
none: three chats reached for the same one in an hour because nobody had
given them one (MEMORY 301), and a number cannot be reserved ahead because a
gap is refused (MEMORY 302).

## The gates

**They run HERE and nowhere else** — the owner stopped all pushes on 19
September, so there is no Action and no Linux run. Your own full run before you
hand back is the whole of the proof.

**One full suite at a time on this machine** — several chats share it; check
with the master before starting one. **A guard is not a guard until it has
refused something**: break each one, watch it fail, put it back, say so.

```powershell
npx tsc -b --force
npx vitest run src/modules/guest-messaging src/test
cd api; npm test -- modules/guest-messaging
```

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- guest-messaging`;
`npm run release -- guest-messaging`. **You do not merge, you do not deploy, and
you do not push.** Commit locally and send the master the head commit, your
gate numbers, and the guards you saw fail.
