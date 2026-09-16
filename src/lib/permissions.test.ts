import { describe, it, expect } from "vitest";
import {
  RATE_SETTER_ROLES, setsRates, grantsFor, canAccess, ASSIGNABLE_ROLES,
  type Resource,
} from "./permissions";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S DECISIONS, PINNED — 16 September 2026

   Who may set a price, and what the Revenue Manager may and may not
   touch. Both were decided by the owner in words, and both are easy to
   widen by accident: one grant added to one role in a long matrix, and
   a person who was never meant to could move every price the booking
   sites show. These tests are the decisions, so changing one is a
   conversation with the owner first and an edit here second.
   ══════════════════════════════════════════════════════════════════ */

describe("who may set a price", () => {
  it("is exactly the owner, admin, GM and revenue manager", () => {
    expect([...RATE_SETTER_ROLES].sort()).toEqual(
      ["admin", "gm", "owner", "revenue_manager"].sort(),
    );
  });

  it("is read from the matrix, so the menu and a route can never disagree", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(setsRates(role), role).toBe(grantsFor(role, "rate").includes("edit"));
    }
  });

  it("does not include reception, the hotel manager or the accountant", () => {
    expect(setsRates("front_desk")).toBe(false);
    expect(setsRates("hotel_manager")).toBe(false);
    expect(setsRates("finance")).toBe(false);
  });
});

describe("the revenue manager", () => {
  it("is a role a person can be given", () => {
    expect(ASSIGNABLE_ROLES).toContain("revenue_manager");
  });

  it("CAN set prices and restrictions, and see what is being sold", () => {
    expect(grantsFor("revenue_manager", "rate")).toEqual(
      expect.arrayContaining(["view", "create", "edit"]));
    expect(grantsFor("revenue_manager", "inventory")).toEqual(
      expect.arrayContaining(["view", "edit"]));
    for (const r of ["reservation", "report", "commission", "dashboard"] as Resource[]) {
      expect(canAccess("revenue_manager", r), `should see ${r}`).toBe(true);
    }
  });

  it("CANNOT touch money taken, guests, staff or roles", () => {
    for (const r of ["invoice", "payment", "customer", "user", "audit_log"] as Resource[]) {
      expect(canAccess("revenue_manager", r), `must not reach ${r}`).toBe(false);
    }
  });

  it("CANNOT change bookings or set up rooms — it only reads them", () => {
    expect(grantsFor("revenue_manager", "reservation")).toEqual(["view"]);
    expect(grantsFor("revenue_manager", "room_config")).toEqual(["view"]);
  });
});
