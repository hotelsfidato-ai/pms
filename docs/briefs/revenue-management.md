# Revenue management — the brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


**Read `docs/briefs/README.md` first**, then this, then
`src/modules/revenue-management/MODULE.md`. Your decision is **D18-15** in
`docs/briefs/decisions-2026-09-18.md`. The whole plan is
`docs/BUILD-PLAN-2026-09-18.md` § 6; how the chats run together is
`docs/PARALLEL-PLAN-2026-09-18.md`.

**You own** `src/modules/revenue-management/`,
`api/src/modules/revenue-management/` (front door made and mounted, empty — add
your routers to it; **never touch `server.ts`**), and
`db/tests/modules/revenue-management.sql`.

---

## The one rule that defines this service

**It shows and it suggests. It never changes a price by itself** (D18-15, the
owner's own words). Nothing here writes to a rate, a restriction or the channel
manager. The GM or the owner makes the change, on the Rates screen, as today.
If you find yourself writing to `rate_*` or calling the channel manager, stop.

## The first version, and nothing more

1. **Pickup** — for each future date: rooms sold now, and how many of those
   were sold in the last 1, 7 and 30 days.
2. **Pace** — this month against the same month last year, and against where
   this month stood a week ago. Where there is no last year, say so; never a
   zero, never an invented comparison.
3. **Which dates are soft** — rooms left, the rate they are selling at, how
   close the date is.
4. **What it would suggest** — a sentence and its reason ("Saturday 14th is
   four days out at 35% — consider…"). Words, not a number it applies.

**ONE DEFINITION OF EVERY FIGURE.** Occupancy, ADR, rooms sold, available
rooms and a complimentary room's treatment are already defined — in
`api/src/modules/reports/figures.ts` (D17-71, D17-72, D17-93) and
`src/lib/glossary.ts`. **Read them through the reports service's front door.**
A second definition of occupancy is how the Dashboard and the Manager report
ended up disagreeing in August. If the door does not export what you need, tell
the master what and why.

> **R1 is answered** (18 September). The reports door now exports
> `dailyFigures`, `sumDays`, `firstTradingDay`, `propertyFor`, `propertyById`,
> `isoDateParam`, `heading` and the `NIGHTS` fragment, with the `DayFigures`,
> `Property` and `StayNight` types. **Rebase onto the local `cp6` and build
> pickup and the week-ago column of pace** — the two things you correctly refused to build
> rather than count room-nights your own way. `NIGHTS` is the one that matters:
> the moment a second service writes its own, the two disagree on the day
> somebody cancels late.
>
> **R2 is the master's, at merge**, not yours: dropping `"Revenue management"`
> from `SOON` and `"listDailyStatistics"` from `KNOWN_UNREACHABLE` is only true
> once your branch is in, and doing it early turns both tests red on `cp6`.

**WHO SEES IT:** the owner, an administrator, the GM and the Revenue Manager.
The `rate` resource in `src/lib/permissions.ts` already says who may see rates;
ask the master rather than editing that file.

**NO PRICE IS INVENTED.** A date with no rate shows "-". A suggestion never
names a figure the system made up.

## Not in the first version

Competitor rates (there is no source for them), automatic rules, anything that
writes a rate or talks to SU, forecasting beyond the comparison above.

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
`src/components/app/navigation.ts`, `src/components/ui/` — **the master's**.
`src/modules/reports/` and `src/modules/inventory/` are other services': read
through their front doors, never their files.

**You should need no migration at all.** Everything here is read from what
exists. If you think you need one, ask the master first and say why.

## The gates

**They run HERE and nowhere else** — the owner stopped all pushes on 19
September, so there is no Action and no Linux run. Your own full run before you
hand back is the whole of the proof. While you work:

```powershell
npx tsc -b --force
npx vitest run src/modules/revenue-management src/test
cd api; npm test -- modules/revenue-management
```

**One full suite at a time on this machine** — four chats share it. **A guard
is not a guard until it has refused something** — and the one that matters most
here is the one proving this service cannot write a rate.

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`;
`npm run lane -- revenue-management`; `npm run release -- revenue-management`.
**You do not merge, you do not deploy, and since 19 September you do not
push either — the owner's rule: nothing leaves this machine.** Commit on your branch — NOT pushed — and send the master
the head commit with your gate numbers and the guards you saw fail.
