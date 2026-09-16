# Claims — who is holding what, right now

The owner runs several agents at once, one per service: one on the POS, one on
the front desk, one on inventory. This folder is how they stay out of each
other's way.

**One file per service. `pos.md` is the POS agent's and nobody else's.**

That is the whole design. The claim used to live in a table inside
`HANDOVER.md`, which meant three agents claiming three different services all
wrote to the same file at the same time — the register of who owns what was
itself the thing they collided over. A file per service cannot collide,
because no two agents ever write the same one.

---

## Claiming

Before your first write, create your service's file. Nothing else:

```powershell
# the owner's PC, PowerShell, in YOUR working copy
Set-Content -Encoding utf8 ".claims\pos.md" @"
CLAIMED 16 Sep 2026 · branch pos/kot-stations · copy D:\fidato-pos
Building KOT stations (docs/APPS-PLAN.md phase 0a).
"@
```

**Read the other files first.** If the service you want already has one, stop
and tell the owner — do not write into a service somebody is holding. Waiting
costs minutes; colliding costs a day.

**Delete your file when you stop.** A claim left behind by an agent that has
finished is worse than no claim at all: the next session believes somebody is
in there.

```powershell
Remove-Item ".claims\pos.md"
```

---

## Checking

Before you commit, in your own copy:

```powershell
npm run lane -- pos
```

It sorts everything you have changed into yours · shared · somebody else's,
and exits 2 if anything is outside your lane. It is read-only; it refuses
nothing and blocks nothing. What it gives you is the sentence you owe the
owner before a commit that reaches beyond your service.

---

## What a claim does and does not cover

| | |
|---|---|
| **Yours** | `src/modules/<service>/` · `api/src/modules/<service>/` · `db/tests/modules/<service>.sql` |
| **Shared** | the core in `AGENTS.md` § "Shared, and therefore frozen" — the design system, the shell, the repositories, the server's core, `db/migrations/`. One agent at a time, and the owner says yes first |
| **Nobody's alone** | `HANDOVER.md`, the root `CHANGELOG.md`, `MEMORY.md`, `PENDING.md`. Your service keeps its own `CHANGELOG.md` and `DEFECTS.md`; the owner folds them into the root ones |
| **Never** | another service's folder. Write it on that service's Requests list in its `MODULE.md` and tell the owner |

**A migration number is shared.** `db/migrations/` is one sequence replayed
from 001 on every deploy, and `src/test/migrationNumbers.test.ts` refuses a
duplicate *or a gap* — so numbers cannot be reserved in blocks and two agents
cannot each take the next one. Say in your claim file which number you are
taking, read the other claim files before you take it, and expect to renumber
if two land in the same hour.

---

## This folder is committed on purpose

It is small, and it is the only way an agent in a fresh chat can see who else
is working. Git ignores nothing here.
