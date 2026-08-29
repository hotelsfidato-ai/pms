import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

/* ══════════════════════════════════════════════════════════════════
   BUTTONS UNDER A THUMB

   Found by measuring, not by looking. The invoices screen at 375px
   rendered sixty "Issue" buttons — the page's primary action — at
   32px tall. Nothing looked wrong in a screenshot; the number is what
   said so. 44px is the smallest target a finger hits reliably.

   jsdom has no layout and no media queries, so this cannot assert the
   rendered height — that was checked in a real browser, where coarse
   gives 44 and fine gives 32. What a test CAN hold is the rule: every
   size a caller can ask for reaches 44px under a coarse pointer,
   either by carrying the touch minimum or by already being tall
   enough. A new size added without one is the failure this catches.
   ══════════════════════════════════════════════════════════════════ */

const SIZES = ["sm", "md", "lg", "icon"] as const;

describe("touch targets", () => {
  it.each(SIZES)("%s reaches 44px under a coarse pointer", (size) => {
    render(<Button size={size}>Issue</Button>);
    const cls = screen.getByRole("button").className;

    /* h-11 is 2.75rem — 44px. A size already that tall needs no
       variant; anything shorter must grow when a finger arrives. */
    const alreadyTall = /\bh-11\b/.test(cls);
    const growsOnTouch = /\bpointer-coarse:min-h-11\b/.test(cls);

    expect(
      alreadyTall || growsOnTouch,
      `size "${size}" is under 44px on a phone and does not grow: ${cls}`,
    ).toBe(true);
  });

  it("keeps desktop density — it does not just make every button tall", () => {
    render(<Button size="sm">Issue</Button>);
    const cls = screen.getByRole("button").className;
    /* The point of the pointer variant is that the desktop row stays
       dense. If sm ever becomes unconditionally 44px this fails, and
       whoever did it has to say so on purpose. */
    expect(cls).toMatch(/\bh-8\b/);
  });
});
