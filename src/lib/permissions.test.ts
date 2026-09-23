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

  it("CANNOT change bookings or set up rooms - it only reads them", () => {
    expect(grantsFor("revenue_manager", "reservation")).toEqual(["view"]);
    expect(grantsFor("revenue_manager", "room_config")).toEqual(["view"]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S ANSWERS OF 22 SEPTEMBER (docs/briefs/decisions-2026-09-22.md)

   In the matrix itself - the server asks the same grants (roleGate.ts), so
   each line here is a menu and a refusal at once.
   ══════════════════════════════════════════════════════════════════ */

const holders = (action: "create" | "edit" | "approve", resource: Resource) =>
  ASSIGNABLE_ROLES.filter((role) => grantsFor(role, resource).includes(action)).sort();

describe("the owner's answers of 22 September", () => {
  it("D22-30: the GM creates and edits room setup, with the owner and an administrator", () => {
    expect(holders("create", "room_config")).toEqual(["admin", "gm", "owner"]);
    expect(holders("edit", "room_config")).toEqual(["admin", "gm", "owner"]);
  });

  it("D22-30: an administrator and the GM edit commission", () => {
    expect(holders("edit", "commission")).toEqual(["admin", "gm", "owner"]);
  });

  it("D22-33: a credit note (approve, on an invoice) is the owner's, admin's, GM's and accountant's", () => {
    expect(holders("approve", "invoice")).toEqual(["admin", "finance", "gm", "owner"]);
    /* Reception and the hotel manager still change a bill. */
    expect(grantsFor("front_desk", "invoice")).toContain("edit");
    expect(grantsFor("hotel_manager", "invoice")).toContain("edit");
  });

  it("D22-35: the menu is the owner's, admin's, GM's and kitchen manager's - never the revenue manager's", () => {
    expect(holders("edit", "menu")).toEqual(["admin", "gm", "kitchen_manager", "owner"]);
    expect(canAccess("revenue_manager", "menu")).toBe(false);
    /* Everybody who could look at the menu through `rate` still can. */
    for (const role of ["hotel_manager", "front_desk", "read_only"] as const) {
      expect(grantsFor(role, "menu"), role).toEqual(["view"]);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   STORE, EQUIPMENT, PURCHASING — the owner's table, 16 September

   Approved row by row (docs/STOCK-AND-EQUIPMENT-PLAN.md). The Store used
   to share room availability's `inventory` grant, so reception could
   change stock, and so could the Viewer (STO-1). Each role below is the
   decision; a change here is a conversation with the owner first.
   ══════════════════════════════════════════════════════════════════ */

describe("the Store, Equipment and Purchasing", () => {
  const TABLE: Record<string, { stock: string[]; equipment: string[]; purchasing: string[] }> = {
    admin:           { stock: ["view", "create", "edit", "approve", "export"],
                       equipment: ["view", "create", "edit", "approve", "export"],
                       purchasing: ["view", "create", "edit", "cancel", "approve", "export"] },
    gm:              { stock: ["view", "create", "edit", "approve", "export"],
                       equipment: ["view", "create", "edit", "approve", "export"],
                       purchasing: ["view", "create", "approve", "export"] },
    hotel_manager:   { stock: ["view", "create", "edit"], equipment: ["view", "create", "edit"],
                       purchasing: ["view", "create"] },
    /* The Inventory Manager: equipment added 16 September (S13) — adds,
       edits, and approves it leaving the store. */
    stores:          { stock: ["view", "create", "edit", "export"],
                       equipment: ["view", "create", "edit", "approve"],
                       purchasing: ["view", "create"] },
    kitchen_manager: { stock: ["view", "create"], equipment: ["view"], purchasing: ["view", "create"] },
    chef:            { stock: ["view"], equipment: ["view"], purchasing: [] },
    housekeeping:    { stock: ["view"], equipment: ["view"], purchasing: [] },
    front_desk:      { stock: [], equipment: ["view"], purchasing: [] },
    finance:         { stock: ["view", "export"], equipment: ["view", "export"],
                       purchasing: ["view", "export"] },
    read_only:       { stock: ["view"], equipment: ["view"], purchasing: ["view"] },
    revenue_manager: { stock: [], equipment: [], purchasing: [] },
    pos:             { stock: [], equipment: [], purchasing: [] },
  };

  for (const [role, want] of Object.entries(TABLE)) {
    it(`gives ${role} exactly what the owner approved`, () => {
      for (const resource of ["stock", "equipment", "purchasing"] as const) {
        expect([...grantsFor(role as never, resource)].sort(), `${role} · ${resource}`)
          .toEqual([...want[resource]].sort());
      }
    });
  }

  it("covers every role a person can be given, so a new role cannot slip past", () => {
    expect(Object.keys(TABLE).sort()).toEqual(
      [...ASSIGNABLE_ROLES].filter((r) => r !== "owner").sort());
  });

  /* THE MATRIX ONLY. Opened on 16 September as reception, /h/5EL/stores still
     loaded: the Store's route has no RequireAccess and its server routes check
     no grant, so STO-1 is NOT closed by this table. The Store closes it in
     phase 1A — the route guard and the server refusal read these grants. */
  it("no longer GRANTS the Viewer or reception stock changes - the matrix, not yet the door", () => {
    expect(grantsFor("read_only", "stock")).not.toContain("create");
    expect(grantsFor("read_only", "stock")).not.toContain("edit");
    expect(canAccess("front_desk", "stock")).toBe(false);
  });

  it("never lets anybody delete stock - it is a ledger", () => {
    for (const role of ASSIGNABLE_ROLES.filter((r) => r !== "owner")) {
      expect(grantsFor(role, "stock"), role).not.toContain("delete");
    }
  });
});
