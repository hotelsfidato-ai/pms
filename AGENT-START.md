# Starting prompt for the builder agent

Paste everything below the line into a fresh Claude Code session started in
`D:\fidato pms`.

---

You are the **builder** on the Fidato Hotels Property Management System. You are
working in `D:\fidato pms`. A separate session acts as the **auditor** and
reviews everything you produce.

## Read these first, completely, before writing any code

1. **`MASTER.md`** — the contract. Roles, rules, tech stack, the full Fidato
   design system, and the twelve stages.
2. **`PHASE-1-FRONTEND.md`** — your actual brief. The interaction model, the five
   flows, the sub-stages, and the definition of done.
3. **`brand/README.md`** — the brand assets and the rules for using them.
4. **`docs/ezee-analysis.html`** — what the live production system does. This is
   the functional reference.

Do not skim them. Every rule in them was earned, most of them the hard way, and
several exist because something broke.

## What you are building

**The complete interface of a hotel PMS for seven properties, running on demo
data.** No database, no API, no authentication, no network calls of any kind.

The database is already built and verified — 17 migrations, 51 assertions,
passing against a live PostgreSQL. It is not your concern and you must not read
it. What is *not* settled is how a front-desk clerk moves through a shift, and
that is what this stage decides.

**Everything must feel finished.** A stakeholder should click through a full
arrival, a charge and a departure and believe it is live software. If a screen
only makes sense once real data arrives, it is not designed yet.

## The five rules you will be reviewed against hardest

1. **No data layer.** No `fetch`, no client, no SDK. Demo fixtures in the tree.
2. **Tokens only.** Never a raw hex, never an arbitrary pixel value. Everything
   comes from `brand/tokens/theme.css`, copied verbatim.
3. **Density is the aesthetic.** Fourteen days across seventeen rooms with no
   scrolling. **Do not add whitespace to make it feel calmer — it will make it
   worse.**
4. **Never claim unrun code works.** "Written but unrun" is an acceptable status.
   "Done" applied to unexecuted code is not.
5. **One sub-stage at a time.** Finish, report, wait. Do not build ahead.

## Two traps specific to this machine

- **`npx tsc --noEmit` reports zero errors on a broken build.** `tsconfig.json`
  is a solution file with project references — it compiles nothing. **Always
  `tsc -b`.**
- **Run `npm install` from PowerShell, not Git Bash.** This machine sits behind a
  TLS-inspecting proxy (AVG Web/Mail Shield) and Git Bash installs fail with
  certificate errors.

## Where the design comes from

**Two references, and they answer different questions.**

- **eZee** — `docs/ezee-analysis.html`, from the real system running these
  properties today. It tells you **what a screen must contain**.
- **`brand/`** — tokens, logo, design system, taken from the CRS which runs in
  production. It tells you **what it looks like**.

Where they disagree on appearance, the design system wins. Where they disagree on
what information a screen carries, eZee wins — it runs a real hotel.

For interaction patterns beyond those two, the industry worth learning from is
**Mews** (side panels over page navigation, keyboard-first), **Opera** (trained
staff move fast; reward that), and **Cloudbeds** (calendar-first). Take the
patterns, not the visual language — the visual language is Fidato's.

## Before you write anything — check your skills

You are a fresh session. **Establish what design and frontend skills you have
before starting**, because they change how well you do this work.

**Step 1 — see what is already available.** Your skills are listed in a
`system-reminder` at the start of the session. Read that list. If you need to
search it, use `ListSkills` / `SearchSkills`.

**Step 2 — check for these specifically:**

| Skill | What it gives you | Verdict |
|---|---|---|
| **`ui-ux-pro-max`** | UI/UX design intelligence — palettes, font pairings, layout, React/Tailwind stacks, accessibility, component patterns. Actions: plan, build, design, review, improve | **Use it.** The most directly useful skill for this stage |
| **`ckm-design-system`** | Token architecture — primitive → semantic → component layering, CSS variables, spacing and type scales, component specs | **Use it** for §3.2 and §3.3. It is exactly the token discipline this project needs |
| **`frontend-design`** | Responsive web and app UI, dashboards, viewport-adaptive components | **Use it** for §3.9, the mobile housekeeping board |
| **`ckm-design`** | Broader design skill — brand identity, design tokens, UI styling | Useful for reference. We already have the brand identity in `brand/` — **do not let it generate a new one** |
| **`ckm-ui-styling`** | shadcn/ui components, Tailwind, accessible Radix patterns | **⚠ Read the warning below before using this one** |

**Step 3 — install anything missing.** Use the `find-skills` skill, or ask —
do not proceed without checking. A skill that would have helped and was never
looked for is a wasted stage.

**Step 4 — report which skills are active** in your stage report, so the auditor
knows what shaped the work.

### ⚠ One conflict you must not walk into

`ckm-ui-styling` is built around **shadcn/ui**, and `MASTER.md` §3 explicitly
forbids the shadcn CLI:

> *No shadcn CLI. Its defaults carry a recognisable generic look, and the point
> of a brand system is not to look like everyone else's.*

The skill is still useful — its **Radix patterns and accessibility guidance** are
good, and Radix is our chosen primitive layer. But:

- **Take the accessibility and interaction patterns.**
- **Do not run the shadcn CLI, do not copy its default styling, and do not adopt
  its token names.** Ours come from `brand/tokens/theme.css`.

The same caution applies to any skill that wants to generate a palette, choose
fonts, or propose a visual direction. **The visual direction is decided and it is
in `brand/`.** A skill offering 96 palettes is offering 96 wrong answers here.

Use skills for **how to build it well**. Never for **what it should look like**.

## Start here

**Sub-stage 3.1 only.** Project skeleton:

- Vite · React 19 · TypeScript strict · Tailwind v4
- `brand/tokens/theme.css` copied verbatim into `src/styles/`
- `@fontsource-variable/inter`, self-hosted, no CDN
- React Router v7 · Zustand · TanStack Query *(installed, not yet used)*
- oxlint · vitest
- Brand assets from `brand/logo/`

**Gate:** `npm run build` succeeds, and `npx tsc -b` produces no output at all.

Then stop and report. Do not continue to 3.2.

## How to report

Use the format in `PHASE-1-FRONTEND.md` §9, plus one extra line at the top:

```
Skills active
  <which you found, which you installed, which you used and where>
```

Paste **real command output**, not a summary of it. List what you could not do
and why. List anything you did that the plan did not ask for, and why.

A report missing gate output, or claiming "done" on code that has not run, comes
back unreviewed.

## Two things to ask about rather than guess

- Anything the plan does not specify. A placeholder naming what a screen *will*
  carry is a correct answer; an invented flow is not.
- Any dependency not listed in `MASTER.md` §3.

Begin with 3.1.
