# Checkpoint 1 — audit result: PORT ACCEPTED, CHECKPOINT REJECTED

Paste everything below the line to the builder agent.

---

**The port is excellent. The page does not render. Checkpoint 1 is not complete.**

Both of those are true and they are not in tension. Read the first part before
the second — the work you did was right, and it should not be redone.

## What passed — verified by MD5, not by reading

Fifteen library files plus `cn.ts` and `format.ts`. **Thirteen of fifteen are
byte-identical to the CRS origin:**

```
Button · Card · Combobox · DataTable · DatePicker · FilterBar · Input
Misc · Overlays · States · Toast · describeError.test · index      IDENTICAL
cn.ts · format.ts                                                   IDENTICAL

PageHeader.tsx · StatusPill.tsx                                     differ
```

**Exactly the two files authorised to differ, and nothing else.** That is a
clean port. I diffed both:

- `PageHeader.tsx` — one line, `react-router-dom` becomes `react-router`. Step 3a, correct.
- `StatusPill.tsx` — append-only. Four tone maps, every value mapped onto the
  existing `Tone` vocabulary, **no eleventh colour invented**, CRS sets left in
  place with a comment explaining why. Step 3c, correct.

The design system page carries the four authorised edits and the PMS tone
section. No unauthorised change anywhere.

**You did not touch what you were told not to touch. Keep working this way.**

## What failed — the page is blank

```
GET localhost:5174/design-system
  rootChildren : 0
  rootHTML     : ""
  visibleText  : "(EMPTY PAGE)"
```

Console:

```
Error: `Tooltip` must be used within `TooltipProvider`
An error occurred in the <Tooltip> component.
```

`tsc -b` exits 0 with no output. **The gates are green and the screen is white.**

This is the same failure as sub-stage 3.1. Not the same cause — the same
*method*. A report of "COMPLETE ✅" was written for a page that was never opened.

### F1 · `TooltipProvider` is not mounted — BLOCKER

`DesignSystem.tsx:487` renders a `Tooltip`. Radix requires a provider above it.
In the CRS that provider lives in `AppShell.tsx:35`:

```tsx
<TooltipProvider delayDuration={400}>
```

You correctly did **not** port `AppShell` — it is Checkpoint 3. So the provider
came with a file you were right to leave behind. **This one is my fault, not
yours**: `AGENT-PORT-UI.md` Step 5 told you to port the shell, which contradicts
the checkpoint order. Ignore that step. It is withdrawn.

### F2 · `<Toaster />` is not mounted

`grep` across `src/` outside `components/ui/`: **neither `TooltipProvider` nor
`Toaster` appears anywhere.**

The four toast buttons on the page will render and do nothing — no error, no
toast. Currently masked by F1, and it would have shipped as a dead control.

## The fix — five lines in `App.tsx`

Do not port `AppShell`. Mount the two providers the primitives require, and
nothing else:

```tsx
import { TooltipProvider, Toaster } from '@/components/ui'

function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <BrowserRouter>
        <Routes>
          {/* unchanged */}
        </Routes>
      </BrowserRouter>
      <Toaster />
    </TooltipProvider>
  )
}
```

`delayDuration={400}` is the CRS value. Match it — tooltip timing is part of the
design system.

Record in `docs/DECISIONS.md`: *providers hoisted to `App` at CP1 because the
primitives need them; they move into `AppShell` at CP3.*

## D1 · The demo data reads as broken

The property combobox now lists **the same property three times**:

```
5 Elements Akkalkot · Akkalkot · 17 rooms
5 Elements Akkalkot · Akkalkot · 17 rooms
5 Elements Akkalkot · Akkalkot · 17 rooms
```

All three table rows are the same property too.

You were obeying an instruction — do not invent property names — and you obeyed
it honestly. The instruction was badly worded and this is the result. A
stakeholder seeing a property picker with three identical entries reads it as a
bug, and they are right.

**Do not invent names to fix it.** The six other property names are being
sourced. Until they arrive, make the placeholder obviously a placeholder:

```
5 Elements Akkalkot   Akkalkot · 17 rooms
Property Two          awaiting confirmation
Property Three        awaiting confirmation
```

Honest, clearly unfinished, and it demonstrates the component. Swap in the real
names when they land.

## Still unresolved — the Checkpoint 0 carry-over

```
--color-ink-900     #031728    PASS
--color-brand-orange #df6128   PASS
--color-success     #1f6f5c    PASS
--color-grey-50     #f7f8f9    PASS
```

CP1's own assertion passes. But the three utilities carried over from CP0 —
`text-success`, `text-brand-rose`, `bg-grey-200` — **still cannot be checked,
because there is no rendered page to check them against.**

Once the page renders, run this and paste the raw output:

```js
[...document.querySelectorAll('*')].some(e => e.className?.toString?.().includes('text-success'))
// then, on a real element carrying each class:
getComputedStyle(document.querySelector('.text-success')).color          // rgb(31, 111, 92)
getComputedStyle(document.querySelector('.bg-grey-200')).backgroundColor // rgb(226, 229, 232)
getComputedStyle(document.querySelector('.text-brand-rose')).color       // rgb(219, 83, 106)
```

If a class genuinely appears nowhere on the page, say so — that is a real
answer. Do not inject the class at runtime to test it: Tailwind v4 generates
utilities by scanning source, so a runtime-injected class proves nothing. I made
that mistake at CP0 and it produced a false alarm.

## To clear Checkpoint 1

1. Mount `TooltipProvider` and `Toaster` in `App.tsx`
2. Fix the placeholder property names
3. **Open `localhost:5174/design-system` and look at it**
4. Scroll the whole page. Click a toast button. Hover the tooltip.
5. Open it beside `app.fidatohotels.com/design-system` and compare section by section
6. Paste the three token values, raw

## The standard, restated

Rule 8: **never claim unrun code works.** "Rendered and walked" is a claim you
make after looking at the screen. `tsc -b` passing is not evidence a page
renders — it has now failed to catch a blank page twice.

**A report containing "COMPLETE ✅" for a page you did not open comes back
unread.** The `What I saw in the browser` section is not paperwork; it is the
only gate that has ever caught these.

Nothing about the port needs redoing. Fix the two providers, fix the
placeholders, look at the page, and this checkpoint clears.
