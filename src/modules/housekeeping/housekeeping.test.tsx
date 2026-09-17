import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn } from "@/test/app";
import {
  COST_RECORDERS, COST_VIEWERS, REPAIR_REPORTERS, recordsCosts, seesCosts,
} from "@/modules/housekeeping/repairRoles";

/* ══════════════════════════════════════════════════════════════════
   HOUSEKEEPING — the screen's half

   The room card's three words and why a grey one is grey (the owner,
   D17-8), the room that is already out saying what its button does, and
   the Work orders list refusing to read a failure as "nothing
   outstanding". The server's half — repairs on equipment, costs with
   proof, every role at every door — is api/test/modules/housekeeping/.

   The stub serves the demo rooms, every one clean but 308, which is out.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

const card = async (room: string) => {
  const heading = await screen.findByText(room, { selector: "span" });
  return heading.closest<HTMLElement>("[data-hk-room]")!;
};

describe("the room card (D17-8)", () => {
  it("puts a word under each icon — Clean, Inspected, Repair", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const room = within(await card("201"));
    expect(room.getByRole("button", { name: "Mark room 201 clean" }).textContent).toBe("Clean");
    expect(room.getByRole("button", { name: "Mark room 201 inspected" }).textContent).toBe("Inspected");
    expect(room.getByRole("button", { name: "Report a repair in room 201" }).textContent).toBe("Repair");
  });

  it("says why a grey button is grey when it is tapped — and marks nothing", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const el = await card("201");
    const clean = within(el).getByRole("button", { name: "Mark room 201 clean" });
    expect(clean.getAttribute("aria-disabled")).toBe("true");

    /* Before the tap it says nothing; the status line is there, empty,
       so a screen reader is already listening. */
    const said = within(el).getByRole("status");
    expect(said.textContent).toBe("");

    fireEvent.click(clean);
    expect(said.textContent).toBe("Room 201 is already marked clean.");
    /* Still clean: a grey tap sends nothing. */
    expect(clean.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not grey Inspected on a clean room, nor Repair on any room", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const room = within(await card("202"));
    expect(room.getByRole("button", { name: "Mark room 202 inspected" }).getAttribute("aria-disabled")).toBeNull();
    expect(room.getByRole("button", { name: "Report a repair in room 202" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("opens Report a repair for that room, with taking it out a second choice, unticked", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    fireEvent.click(within(await card("209")).getByRole("button", { name: "Report a repair in room 209" }));
    const dialog = await screen.findByRole("dialog", { name: "Report a repair · Room 209" });
    const box = within(dialog).getByText("Take room 209 out of service too")
      .closest("label")!.querySelector<HTMLElement>("[role='checkbox']")!;
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).getByRole("button", { name: "Out of service without a repair" })).toBeDefined();
  });

  it("says Put back on a room that is already out — the owner, 17 September", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const out = await screen.findByText("Put back");
    expect(out.closest("button")?.getAttribute("data-hk-put-back")).toBe("308");
    expect(screen.queryByText("Take out of service")).toBeNull();
  });
});

describe("Work orders", () => {
  it("says the list did not load, rather than 'Nothing outstanding'", async () => {
    /* The stub answers no /work-orders address, which is a failure. The
       list used to turn every failure into an empty one (root MEMORY 251's
       fault, in this service). */
    go(`/h/${HOTEL}/work-orders`);
    render(<App />);
    expect(await screen.findByText("Work orders did not load")).toBeDefined();
    expect(screen.queryByText("Nothing outstanding")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Open/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /^Closed/ })).toBeDefined();
  });
});

describe("who sees and records repair costs", () => {
  it("is the owner's list: five record, the accountant also sees, nobody else does", () => {
    expect([...COST_RECORDERS].sort()).toEqual(["admin", "gm", "hotel_manager", "owner", "stores"]);
    expect([...COST_VIEWERS].sort()).toEqual(["admin", "finance", "gm", "hotel_manager", "owner", "stores"]);
    expect(recordsCosts("finance")).toBe(false);
    expect(seesCosts("finance")).toBe(true);
    for (const role of ["front_desk", "housekeeping", "chef", "kitchen_manager", "read_only"] as const) {
      expect(seesCosts(role), role).toBe(false);
    }
    /* Reporting a repair is wider: everybody who works with the things. */
    expect(REPAIR_REPORTERS).toContain("housekeeping");
    expect(REPAIR_REPORTERS).not.toContain("finance");
  });
});
