import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { mayReach, flatNavigationFor } from "@/components/app/navigation";
import { ASSIGNABLE_ROLES, canAccess } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { parseCsv } from "@/lib/importSpec";
import { HOTEL, AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import { EQUIPMENT_SPEC } from "@/modules/equipment/importSpec";
import { costText, endsText, heldText, whoMay } from "@/modules/equipment/words";

/* ══════════════════════════════════════════════════════════════════
   EQUIPMENT — the screen's half

   Who reaches the register, what its words say about figures nobody
   typed, and that the import template reads back as itself. The
   server's half — every role refused at every door, and what the
   register records — is api/test/modules/equipment/.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

describe("who reaches the register", () => {
  it("is everybody holding a grant on equipment, and nobody else", () => {
    for (const role of ASSIGNABLE_ROLES) {
      const may = canAccess(role, "equipment");
      expect(mayReach(role, "/h/:code/equipment"), `${role} and the register`).toBe(may);
      const paths = flatNavigationFor(role, HOTEL).map((i) => i.to);
      expect(paths.includes(`/h/${HOTEL}/equipment`), `${role} finds Equipment`).toBe(may);
    }
    /* The two the owner's table leaves out, named, so a change to the
       table is read here as well as in permissions.test.ts. */
    expect(canAccess("revenue_manager", "equipment")).toBe(false);
    expect(canAccess("pos", "equipment")).toBe(false);
  });

  it("refuses the register to a revenue manager who types the address", async () => {
    go(`/h/${HOTEL}/equipment`);
    signedIn({
      scope: {
        staffId: "44444444-4444-4444-4444-444444444444",
        email: "revenue@fidato.in",
        fullName: "Agra Revenue",
        isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role: "revenue_manager" }],
      },
    });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /not part of your role/i }),
      "the register rendered for a revenue manager",
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^equipment$/i })).toBeNull();
  });

  it("opens for reception to read, with adding shown blocked and why (Rule 6)", async () => {
    go(`/h/${HOTEL}/equipment`);
    signedIn();                         // the default identity is a clerk
    render(<App />);

    expect(await screen.findByRole("heading", { name: /^equipment$/i })).toBeDefined();
    const add = screen.getByRole("button", { name: /add an item/i });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/adding and changing equipment is for the/i)).toBeDefined();
  });
});

describe("the register's words", () => {
  const tagged = { heldAs: "tagged" as const, tag: "EQ-0007", quantity: 1 };
  const counted = { heldAs: "counted" as const, tag: null, quantity: 12 };

  it("prints a dash for a cost nobody typed - never ₹0", () => {
    expect(costText({ ...tagged, unitCost: null, totalCost: null })).toBe("-");
    expect(costText({ ...counted, unitCost: null, totalCost: null })).toBe("-");
    expect(costText({ ...counted, unitCost: 1200, totalCost: 14400 })).toMatch(/14,400.*1,200 each/);
    /* A cost somebody DID type as nothing is a fact, not a gap. */
    expect(costText({ ...tagged, unitCost: 0, totalCost: 0 })).not.toBe("-");
  });

  it("prints a dash for a warranty nobody entered - never expired", () => {
    expect(endsText(null, "2026-08-25")).toBe("-");
    expect(endsText("2027-03-31", "2026-08-25")).not.toMatch(/ended/);
    expect(endsText("2026-03-31", "2026-08-25")).toMatch(/^ended /);
  });

  it("names a tagged item by its tag and a counted line by its count", () => {
    expect(heldText(tagged)).toBe("EQ-0007");
    expect(heldText(counted)).toBe("12 pieces");
  });

  it("says who may, from the permissions table", () => {
    expect(whoMay("create")).toBe("Owner, Admin, General Manager, Hotel Manager or Inventory Manager");
    expect(whoMay("approve")).toBe("Owner, Admin, General Manager or Inventory Manager");
    expect(whoMay("edit")).not.toMatch(/store manager/i);
  });
});

describe("the equipment import template", () => {
  const templateText = () => {
    const headers = EQUIPMENT_SPEC.columns.map((c) => c.header);
    const notes = EQUIPMENT_SPEC.columns.map(
      (c, i) => (i === 0 ? "# " : "") + (c.required ? "REQUIRED. " : "") + c.note);
    return toCsv(headers, [notes, ...EQUIPMENT_SPEC.examples]);
  };

  it("parses back into exactly the rows it was built from, notes row skipped", () => {
    const parsed = parseCsv(templateText(), EQUIPMENT_SPEC);
    expect(parsed.missing).toEqual([]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.rows.map((r) => r["name"])).toEqual(EQUIPMENT_SPEC.examples.map((e) => e[0]));
  });

  it("has an example for every column, and no example carries a cost or a date", () => {
    for (const row of EQUIPMENT_SPEC.examples) {
      expect(row).toHaveLength(EQUIPMENT_SPEC.columns.length);
      for (const field of ["purchaseDate", "unitCost", "warrantyEnds", "amcEnds"]) {
        const at = EQUIPMENT_SPEC.columns.findIndex((c) => c.field === field);
        expect(row[at], `${row[0]} teaches a ${field} nobody measured`).toBe("");
      }
    }
  });
});
