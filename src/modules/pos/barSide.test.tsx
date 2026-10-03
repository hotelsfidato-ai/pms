import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { isBarDish, type MenuCategory, type MenuItem } from "@/modules/pos/data/till";
import { DishDialog } from "@/modules/pos/flows/DishDialog";

/* ══════════════════════════════════════════════════════════════════
   THE BAR SIDE OF THE MENU (D27-267)

   A section sold under Bar or Alcohol is the Bar side: its drinks get the
   bar's notes (Neat, On the rocks...), not the kitchen's (Crispy...).
   ══════════════════════════════════════════════════════════════════ */

const dish = (id: string, name: string): MenuItem => ({
  id, name, price: 100, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  addonGroups: [], variations: [],
});
const section = (id: string, taxKind: MenuCategory["taxKind"], items: MenuItem[]): MenuCategory =>
  ({ id, name: id, taxKind, prepMinutes: null, course: null, items });

const MENU = [
  section("Snacks", "restaurant", [dish("i-1", "Pohe")]),
  section("Brandy", "alcohol", [dish("i-2", "Doctor Brandy")]),
  section("Mocktails", "bar", [dish("i-3", "Virgin Mojito")]),
  section("Unset", null, [dish("i-4", "Tea")]),
];

describe("the bar side", () => {
  it("is every section under Bar or Alcohol, and nothing else", () => {
    expect(isBarDish(MENU, "i-2")).toBe(true);
    expect(isBarDish(MENU, "i-3")).toBe(true);
    expect(isBarDish(MENU, "i-1")).toBe(false);
    expect(isBarDish(MENU, "i-4")).toBe(false);
    expect(isBarDish(MENU, undefined)).toBe(false);
  });

  it("gives a drink the bar's notes, and food the kitchen's", () => {
    const { unmount } = render(
      <DishDialog item={MENU[1]!.items[0]!} bar open onOpenChange={() => {}} onAdd={() => {}} />);
    expect(screen.getByText("Note for the bar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "On the rocks" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crispy" })).toBeNull();
    unmount();

    render(<DishDialog item={MENU[0]!.items[0]!} open onOpenChange={() => {}} onAdd={() => {}} />);
    expect(screen.getByText("Note for the kitchen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crispy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neat" })).toBeNull();
  });
});
