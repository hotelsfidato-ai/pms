# Lane B · Cash round-off (D27-317), then Refunds (D27-315 Part B) · Opus

**Your copy:** from D:\fidato pms, in Git Bash:
`git worktree add ".claude/worktrees/lane-b" -b lane/money cp6`, then work only there.
Junction `node_modules` and `api\node_modules` from the main checkout (AGENTS.md); NEVER
npm install; never copy api\.env. Claim: `npm run claim -- finance "D27-317 + D27-315 B"`.

Read rows D27-315 and D27-317 in docs/briefs/decisions-2026-09-27.md and the study
`.local/early-checkout-proposal.md` (section 3 Part B and section 4) fully first.

**1 · Cash round-off (D27-317), first, smaller.** When a ROOM bill is settled in cash, the
cash taken is rounded to the nearest rupee and the round-off (at most ±0.50) is recorded
with the payment, so the desk's drawer balances. UPI, card and every other mode pay the
exact amount. The GST invoice keeps its exact figures. The restaurant bill's own Round off
is unchanged. Show the rounded figure and the round-off on the Settle dialog and the bill.

**2 · Refunds (D27-315 Part B).** A Refund line on a stay's own bill when it is overpaid:
- Pressed only by the owner, Admin, GM or Accountant (the same four who may reverse a
  payment, D27-125) - enforced by the server and the database.
- Back by the mode paid; never cash for a card or UPI payment; cash only below ₹20,000, a
  transfer above (until the CA confirms the limit - say so on screen in plain words).
- Records the mode, a reference (UPI ref, card approval, cheque or transfer number), the
  reason and who; dated today. A cash refund lowers that person's drawer.
- A printed plain "Refund receipt" (the GST Rule 51 voucher waits for the CA - say so).
- FIRST make every report agree on what the `refund` category means (the study lists the
  ~nine readers: reports.ts, manager.ts, builders/nightAudit.ts, figures.ts ...): one sign,
  money out. Prove the Manager report, Night audit report and money-owed agree.
- Scope: refunds only on a guest's own bill; a group master, a company's credit and a
  booking-site stay show a notice only. Check-out is allowed once refunded to zero.
- Lane A (another session) is adding "Leaving early" to the same check-out dialog; keep
  your refund as its own step/component the dialog can show when the bill is overpaid,
  and stay out of the check-out route's date logic. The master merges both.

**Proof:** for each rule a test that fails before and passes after (seen failing first):
rounding only for cash, the drawer balancing, the refund roles (403 for others), the mode
and cash ceiling, the reports agreeing, the receipt. Database changes as replay-safe
migrations with the next free numbers (look in db/migrations; Lane A may take one - if
you collide, take the next). Run `db/tests/run.sh`, `db/tests/rerun.sh`, the touched
API/web tests (API and db through `.local/dbq.sh`), then `bash scripts/gates.sh lane-b quick`.
Your own scratch database; NEVER write to `fidato`; never start or stop Postgres. Servers:
API 8852, web 5352, stopped by your own pid. Open Settle (cash and UPI) and a refund on
screen before claiming it works. No default prices; a missing figure is a dash, never 0.

Update finance (and any touched module) CHANGELOG.md/MODULE.md/DEFECTS.md; list manual
lines (branch manual-rest - do not edit it). Commit in small steps ("Co-Authored-By:
Claude Opus 5.5 <noreply@anthropic.com>"). Take the junctions out at the end. Decide
nothing new: questions go in your report with a recommendation. Report to
`.local/lanes/b-report.md`.

**Progress log:** append a line to `D:idato pms\.local\lanes\progress.log` at the start, after each finished piece, at least every 30 minutes, and at the end ("DONE"; "BLOCKED: why" if stuck) - the format is in README.md.
