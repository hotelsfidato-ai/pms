# CP2 audit — not yet complete. Two demo defects, one real a11y bug, one open question.

Paste everything below the line to the builder agent.

---

**Good work on the corrections. Three things are wrong and one needs a human.**

## What passed

**Library still untouched** — 13 of 15 byte-identical, only `PageHeader.tsx` and
`StatusPill.tsx` differing. You corrected demo data without touching a ported
file. That is the discipline holding.

**Page renders** — 11 sections, `h1` correct, 50 focusable elements.

**Demo data corrected** — `Superior` and `Deluxe` present, placeholders gone,
combobox repointed to meal plans (`EP` · `CP` · `MAP`). A `Room Type` column was
added to the table, which the brief did not ask for and which is right.

**Money is correct** — `₹1,28,400` renders with Indian grouping straight from
`money()`. Nothing to change.

**`docs/DECISIONS.md` is genuinely good.** Four entries, each with reason and
impact, including the provider-hoisting note flagged as temporary. Keep it up.

---

## D2 · Pagination contradicts the table — visible defect

```
table rows shown : 2
pagination reads : "1–3 of 9"
```

You removed the third demo row rather than renaming it. My instruction said
remove `Property Two` and `Property Three` — I meant the placeholder **names**,
not the rows. Badly worded on my part.

**Restore the third row.** All three carry the same property now, which is
correct and expected under the single-property decision:

```
FH-2607-4823 · Priya Menon · 5 Elements Akkalkot · Superior · cancelled · ₹41,200
```

Then make the pagination label agree with what is on screen.

## D3 · The `cancelled` tone is no longer demonstrated in a table

Same cause. The table now shows only `confirmed` and `pending`. The CRS page
deliberately showed all three in a live row, because a status pill inside a dense
table is where tone problems actually surface — not in a row of loose pills.

Restoring the third row fixes this too.

---

## A1 · Checkbox and Switch have no accessible name — CONFIRMED, and it is a CRS bug

This is not a probe result. It is the browser's own accessibility tree:

```
textbox  "Ananya Bose"   ← named
textbox  "Required"      ← named
tab      "Month"         ← named
button   "Combobox"      ← named

checkbox [ref_5]         ← NO NAME
checkbox [ref_6]         ← NO NAME
checkbox [ref_7]         ← NO NAME
switch   [ref_8]         ← NO NAME
```

A screen reader announces *"checkbox, not checked"* with no indication of what it
controls. "Flag as VIP" is invisible to it.

**Cause.** `Misc.tsx` wraps the control in a `<label>`:

```tsx
<label className="flex items-center gap-2.5 …">
  {control}
  <span className="text-base text-ink-900">{label}</span>
</label>
```

Radix renders `CheckboxPrimitive.Root` as `<button role="checkbox">`. The ARIA
role override means the implicit `<label>` association does **not** produce an
accessible name. The visible text is decorative to assistive technology.

**Do not fix this yourself.** `Misc.tsx` is byte-identical to the CRS file
running in production — the same bug is live there, on every checkbox and switch
in the whole product.

**Report it, stop, and wait.** This is the case my instruction anticipated: a
ported primitive that genuinely fails, where the fix belongs in both trees. It
needs a decision above both of us.

For your report, the likely fix is `aria-label={label}` or `aria-labelledby` on
`CheckboxPrimitive.Root` when `label` is a string. **Propose it. Do not apply
it.**

---

## A2 · Focus rings — I could not verify this, and I am not going to pretend I did

**What I established from source, which is solid:**

```
focus:ring-brand-orange/20   5×      focus:outline-none      5×
focus:border-brand-orange    5×      focus:ring-2            5×
focus:ring-brand-red/20      4×      focus:border-brand-red  4×
focus:bg-grey-50 / grey-100  1× each
```

All eight utilities sit on the five input-type components — `Input`, `Textarea`,
`NativeSelect`, `Combobox`, `DatePicker`. Two facts follow:

1. **`Button.tsx` has no focus styling at all.** Neither do `Checkbox`, `Switch`,
   `Tabs`, or `Pagination`. They fall back to the browser default outline.
2. **Nothing anywhere uses `focus-visible:`.** Every focus style is plain
   `:focus`, so a mouse click paints the same ring as a keyboard tab.

**What I could not establish.** Whether the rings actually paint. Programmatic
`.focus()` in this environment reports `outlineStyle: none, boxShadow: none` even
on an `Input` that demonstrably carries `focus:ring-2 focus:border-brand-orange`
— so the measurement is wrong, not the component. Screenshots are unavailable to
me here.

**This one needs a human at the keyboard.** Press Tab from the top of the page
and answer three questions:

- Is there a visible ring on **buttons**, or only on inputs?
- Is the ring the brand ring, or the browser's default blue?
- Does clicking an input with the mouse paint the same ring as tabbing to it?

If buttons have no visible ring, that is a real defect — and again a **CRS bug**,
not yours to fix. Report it the same way as A1.

I would rather hand you an honest "unverified" than a confident wrong number. I
made that mistake at CP0 with the token probe and it cost a round trip.

---

## To clear CP2

1. Restore the third demo row and reconcile the pagination label
2. Report A1 with your proposed fix — **do not apply it**
3. Answer A2 at the keyboard and report what you saw
4. Complete the remaining CP2 items: narrow-viewport icon-only labels, and every
   primitive in every state

```
Keyboard pass    buttons: ring or no ring? brand or browser default? click vs tab?
Narrow viewport  which controls collapse to icon-only, and are they named
States covered   any primitive still missing a state on the page
CRS bugs found   A1 confirmed · A2 pending your keyboard check · anything else
Library touched  MUST be "none"
```

**Only `src/pages/DesignSystem.tsx` may be edited.** Two confirmed library
defects are exactly why that rule exists — finding them is the win, fixing them
here silently would be the loss.
