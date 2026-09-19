# Marketing — the brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.

**Read `docs/briefs/README.md` first.** Your decision is **D18-17** in
`docs/briefs/decisions-2026-09-18.md`. The plan is
`docs/BUILD-PLAN-2026-09-18.md` section 8.

**You own** `src/modules/marketing/`, `api/src/modules/marketing/` (front door
made and mounted, empty — add your routers to it; **never touch
`server.ts`**), and `db/tests/modules/marketing.sql`.

---

## What this service is

**Guest lists that can be acted on** (D18-17) — and nothing that duplicates the
leads app, which keeps the conversations.

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

1. **The lists**: stayed twice; not returned in a year; came from which booking
   site; birthdays this month.
2. **An export** of any list.
3. **A send through the one door out** when an offer goes out, recorded against
   each guest like every other message.
4. ⚠ **a guest who has asked not to be written to is never on a list
   that sends.** If nothing in the schema records that yet, **ask the master** -
   do not invent a column, and do not ship a send without it. This is the one
   rule here that is not about tidiness.

## Where the figures come from

**Through front doors, never another service's tables.** Guests are
`src/modules/guests/`; stays and their sources are the reservations and reports
services. If a door does not export what you need, **tell the master what and
why** rather than reaching past it.

## Not in the first version

Campaigns with stages, anything scheduled to repeat, tracking who opened what,
discount codes, and anything the leads app already does.

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
npx vitest run src/modules/marketing src/test
cd api; npm test -- modules/marketing
```

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- marketing`;
`npm run release -- marketing`. **You do not merge, you do not deploy, and
you do not push.** Commit locally and send the master the head commit, your
gate numbers, and the guards you saw fail.
