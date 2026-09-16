import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input, NativeSelect, Textarea } from "./Input";
import { Dialog, DialogContent } from "./Overlays";

/* ══════════════════════════════════════════════════════════════════
   BOXES AND CLOSE UNDER A THUMB — STO-9, 16 September

   Measured by the Store chat at 375px: every dialog's Close was 24×24,
   every input and select 36px tall with 15px text — and an iPhone zooms
   the page when a box under 16px is tapped. The shared kit, so every
   dialog in the system.

   jsdom has no media queries, so this holds the RULE, as Button.test does:
   under a coarse pointer a box is 44px and 16px, and Close is 44px.
   A mouse keeps the dense desk sizes.
   ══════════════════════════════════════════════════════════════════ */

describe("form boxes under a finger", () => {
  it("an input is 44px tall with 16px text", () => {
    render(<Input aria-label="Name" />);
    const cls = screen.getByRole("textbox").className;
    expect(cls).toMatch(/\bpointer-coarse:h-11\b/);
    expect(cls).toContain("pointer-coarse:text-[16px]");
  });

  it("a select is 44px tall with 16px text", () => {
    render(<NativeSelect aria-label="Unit"><option>kg</option></NativeSelect>);
    const cls = screen.getByRole("combobox").className;
    expect(cls).toMatch(/\bpointer-coarse:h-11\b/);
    expect(cls).toContain("pointer-coarse:text-[16px]");
  });

  it("a text area's text is 16px", () => {
    render(<Textarea aria-label="Note" />);
    expect(screen.getByRole("textbox").className).toContain("pointer-coarse:text-[16px]");
  });

  it("a dialog's Close is 44px: a 16px icon and 14px of padding each side", () => {
    render(
      <Dialog open>
        <DialogContent title="Add an item">body</DialogContent>
      </Dialog>,
    );
    const cls = screen.getByRole("button", { name: "Close" }).className;
    expect(cls).toMatch(/\bpointer-coarse:p-3\.5\b/);
  });
});
