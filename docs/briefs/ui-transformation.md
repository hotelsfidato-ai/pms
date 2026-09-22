# Brief — one product on DESIGN.md (the UI transformation)

**Paste this into the main chat:**

```
You are the UI transformation lead for Fidato PMS. Read docs/briefs/ui-transformation.md and follow it exactly. Plan first, bring the plan to the owner, and write no code until they approve it.
```

Written 22 September 2026 from the owner's own brief ("Lead UI Transformation
Agent"), fitted to this repository. Where the two differ, this file wins,
because it knows what the repository already has and what the owner has
already ruled.

---

## 0 · What the job is, and what it is not

Make every PMS screen read as one product, built on `DESIGN.md`: calm, dense
but readable, fast to scan, desktop-first and properly designed for a phone.
**Presentation only**: what the screens look like and how they behave under
a finger. Not the data, not the sums, not the server.

**This is not a fresh redesign, and most of the system is already built.**
Do not start from scratch:

```
15 Sep   one primary action per screen, declared and guarded (HANDOVER § 3.1)
15 Sep   a menu per person, Find a screen (Ctrl K), Start here cards, Terms, empty states
16 Sep   contrast fixed system-wide: grey-400 is not text, readable orange steps (§ 3.0f)
16 Sep   the mobile pass: every DataTable list is a card list on a phone
21-22 Sep  the Dashboard rebuilt on the design system (CHANGELOG, top entry)
22 Sep   DESIGN.md and DESIGN.html written from src/styles/theme.css
```

What is left is the drift: the places where a screen, usually at a service's
edge, still does its own thing. Find it, fix it once in the shared kit where
possible, then screen by screen.

---

## 1 · Read first, in this order

1. `CLAUDE.md`, then the top section of `HANDOVER.md` to the end.
2. `DESIGN.md` all of it, then open `DESIGN.html` in the browser.
3. `src/styles/theme.css`: the tokens themselves.
4. `docs/audits/2026-09-16-design-critique.md`: 20/40, and each service's
   own findings.
5. **`.local/screenshots/2026-09-21/index.html`**: 81 screens, at 1440 and
   390 wide, full length. **This is the current-state reference**, not a
   single phone screenshot. `screens.json` beside it lists every route.
6. `AGENTS.md`: "Shared, and therefore frozen", "Reusable pieces", and how a
   helper gets its own copy, database and ports.
7. `docs/briefs/README.md`: the five rules every lane obeys, the long-dash
   rule, and D21-27 (nothing new names Fidato in code).
8. `/design-system` in the running app: every piece of the kit, drawn.

---

## 2 · What wins when two sources disagree

1. **The owner's decisions**: `HANDOVER.md` §§ 4 to 6 and
   `docs/briefs/decisions-*.md`. They outrank everything on words, figures
   and what a person sees.
2. **Token values**: `src/styles/theme.css`. DESIGN.md says so itself: if
   the two disagree, the CSS is right and DESIGN.md is out of date (report
   it).
3. **Rules**: `DESIGN.md`.
4. **The look**: `DESIGN.html`.
5. **The kit**: `src/components/ui/` and `src/components/app/`.
6. **The screenshots**: what exists today. They show the starting point, not
   what is right.

Something DESIGN.md does not cover: reuse the nearest pattern it does cover.
If none fits, it is a question for the owner, not an invention.

---

## 3 · Rules that outrank this job

- **Nothing leaves this machine.** No `git push`, no Action, no deploy.
  Commit locally. `bash scripts/gates.sh <label>` is the proof.
- **No decision without the owner.** Ask with a recommendation, then wait. In
  this job, all of these are decisions:
  - any change to a word a person reads: a label, a heading, a button, a menu
    entry, a tile's name;
  - removing, hiding, merging or moving information on a screen;
  - changing what a figure shows, or when it turns a colour;
  - a change to a shared component that alters every screen. The plan brings
    these as one numbered list, and the owner approves the list;
  - the three older one-offs in DESIGN.md's Don'ts (the owner has not answered
    yet);
  - fixing anything in `src/components/ui/`. It was ported from the CRS, and
    AGENTS.md says a defect there is a CRS bug too: report it and stop. Ask
    whether the PMS's kit may now be fixed on its own.
- **Presentation only.** Do not touch `api/`, `db/`, `src/data/repositories/`,
  query keys, rules in `src/lib/rules.ts`, or any calculation. Screens read
  data only through `@/data/repositories` (a test enforces it). If a UI fix
  seems to need a data change, stop and ask.
- **A missing figure is "-" in `grey-500`, never 0.** A failed read is an
  error state that says what failed, never a row of dashes
  (`ErrorState` / `ReadProblem`). Never invent a figure, never hard-code one:
  the numbers in the owner's brief (35.29%, ₹2,939 …) were examples.
- **Words:** sentence case, the desk's glossary (HANDOVER § 6: Bill,
  Booking, Guests, Month so far, Order 12). No long dash "—" in anything a
  person reads; use " - " inside a sentence. The menu label, the page heading
  and the browser tab say the same words. Rename a button, and
  `src/components/app/startHereCards.ts` changes with it; change what a figure
  means, and its line in `src/lib/glossary.ts` changes with it. Nothing new
  names Fidato in code (D21-27).
- **The tests are guards.** Never weaken or delete one to go green. If a
  test pins the old words or the old layout, that is a decision: ask. The ones
  this job will meet: `src/components/ui/primaryAction.test.ts`,
  `src/components/app/navigation.test.ts`, `src/test/boundaries.test.ts`,
  `src/App.test.tsx` ("start here", "trade words", one main action on each tab
  of the stay panel), `src/modules/reports/reports.test.tsx`.
- **impeccable and the taste skills are written guidance only.** Never run
  impeccable's binary.
- **Every mistake goes in writing**: the service's `DEFECTS.md`, or the root
  `MEMORY.md` if the lesson is project-wide.

---

## 4 · What exists already: map to it, do not rebuild it

The owner's brief asks for a "current component to design-system component"
map and lists components to create. Most already exist. **Check this table
against the code and correct it**; do not start a second kit.

```
DESIGN.md component        where it is today
Button, 4 variants + link  src/components/ui/Button.tsx (data-variant, for tests)
Input and fields           Input.tsx, Combobox.tsx, DatePicker.tsx
Card                       Card.tsx: Card, CardHeader, CardBody, CardFooter, DetailList
Status pill                StatusPill.tsx: tones in RESERVATION_TONES, INVOICE_TONES
Page, page header, section PageHeader.tsx: Page, PageHeader, Section, Breadcrumbs
Table + phone card list    DataTable.tsx (has "Sort by" on a phone);
                           front desk's StayTable has its own StayCards
Dialog, drawer, tooltip    Overlays.tsx; Menu.tsx; Toast.tsx
Empty, error, loading      States.tsx, ReadProblem.tsx
Glossary term              Term.tsx + src/lib/glossary.ts
Stat, Segmented, Switch    Misc.tsx (also Checkbox, ProgressBar, SearchInput)
Filter bar                 FilterBar.tsx: no screen uses it, only /design-system
Sidebar, top bar, drawer   src/components/app/: AppShell, Sidebar, TopBar,
                           CommandPalette (Find a screen), AccountMenu
Dashboard tile             Tile and TileGroup, LOCAL to
                           src/modules/reports/pages/Dashboard.tsx
Money and dates            src/lib/format.ts; Amount in ReportShell prints "-" for null
Icons                      lucide-react only, already in about 85 files
```

Of the components the owner's brief lists (DashboardTile, KpiTile,
MetricBreakdown, SectionHeader, QuickReportButton, HouseStatusTile,
StatusPill, PageHeader, MobileDrawer, TopBar), **only the Dashboard tile is a
real candidate**, and only if a second screen needs it. Then it moves into
`src/components/ui/` as ONE `Tile` (ask first). No KpiTile or HouseStatusTile
variants. The others exist under the names above.

---

## 5 · Known drift: start here, and re-measure it

Counted on 22 September with grep. These numbers are leads, not the audit.

- **Literal colours instead of tokens:** 10 `.tsx` files use `bg-[#…]` /
  `text-[#…]` classes. Nine of them carry the warning ink `#8a6300`, which is
  already a token (`warning-ink`): AppShell, OfflineBar, ReadProblem,
  StatusPill, CheckInFlow, WalkInFlow, Housekeeping, SlipNotice,
  OrderHeaderPanel. Button.tsx has the danger hover literals.
- **Shadows:** 4 files. `Menu.tsx` floats, so its shadow is right. Check
  `finance/pages/Invoice.tsx`, `pos/pages/Kitchen.tsx`, `pos/pages/Terminal.tsx`.
- **The three one-offs** in DESIGN.md's Don'ts. Ask first.
- **The CRS-ported kit:** `Checkbox` and `Switch` have no accessible name,
  and nothing uses `focus-visible:`. Ask first (§ 3).
- **The critique's P2 and P3:** five date formats and four money formats;
  nested cards and cramped padding on `/pricing`.
- **Not this job:** the critique's P0 "the numbers that disagree" (one
  booking with three statuses, "in house" counted four ways). It is not a UI
  pass; the owner put it first on its own. Unifying money and date formats
  touches it too, so ask before you do that.
- **The City ledger tile's words:** the owner still owes them. Leave the tile
  as it is.

---

## 6 · How the work runs here

The owner talks to one main chat (D22-1). **You are that chat, the lead.**
You plan, you send helper agents, you merge. The owner's six agents map onto
how this project already works:

```
owner's brief            here
1 UI auditor          ┐  read-only helpers, no copy needed, run together
2 design-system map   ┘  -> one audit file
3 Dashboard agent        a helper in the REPORTS lane (the Dashboard is reports')
4 component agent        the ONE holder of the shared core (you, or one helper)
5 responsive agent    ┐  read-only helpers on merged cp6, after each round
6 visual QA agent     ┘
```

**The rules for helpers (AGENTS.md):** at most **three writing at once**. One
helper per service. Never two helpers in one folder. Each works in its own
copy `.claude\worktrees\<name>` on its own branch, with its own database and
ports, and claims its service with `npm run claim -- <service> "ui pass"`
before its first write. A service helper **does not edit the core**. It
asks you, and you make that change on the core branch. You merge one branch at
a time into `cp6`, locally, with the full gates after each. Then the copy
goes to the Recycle Bin, junctions first.

### Phase 1: audit (read-only, no code)

Two helpers at once. The auditor walks every route in
`.local/screenshots/2026-09-21/screens.json` against every rule in § 7. The
mapper checks § 4 against the code. **Measure; do not only grep:** on a sample of
screens, read the computed styles in the browser (radius, border, shadow, font
size, colour) at 1440 and 390. Write one file,
`docs/audits/2026-09-22-ui-audit.md`: for each finding give the screen, the
rule it breaks, `file:line`, and who owns the file (core, or which service).

### Phase 2: the plan, to the owner. STOP here.

Bring the owner:

- **A.** The audit, summarised: the worst drift first, counted.
- **B.** The mapping (§ 4, corrected).
- **C.** The files that will change, grouped core / each service.
- **D.** Components to create or change, and why each earns its place.
- **E.** Risks: which guards will fail, what could look different to staff
  tomorrow, what touches the CRS-ported kit.
- **F.** **The decisions, numbered**, each with your recommendation. At least:
  the three one-offs; whether the kit may diverge from the CRS; every word
  change; every piece of information moved or removed; the money and date
  formats.

**Write no code until the owner says yes.** A plan is not approval, and
neither is silence.

### Phase 3: the shared core (one holder)

Branch `ui/core`. The tokens in `theme.css`, then `src/components/ui/`, then
`src/components/app/`. The core changes every screen at once, so do the most
here and the least in each service. Check each piece on `/design-system`
and on three real screens that use it.

### Phase 4: the Dashboard (reports lane)

`src/modules/reports/pages/Dashboard.tsx` was rebuilt on 21 and 22 September.
**Check it line by line against DESIGN.md's Dashboard tile and grid rules,
and close only the gaps.** Keep its sections and their order: Today
(Occupancy, Average rate, RevPAR, Room revenue, each with Month so far and
Year so far), The house now (six counts, each opening its list), Money
(Collected today, Owed by guests, City ledger, No-shows), Quick reports,
Every property. Orange only above zero (the Signal Rule).

### Phase 5: every service, three at a time

The owner approved two lanes on 16 September so that no two agents ever open
one file (HANDOVER § 3.0f): **front-desk + housekeeping** and
**pos + inventory + finance**. Then reservations, guests, night-audit,
banquet, stores and equipment, admin, and the rest of reports. Each helper reads
`docs/briefs/<service>.md`, its `MODULE.md` and its `DEFECTS.md` first,
changes only its own folder, and sends every core need to you. The Coming
soon pages all use `src/pages/ComingSoon.tsx`. Fix that file once, on the core
branch.

### Phase 6: responsive and visual QA (read-only, on merged cp6)

Widths 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920. Check each rule in
§ 7 **by measurement**. Also check a coarse pointer: 44px targets follow the
pointer, not the width. Photograph every route again, at 1440 and 390, into
`.local/screenshots/<date>/`, the same way as 21 September, so the owner can
compare before and after.

### Phase 7: functional QA

The full gates, then use the system as staff do, in the browser, as each
role ("View as": Owner, General Manager, Reception, and the per-role logins):
make a booking, check in, take a payment, check out; a POS order to the
kitchen; mark a room clean; run the Manager report; open every dialog you
touched; use filters and search; Find a screen; the phone drawer. Permissions:
a role still sees exactly what it saw before.

---

## 7 · The checklist every screen passes

```
colour     tokens only (theme.css); no literal hex in a class; no colour for decoration
surface    white work surfaces on a grey-50 page; 1px grey-200 hairline
shadow     only dialogs, drawers, menus, popovers, toasts; never a card, tile or table
radius     md 10px for cards, inputs, tables, tiles and buttons; sm 6px for small buttons
           and tooltips; lg 12px for dialogs and drawers; full for pills
type       Inter only. Headline 24/600, one per screen; title 18/600; title-sm 16/600;
           body 15; body-sm 14; caption 12. Nothing below 12px
figures    tabular, right-aligned in columns; lead Dashboard figure 30px, other tiles 24px
missing    "-" in grey-500, at full size; a failed read says it failed
text       never grey-400; grey-500 on white at least, grey-600 on a tint
orange     brand-orange-600 = the ONE primary button per view (and one per dialog);
           brand-orange-700 = orange text; a zero count is ink, not orange
status     StatusPill tones only, with meaning: success paid/confirmed, info neutral,
           warning, danger, accent; tangerine due out; rose no-show
icons      lucide-react only; 16px in controls, 20px standalone; a 32px grey-100 chip
           with 10px corners on a tile; no emoji
layout     Page padding 20/24, then 28/32 from 640px; max 1600px; 12px grid gap;
           four tiles 1 / 2 (640) / 4 (1280); six counts 2 / 3 / 6; never one tile alone
nav        sidebar ink-900, 248px, collapses to 68px; a drawer below 1024px;
           top bar white, 56px, grey-200 rule below
tables     40px grey-50 header, uppercase 12px grey-500; card list below 640px with Sort by
touch      44px buttons and inputs, 16px input text, under a coarse pointer
motion     110 to 200ms, only for opening and closing; stops under reduced motion
states     every list: loading, failed, empty (what belongs here), full
a11y       focus ring 2px brand-orange, 2px out; every control has a name; AA contrast
```

---

## 8 · Running it on this machine: the traps

- **A helper's copy.** Use `git worktree add ".claude\worktrees\<name>" -b ui/<name>`,
  then the two `node_modules` junctions (AGENTS.md). Copy the root `.env`;
  **never** copy `api/.env`. A new database comes up empty of people. Seed it
  as the auto-memory "fresh service copy database" says (insert the three
  staff, then `npm run demo`, then `dev-identities.sql` and `dev-testers.sql`).
- **Servers in a copy.** `preview_start {name}` reads the MAIN checkout's
  launch.json. Start the copy's API and web from background shells on free
  ports, then run `preview_start {url}`. To stop them, match the listener on
  `.claude\worktrees\<name>` (and the API's PARENT process), never on
  `D:\fidato pms` alone.
- **Browser pane.** A hidden pane freezes dialogs and times out screenshots.
  Fix it with `resize_window 1280x720`. An emulated viewport breaks screenshots and
  click coordinates, so measure widths with JS and reset to "desktop" before
  clicking. The console keeps old errors; log a MARK first.
- **Types in a copy:** `npx tsc -b --force`.
- **Gates:** `bash scripts/gates.sh <label> quick` while iterating, and the
  full run before a merge. **Run one at a time**, because several at once exhaust
  the machine. Judge each by its exit code.
- **`npm run lane` counts are wrong** while `origin/cp6` is frozen. Report
  your real file set from `git diff --name-only <branch point>..HEAD`.
- **Commit messages in PowerShell:** write the message to a file and run
  `git commit -F <file>` (MEMORY 255).

---

## 9 · What you report

**Before code:** Phase 2's A to F, then wait.

**After code, to the owner:**

- **A.** Files changed (from git, not from the lane check).
- **B.** Components created or changed.
- **C.** Dashboard changes.
- **D.** Responsive changes.
- **E.** Visual QA: each § 7 rule marked measured, eyeballed or not checked.
- **F.** Functional QA: the gates as run (quote the exit codes) and each flow
  you walked through.
- **G.** What still breaks DESIGN.md, and why it was left.

Then write a `CHANGELOG.md` entry, bring `HANDOVER.md` §§ 2 to 3 up to date,
record every mistake in `MEMORY.md` or the service's `DEFECTS.md`, and release
every claim.

**Do not claim the product matches DESIGN.md unless you measured it.**
"Looks right" is not a check.
