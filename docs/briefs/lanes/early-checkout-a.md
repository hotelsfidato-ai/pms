# Lane A · Early check-out, Part A: "Leaving early" (D27-315) · Opus

Start only when the master has told the owner that D27-314 (the late-charge fix) is merged
into cp6 - it changes the same check-out route.

**Your copy:** from D:\fidato pms, in Git Bash:
`git worktree add ".claude/worktrees/lane-a" -b lane/early-checkout-a cp6`, then work only
there. Junction `node_modules` and `api\node_modules` from the main checkout (AGENTS.md);
NEVER npm install; never copy api\.env. Claim: `npm run claim -- front-desk "D27-315 A"`.

**The decision:** row D27-315 in docs/briefs/decisions-2026-09-27.md, and the study
`.local/early-checkout-proposal.md` (read both fully). Part A only (no money):
- When the business date is before the booked departure, Check out shows one step: booked
  departure, today, "nights not stayed: N - they are not charged and the room goes back on
  sale", and a typed reason (required).
- On confirm, in the check-out's own transaction and before the status flips, the booked
  departure becomes the later of today and the day after the last night any posting pays
  for - use the night audit's own test (`roomNight.ts`), so a group's master bill and a
  multi-night posting count. A same-day leave keeps the first night charged (D27-204).
  Nights already posted are never removed. The room hold is trimmed (the existing amend
  function). The reason is kept on the booking.
- A booking-site (OTA) stay shows "Tell the booking site the guest left early."
- Inventory, the channel push, Due out and the reports then correct themselves because
  they read the booking's dates - prove it (the inventory grid shows the freed nights).
- Credit on the bill is NOT handled here (that is Lane B's refund); a guest with credit
  stays blocked as today.

**Proof:** tests that fail before and pass after (seen failing first): dates shortened,
nights freed in `app.inventory_grid`, same-day leave, a group stay, a multi-night posting,
reason required. Database changes as a new replay-safe migration with the next free
number (look in db/migrations; Lane B may take one too - if you collide, take the next).
Run `db/tests/run.sh`, `db/tests/rerun.sh`, the touched API/web tests (API and db through
`.local/dbq.sh`), then `bash scripts/gates.sh lane-a quick`. Your own scratch database
(restore `.local\backups\fidato-before-day-check-13oct.dump` into it); NEVER write to
`fidato`; never start or stop Postgres. Servers: API 8851, web 5351, stopped by your own
pid. Open the check-out of an early leaver on screen before claiming it works.

Update front-desk CHANGELOG.md/MODULE.md; list manual lines (the book is branch
manual-rest - do not edit it). Commit in small steps ("Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>"). Take the junctions out at the end. Decide nothing new: questions
go in your report with a recommendation. Report to `.local/lanes/a-report.md`.
