import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MenuItem } from "@/modules/pos/data/till";
import { DishDialog } from "@/modules/pos/flows/DishDialog";
import { unitPriceOf, chosenLabels } from "@/modules/pos/lib/pricing";

/* ══════════════════════════════════════════════════════════════════
   THE WAITER'S ONE POP-UP, FOR A DISH WITH SEVERAL TYPES (D27-192)

   Pizza: Size (Regular ₹200 / Large ₹400) and Crust (Cheese burst +₹80 /
   Regular Free) - "Regular" in both (D27-195). A row per type under its
   heading; Add waits for one of each; the first is the price, the rest
   add. The server's half is api/test/modules/pos/variationTypes.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const PIZZA: MenuItem = {
  id: "i-9", name: "Pizza", price: 1, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  addonGroups: [],
  variations: [
    { id: "s-1", label: "Regular", price: 200, typeNo: 1, kind: "size", heading: null },
    { id: "s-2", label: "Large", price: 400, typeNo: 1, kind: "size", heading: null },
    { id: "c-1", label: "Cheese burst", price: 80, typeNo: 2, kind: "option", heading: "Crust" },
    { id: "c-2", label: "Regular", price: 0, typeNo: 2, kind: "option", heading: "Crust" },
  ],
};

describe("the dish pop-up with two types", () => {
  it("asks one of each, reads +₹ and Free, and sends the crust as a further choice", () => {
    const onAdd = vi.fn();
    render(<DishDialog item={PIZZA} open onOpenChange={() => {}} onAdd={onAdd} />);

    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.getByText("Crust")).toBeTruthy();
    const add = screen.getByRole("button", { name: "Add" });

    fireEvent.click(screen.getByRole("button", { name: /Large/ }));
    expect(add.hasAttribute("disabled"), "added with no crust").toBe(true);
    expect(screen.getByRole("button", { name: /Cheese burst/ }).textContent).toContain("+₹80");
    expect(screen.getAllByRole("button", { name: /Regular/ })[1]!.textContent).toContain("Free");

    fireEvent.click(screen.getByRole("button", { name: /Cheese burst/ }));
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith("i-9", 1, "", "s-2", undefined, ["c-1"]);
  });

  it("prices first + added, and names every choice in type order", () => {
    expect(unitPriceOf(PIZZA, "s-2", [], ["c-1"])).toBe(480);
    expect(unitPriceOf(PIZZA, "s-2", [], ["c-2"])).toBe(400);
    expect(chosenLabels(PIZZA, "s-2", [], ["c-1"]).variationLabel).toBe("Large, Cheese burst");
  });
});
