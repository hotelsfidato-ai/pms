# Reviews — the brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.

**Read `docs/briefs/README.md` first.** Your decision is **D18-14** in
`docs/briefs/decisions-2026-09-18.md`. The plan is
`docs/BUILD-PLAN-2026-09-18.md` section 5.

**You own** `src/modules/reputation/`, `api/src/modules/reputation/` (front door
made and mounted, empty — add your routers to it; **never touch
`server.ts`**), and `db/tests/modules/reputation.sql`.

---

## What this service is

**After check-out, a message asking for a review** with the group's own review
link, and **a screen showing who was asked, who has not been, and what came
back** (D18-14).

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

1. **Ask after check-out** — never before. A review asked while somebody is
   still in the room is asked of a stay that has not finished.
2. **The group's own review link.** ⚠ **THE OWNER HAS NOT GIVEN IT YET.**
   Do not invent one, do not hardcode a Google address, and do not ship a
   placeholder that looks real. Make it **a setting per property**, empty until
   somebody fills it, and **refuse to send while it is empty**, with a sentence
   saying exactly that. It is the same rule as no default prices: a thing
   nobody has set is a dash, not a guess.
3. **A screen**: who was asked, who has not been, what came back.
4. **Nothing is pulled from Google or the booking sites yet** (D18-14). Say so
   on the screen where a person would go looking for it.

## Not in the first version

Pulling reviews in from anywhere, replying to them, scoring or sentiment, and
chasing somebody who did not answer.

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `api/src/sending.ts`,
`src/lib/permissions.ts`, `src/components/app/navigation.ts`,
`src/components/ui/` — **the master's**. Ask for a migration number; take
none: three chats reached for the same one in an hour because nobody had
given them one (MEMORY 301), and a number cannot be reserved ahead because a
gap is refused (MEMORY 302).

`src/modules/guest-messaging/` is another chat's, running beside you. Both of
you send through the same door; neither of you owns it.

## The gates

**They run HERE and nowhere else** — the owner stopped all pushes on 19
September, so there is no Action and no Linux run. Your own full run before you
hand back is the whole of the proof.

**One full suite at a time on this machine** — several chats share it; check
with the master before starting one. **A guard is not a guard until it has
refused something**: break each one, watch it fail, put it back, say so.

```powershell
npx tsc -b --force
npx vitest run src/modules/reputation src/test
cd api; npm test -- modules/reputation
```

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- reputation`;
`npm run release -- reputation`. **You do not merge, you do not deploy, and
you do not push.** Commit locally and send the master the head commit, your
gate numbers, and the guards you saw fail.
