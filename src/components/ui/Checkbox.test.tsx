import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Checkbox } from "./Misc";

/* A box a screen reader cannot name is a box only a sighted person can use. */
describe("a checkbox says what it ticks", () => {
  it("is named by its own label", () => {
    render(<Checkbox label="Flag as VIP" checked={false} />);
    expect(screen.getByRole("checkbox", { name: "Flag as VIP" })).toBeTruthy();
  });

  it("is named by a label beside it, through its id", () => {
    render(<><label htmlFor="send-closed">Send unpriced dates as closed</label><Checkbox id="send-closed" /></>);
    expect(screen.getByRole("checkbox", { name: "Send unpriced dates as closed" })).toBeTruthy();
  });

  it("is named by aria-label where no words are shown", () => {
    render(<Checkbox aria-label="Select room 101" />);
    expect(screen.getByRole("checkbox", { name: "Select room 101" })).toBeTruthy();
  });

  it("is named by a label wrapped round it", () => {
    render(<label><Checkbox /><span>Take room 308 out of service too</span></label>);
    expect(screen.getByRole("checkbox", { name: "Take room 308 out of service too" })).toBeTruthy();
  });
});
