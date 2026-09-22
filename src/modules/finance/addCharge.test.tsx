import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE ADD CHARGE DIALOG SHOWS THE RATE THE CHARGE WILL REALLY CARRY

   It printed "Taxable - CGST 2.5% + SGST 2.5%" and worked the preview out
   at 5% whatever the property had set and whatever the charge came to -
   so an ₹8,000 charge, which the room's rule taxes at 18%, previewed at
   5% and posted at 18% (22 September). It now asks the server's one slab
   rule for this amount, and shows a dash where nobody has set a rate.

   Everything else the panel reads is left unanswered (a promise that
   never settles), so only the dialog's own question is in play.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let asked: string[] = [];

/** The room's rule as a property might set it: 5% up to ₹7,500, 18% above -
    or no rule at all. The component never sees these numbers except
    through this answer. */
function rateRule(rule: "slabs" | "unset") {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const [path, query] = url.split("?");
    if (path === "/api/hotels/5EL/tax/room/rate") {
      asked.push(url);
      const amount = Number(new URLSearchParams(query).get("amount"));
      const rate = rule === "unset" ? null : amount > 7500 ? 18 : 5;
      return { kind: "room", amount, rate, scheme: "gst" } as never;
    }
    return new Promise(() => {}) as never;
  });
}

function openDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add charge/ }));
}

beforeEach(() => {
  startSignedIn();
  asked = [];
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Add charge - the rate the charge will carry", () => {
  it("previews an ₹8,000 charge at the room's 18%, as CGST 9% and SGST 9% - never a fixed 2.5%", async () => {
    rateRule("slabs");
    openDialog();
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "8000" } });

    await waitFor(() =>
      expect(document.querySelector("[data-charge-rate]")?.textContent).toBe("Taxable - GST 18%"));
    expect(screen.getByText("CGST 9%")).toBeTruthy();
    expect(screen.getByText("SGST 9%")).toBeTruthy();
    expect(document.body.textContent).not.toContain("2.5%");
    expect(asked.some((u) => u.includes("amount=8000")), "asked for this amount").toBe(true);
  });

  it("previews a small charge at the rate the rule gives it", async () => {
    rateRule("slabs");
    openDialog();
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "400" } });

    await waitFor(() =>
      expect(document.querySelector("[data-charge-rate]")?.textContent).toBe("Taxable - GST 5%"));
    expect(screen.getByText("CGST 2.5%")).toBeTruthy();
  });

  it("shows a dash where the property has set no rate - never 0%, never a made-up one", async () => {
    rateRule("unset");
    openDialog();
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "8000" } });

    await waitFor(() =>
      expect(document.querySelector("[data-charge-rate]")?.textContent).toBe("Taxable - GST -"));
    expect(screen.getByText("CGST -")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0%");
    expect(document.body.textContent).not.toContain("2.5%");
  });
});
