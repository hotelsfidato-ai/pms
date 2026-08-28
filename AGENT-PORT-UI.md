# Checkpoint 1 — REDIRECTED. Port the CRS library; do not rebuild it.

Paste everything below the line to the builder agent.

---

**Stop hand-writing primitives. The component library you are building already
exists, in production, on this disk.**

`D:\fidato crs\src\components\ui\` — thirteen modules, ~100 exports, running
today at `app.fidatohotels.com` across 32 properties.

This is not a suggestion. The owner has looked at the CRS design system page and
instructed that the PMS maintain it. The only reliable way to maintain a design
system across two applications is to **share the implementation**. Every
primitive you hand-write is a place the two will drift.

## Why the port is safe — verified, not assumed

I checked before writing this.

**1 · The token file is byte-identical.**

```
3dd69f8b13bdf9f85803e53814857428   D:\fidato crs\src\styles\theme.css
3dd69f8b13bdf9f85803e53814857428   D:\fidato pms\brand\tokens\theme.css
3dd69f8b13bdf9f85803e53814857428   D:\fidato pms\src\styles\theme.css
```

Same MD5, all three. Every class those components use already resolves in your
build. **No token translation is required.**

**2 · The library has no CRS-specific coupling.** Every import across all
thirteen modules:

```
13x  react                     13x  @/lib/cn          10x  lucide-react
 3x  @/lib/format               1x  zustand            1x  date-fns
 1x  react-router-dom           8x  @radix-ui/*        6x  sibling modules
```

**No Supabase. No Firebase. No feature imports. No data layer.** It is a pure
presentation library. This is the cleanest port you will ever be handed.

## What you have versus what exists

| | You | CRS |
|---|---|---|
| Primitive modules | 4 | **13** |
| `DesignSystem` page | 312 lines | **~700 lines** |
| Battle-tested | no | **in production** |

Your four files — `Button` `Card` `Input` `StatusPill` — are replaced by the
port. Delete them. Do not attempt to merge.

## Step 1 — install the five missing dependencies

**PowerShell, not Git Bash** (TLS-inspecting proxy; Git Bash installs fail on
certificates).

```bash
npm install tailwind-merge lucide-react date-fns @radix-ui/react-checkbox @radix-ui/react-switch
```

That is the complete list. I verified each against the library's actual imports
— `clsx`, `zustand` and the other eight Radix packages are already installed.

**Also remove two packages the library does not use**, so nobody later assumes
they are the sanctioned path:

```bash
npm uninstall @radix-ui/react-toast @radix-ui/react-select
```

The CRS `Toast` is a **zustand store**, not Radix Toast. `NativeSelect` is a
plain styled `select` element, not Radix Select. Both are deliberate — record
this in `docs/DECISIONS.md`.

## Step 2 — copy these files verbatim

```
FROM  D:\fidato crs\src\lib\cn.ts               TO  src/lib/cn.ts
FROM  D:\fidato crs\src\lib\format.ts           TO  src/lib/format.ts
FROM  D:\fidato crs\src\components\ui\*         TO  src/components/ui/
```

All thirteen modules plus `index.ts`. Skip `describeError.test.ts` only if your
test setup rejects it — otherwise take that too, it is free coverage.

**Copy them. Do not retype them, do not "improve" them, do not reformat them.**
A port that introduces a variation is not a port.

## Step 3 — the only three edits the port requires

I traced these specifically so you do not have to hunt for them.

**3a · `react-router-dom` becomes `react-router`**

One import, in `PageHeader.tsx`. You have `react-router` v7, which exports the
same API from the bare package name.

**3b · Path alias `@/`**

Confirm `@` resolves to `src/` in **both** `vite.config.ts` and
`tsconfig.app.json`. If it does not, add it — do not rewrite thirteen files of
imports to relative paths.

**3c · `StatusPill` tone sets**

`StatusPill.tsx` exports eight domain tone maps: `RESERVATION_TONES`,
`INVOICE_TONES`, `HOTEL_TONES`, `CUSTOMER_TONES`, `COMPANY_TONES`,
`AUTOMATION_TONES`, `RUN_TONES`, `COMMISSION_TONES`, `INTEGRATION_TONES`.

Several are CRS-only. **Keep the `Tone` type and the `StatusPill` component
exactly as they are** — that is the visual contract. Add the PMS sets the front
desk actually needs:

```
ROOM_TONES          clean · dirty · inspected · out-of-order · out-of-service
STAY_TONES          due-in · in-house · due-out · checked-out · no-show
HOUSEKEEPING_TONES  assigned · in-progress · done · blocked
FOLIO_TONES         open · settled · disputed · written-off
```

Map them onto the **existing** tone vocabulary. Do not invent an eleventh colour
— that is exactly the drift this port exists to prevent.

Leave the CRS sets in place. They cost nothing and they keep the file diffable
against its origin.

## Step 4 — port the design system page

```
FROM  D:\fidato crs\src\features\design-system\DesignSystemPage.tsx
TO    src/pages/DesignSystem.tsx
```

Replace yours entirely. Then change **only** these:

- **Demo rows** — CRS uses "Ayati Resort & Spa", "Hotel Hill Top", "Turtle Beach
  Resort". Swap for real Fidato owned properties. **5 Elements Akkalkot has 17
  rooms — use 17, never 25.** Property names and counts beyond that are still
  unconfirmed, so keep the set small and do not invent totals.
- **The typography specimen string** — CRS reads "Fidato Hotels — 32
  properties". The PMS runs **seven**. Change the number; keep the sentence.
- **Add a PMS tone section** rendering the four new tone sets from 3c.

**Change nothing else.** Not the section order, not the copy, not the Success
colour rationale paragraph, not the closing statement. That page is the
specification the owner approved.

## Step 5 — the shell — ⚠ WITHDRAWN

> **This step was wrong and is cancelled.** The shell is **Checkpoint 3**, not
> Checkpoint 1. Porting it here jumps the sequence.
>
> The builder correctly skipped it — and that is exactly why `TooltipProvider`
> went missing, since it lives in `AppShell`. See `AGENT-CP1-AUDIT.md`: mount
> `TooltipProvider` and `Toaster` in `App.tsx` at CP1, and move them into
> `AppShell` when CP3 ports it.
>
> Everything below is retained for CP3. Do not act on it before then.

## Step 5 — the shell

`D:\fidato crs\src\components\app\` has `AppShell`, `Sidebar`, `TopBar`,
`CommandPalette`, `RoleSwitcher`.

**Port `AppShell`, `Sidebar` and `TopBar` structurally** — the 248px ink-900
rail, `h-14` bars, `size-[18px]` icons, `text-2xs` uppercase section labels,
`max-w-[1600px]` content column, the Cmd-K search affordance. That chrome is the
brand as much as the colours are.

**Do not port the CRS navigation tree.** Reservations / Customers / Companies /
Commissions / Import / Booking register are CRS concerns. The PMS navigation is
in `PHASE-1-FRONTEND.md`, and **Stay View is home**, not a dashboard.

## What must be true when you are done

```js
// every one of these must return the CRS value
getComputedStyle(document.querySelector('.text-success')).color
// must be "rgb(31, 111, 92)"

getComputedStyle(document.querySelector('.bg-grey-200')).backgroundColor
// must be "rgb(226, 229, 232)"

getComputedStyle(document.querySelector('.text-brand-rose')).color
// must be "rgb(219, 83, 106)"
```

These three are the open question from Checkpoint 0. They returned defaults
because nothing in your source used them yet. The ported page uses every token,
so **this is where it gets settled.** If any of the three is still wrong after
the port, the `@theme` block is not exposing the full ramp — that is a real
defect. Report it; do not work around it.

Then, side by side in two browser windows:

- `app.fidatohotels.com/design-system`
- `localhost:5174/design-system`

**They should be indistinguishable** apart from the property names, the room
counts, the number seven, and the added PMS tone section.

## Report

Use the `PHASE-1-FRONTEND.md` §9 format, including `What I saw in the browser`.
Add:

```
Ported        files copied, and whether verbatim
Edited        every change made to ported code, and why
Not ported    what you left behind, and why
Token proof   the three getComputedStyle outputs, pasted raw
```

**Any edit to ported code that is not one of the three in Step 3, or the four in
Step 4, must be listed and justified.** An unlisted edit is drift, and drift is
the entire thing this checkpoint exists to prevent.

## One thing to be honest about

If a ported component genuinely does not fit the PMS — a real conflict, not a
preference — **say so and stop.** Do not quietly rewrite it. The CRS is in
production; if a primitive is wrong for the PMS, it may be worth fixing in both,
and that is a decision above your level and mine.
