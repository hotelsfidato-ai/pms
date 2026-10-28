import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { GstSalesPage } from "@/modules/reports/pages/Compliance";

/* ══════════════════════════════════════════════════════════════════
   THE GST SALES REGISTER'S TYPE COLUMN (the owner's D27-372)

   B2B or B2C beside the GSTIN, as the server says it (a credit note takes
   its invoice's): api/test/modules/reservations/guestCompany.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const row = (number: string, gstin: string | null, type: "B2B" | "B2C", creditsInvoice: string | null = null) => ({
  number, issued: "2026-08-25", recipient: "Acme Traders", gstin, placeOfSupply: "Maharashtra", sac: "996311",
  taxable: 1000, cgst: 60, sgst: 60, total: 1120, creditsInvoice, type,
});

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(async () => ({
    from: "2026-08-01", to: "2026-08-25",
    rows: [row("INV/1", "27AAPFU0939F1ZV", "B2B"), row("INV/2", null, "B2C"), row("CN/1", "27AAPFU0939F1ZV", "B2B", "INV/1")],
  }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the GST sales register", () => {
  it("has a Type column: B2B with a GSTIN, B2C without", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><GstSalesPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("INV/2");
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeTruthy();
    expect([...document.querySelectorAll("[data-gst-type]")].map((c) => c.textContent)).toEqual(["B2B", "B2C", "B2B"]);
  });
});
