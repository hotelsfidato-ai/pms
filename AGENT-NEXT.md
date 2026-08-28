# Instructions — 3.1 returned, fix and resubmit

Paste everything below the line to the builder agent.

---

**Sub-stage 3.1 is REJECTED. Do not start 3.2.**

The gates you reported did pass. The application is still broken. I verified it
against your running dev server at `localhost:5174` and read the computed styles
from the live page.

## What is actually happening

```
.flex          → display: block          (should be flex)
.min-h-screen  → min-height: 0px         (should be 100vh)
.bg-grey-50    → rgba(0,0,0,0)           (should be #f7f8f9)
.text-xl       → 16px                    (should be 20px)
.text-ink-900  → rgb(0,0,0)              (should be #031728)
font-family    → "Times New Roman"       (should be Inter Variable)

Total CSS rules ............ 26
Tailwind utility rules ...... 0
--color-brand-orange ........ ""   (empty — never registered)
--color-ink-900 ............. ""   (empty — never registered)
```

**Every `className` in `App.tsx` is inert.** The page is unstyled HTML in a
serif font. The 29 KB of built CSS is entirely `@font-face` declarations for
Inter — which nothing references, so the browser falls back to Times.

## Root cause

`@tailwindcss/vite` is not installed and not in `vite.config.ts`.

In Tailwind v4 that plugin is what processes `@import "tailwindcss"` and the
`@theme` block. Without it the import silently resolves to nothing, no utilities
are generated, and the design tokens never reach the document.

## Fix — four items

**1 · Wire Tailwind**

```bash
npm install -D @tailwindcss/vite
```

Run this **from PowerShell, not Git Bash**. This machine sits behind a
TLS-inspecting proxy and Git Bash installs fail with certificate errors.

```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ...
})
```

**2 · Install the missing stack** — both are in `MASTER.md` §3 and both are
absent:

```bash
npm install react-hook-form zod
```

**3 · Pin Recharts to v3**

```bash
npm install recharts@^3
```

`recharts@2.x` predates React 19 and has known peer issues. The CRS runs
`^3.10.1` in production on React 19. Fix it now, while nothing depends on it.

**4 · Create `docs/DECISIONS.md`** — required by `MASTER.md` and missing. Record
every judgement call that would be expensive to re-derive. Start it with the
Recharts pin above.

## Prove it before you resubmit

Rebuild, reload `localhost:5174`, open the browser console and run:

```js
getComputedStyle(document.querySelector('.flex')).display
// must return "flex"

getComputedStyle(document.querySelector('h1')).fontSize
// must return "20px"

getComputedStyle(document.documentElement).getPropertyValue('--color-ink-900').trim()
// must return "#031728"

getComputedStyle(document.querySelector('h1')).fontFamily
// must contain "Inter"
```

**Paste all four outputs into your report.** If any is wrong, it is not fixed.

## The process change, from now on

Your report said the gates passed and they did. `tsc -b` type-checks.
`vite build` bundles. `vitest` asserts text is present in the DOM.

**None of them can see whether a style applied.** That is not a gap in the
tooling — it is why rule 9 of the definition of done says to look at the
rendered screen. Thirty seconds in a browser would have caught this.

**From 3.2 onward, every sub-stage report must include a section headed
`What I saw in the browser`** describing what you actually observed on the
running page — not what the commands printed. A report without it is returned
unread.

## What to do now

1. Apply the four fixes
2. Run the four verification commands and capture the output
3. Report using the full `PHASE-1-FRONTEND.md` §9 format — every section, including
   the `Skills active` line and `What I saw in the browser`
4. **Stop. Do not start 3.2.** It will be cleared once 3.1 is verified.

## What is coming next, so you can prepare

3.2 is **`/design-system`** — a page rendering every token and every primitive
from the real modules, so it cannot drift from the product. It is built second,
not last, because it is how both of us check the design system for the rest of
the stage.

Do not start it. Read `PHASE-1-FRONTEND.md` §3.2 and `brand/tokens/design-system.md`
so you are ready when it is cleared.
