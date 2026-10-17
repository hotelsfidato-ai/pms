import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE AT CHECK-OUT (the owner, 17 October, D27-341)

   Check out on the Bill tab, and the tax invoice is offered where Check out
   was: Issue (with its "are you sure"), then Print or send. The panel's own
   lists are not asked again until it closes - asked at once, the guest left
   In house and the panel closed with them before the option was seen.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "Ravi Iyer",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-25", departure: "2026-09-27", nights: 2, adults: 1, children: 0,
  status: "due-out", isDayUse: false, isComplimentary: false, nationality: "IN",
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let invoice: string | null = null;
const calls: string[] = [];

const bill = () => [{
  folioId: "f-guest", stayId: "stay-1", reference: "FH-TEST-1", guest: "Ravi Iyer", roomNumber: "204",
  roomType: "Deluxe", source: "Walk-in", arrival: "2026-09-25", departure: "2026-09-27",
  nights: 2, billTo: "Ravi Iyer", bills: 1, charges: 100, tax: 5, paid: 105, balance: 0,
  status: "settled", invoice,
}];

beforeEach(() => {
  startSignedIn();
  invoice = null;
  calls.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation((async (url: string, init?: { method?: string; body?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const path = url.split("?")[0];
    if (path === "/api/hotels/5EL/stays/stay-1/folio") return { stayId: "stay-1", balance: 0 };
    if (path === "/api/hotels/5EL/stays/stay-1/check-out") return { ok: true };
    /* Check-out reads the stay back. */
    if (path === "/api/hotels/5EL/stays/stay-1") return { ...STAY, status: "checked-out" };
    if (url === "/api/hotels/5EL/billable?stay=stay-1") return bill();
    if (path === "/api/hotels/5EL/in-house") return [];
    if (path === "/api/hotels/5EL/stays/stay-1/invoice") {
      invoice = "5EL/2026-27/00009";
      return { ok: true, number: invoice };
    }
    return new Promise(() => {});
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* The In house list behind the panel: the panel takes its guest from it. */
function List() {
  useQuery({ queryKey: ["in-house", "5EL"], queryFn: () => apiModule.api("/api/hotels/5EL/in-house") });
  return null;
}
const listReads = () => calls.filter((c) => c === "GET /api/hotels/5EL/in-house").length;

describe("the tax invoice where Check out was (D27-341)", () => {
  it("checks out, offers Issue, asks first, then offers Print or send", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (panel: boolean) => (
      <QueryClientProvider client={qc}>
        <TooltipProvider><MemoryRouter>
          <List />
          {panel && <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-27" />}
        </MemoryRouter></TooltipProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(true));
    await waitFor(() => expect(listReads()).toBe(1));
    /* Nothing to invoice before the guest leaves. */
    const out = () => document.querySelector("[data-checkout]") as HTMLButtonElement | null;
    await waitFor(() => expect(out()?.disabled).toBe(false));
    expect(document.querySelector("[data-tax-invoice-step]")).toBeNull();

    fireEvent.click(out()!);
    fireEvent.click(await waitFor(() => {
      const b = document.querySelector("[data-checkout-confirm]");
      expect(b).not.toBeNull();
      return b!;
    }));

    const issue = await waitFor(() => {
      const b = document.querySelector("[data-tax-invoice-issue]") as HTMLButtonElement | null;
      expect(b).not.toBeNull();
      return b!;
    });
    expect(out(), "Check out stays after the guest left").toBeNull();
    /* Asked now, the guest would leave the list and close the panel (MEMORY 418). */
    expect(listReads(), "the list behind was asked again at check-out").toBe(1);

    fireEvent.click(issue);
    const dialog = await screen.findByRole("dialog");
    expect(calls.some((c) => c.startsWith("POST /api/hotels/5EL/stays/stay-1/invoice")),
      "a number was taken on one click").toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue the invoice" }));

    const open = await waitFor(() => {
      const a = document.querySelector("[data-tax-invoice-open]");
      expect(a).not.toBeNull();
      return a!;
    });
    expect(open.textContent).toMatch("Print or send 5EL/2026-27/00009");
    expect(open.getAttribute("href")).toBe("/h/5EL/invoices/doc/5EL/2026-27/00009");

    /* The panel closes: now the list is asked again, and the guest leaves it. */
    rerender(tree(false));
    await waitFor(() => expect(listReads()).toBe(2));
  });
});
