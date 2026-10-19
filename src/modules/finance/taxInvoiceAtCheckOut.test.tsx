import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn, withDemoHotel } from "@/test/app";
import { useSession } from "@/lib/session";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE AT CHECK-OUT (the owner, 17 October, D27-341; 19 October,
   D27-344)

   Check out on the Bill tab, and the tax invoice comes where Check out was,
   as the hotel set it: issued and printed by itself in its copies (the
   default), offered as Issue (with its "are you sure"), or left to Invoices.
   The panel's own lists are not asked again until it closes - asked at once,
   the guest left In house and the panel closed with them before the option
   was seen.
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

/* The hotel's setting (Settings › Front desk rules, 229). */
const withSetting = (invoiceAtCheckout: "print" | "offer" | "invoices", invoiceCopies: 1 | 2 = 2) => {
  /* The clerk works at 5 Elements (withDemoHotel), as at the desk. */
  withDemoHotel();
  useSession.setState((s) => ({
    hotels: s.hotels.map((h) => h.code !== "5EL" ? h : {
      ...h,
      /* A hotel nobody has touched (192's starting rules), and the setting. */
      deskRules: {
        defaultPaymentMethod: "Cash", deskMayOverbook: true, advanceBeforeCheckIn: "none",
        weekendDays: [0, 6], defaultIdType: null, defaultNationality: "IN", defaultTitle: null,
        paymentMethods: [{ label: "Cash", kind: "cash" }, { label: "UPI", kind: "upi" }],
        defaultGuarantee: "confirmed", defaultBillTo: "guest", requiredBookingFields: [],
        hkDirtyAfterMove: true, hkDirtyAfterUnblock: true, hkStayoverDirtyAtAudit: false,
        idTypesOff: [], statusColours: null, posRoundOff: "manual",
        kpiDayUseHalf: false, kpiCompAsSold: true, holidays: [],
        invoiceAtCheckout, invoiceCopies,
      },
    }),
  }));
};

/* The issued invoice, as Invoices reads it. */
const DETAIL = (number: string) => ({
  number, finYear: "2026-27", issuedAt: "27 Sep 2026, 11:00", issuedBy: "Asha", businessDate: "2026-09-27",
  supplier: { name: "5 Elements Akkalkot", address: null, city: null, state: null, gstin: "27ABCDE1234F1Z5", fssai: null },
  recipient: { name: "Ravi Iyer", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "996311",
  lines: [{ description: "Room 204", category: "room", amount: 100, taxRate: 5, taxAmount: 5, date: "2026-09-26", sac: "996311" }],
  taxableValue: 100, cgst: { rate: 2.5, amount: 2.5 }, sgst: { rate: 2.5, amount: 2.5 }, taxTotal: 5, total: 105,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
});

const out = () => document.querySelector("[data-checkout]") as HTMLButtonElement | null;
const found = (selector: string) => waitFor(() => {
  const e = document.querySelector(selector);
  expect(e, selector).not.toBeNull();
  return e as HTMLElement;
});
/** Check out on the Bill tab: the button, then the window's Check out. */
async function checkOut() {
  await waitFor(() => expect(out()?.disabled).toBe(false));
  expect(document.querySelector("[data-tax-invoice-step]")).toBeNull();
  fireEvent.click(out()!);
  fireEvent.click(await found("[data-checkout-confirm]"));
}

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
    if (path === "/api/hotels/5EL/group") return { name: null, logo: null, hotelLogo: null };
    if (invoice && decodeURIComponent(path!) === `/api/hotels/5EL/invoices/${invoice}`) return DETAIL(invoice);
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

const tree = (qc: QueryClient, panel: boolean) => (
  <QueryClientProvider client={qc}>
    <TooltipProvider><MemoryRouter>
      <List />
      {panel && <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-27" />}
    </MemoryRouter></TooltipProvider>
  </QueryClientProvider>
);
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("the tax invoice where Check out was (D27-341, D27-344)", () => {
  it("by default: check-out issues it and prints the original and the duplicate, in one print", async () => {
    withSetting("print", 2);
    const pages: string[][] = [];
    vi.spyOn(window, "print").mockImplementation(() => {
      pages.push([...document.querySelectorAll("[data-invoice-print] [data-invoice-copy]")].map((e) => e.textContent ?? ""));
    });
    render(tree(client(), true));
    await checkOut();

    await found("[data-tax-invoice-print-again]");
    expect(calls.filter((c) => c.startsWith("POST /api/hotels/5EL/stays/stay-1/invoice")),
      "issued once, by itself").toHaveLength(1);
    expect(pages, "one print, two copies").toEqual([["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR SUPPLIER"]]);
    expect((await found("[data-tax-invoice-open]")).textContent).toMatch("Print or send 5EL/2026-27/00009");
    /* The invoice is gone from the page once the browser has the paper. */
    expect(document.querySelector("[data-invoice-print]")).toBeNull();

    fireEvent.click(document.querySelector("[data-tax-invoice-print-again]")!);
    expect(pages).toHaveLength(2);
  });

  it("one copy when the hotel prints one", async () => {
    withSetting("print", 1);
    const pages: string[][] = [];
    vi.spyOn(window, "print").mockImplementation(() => {
      pages.push([...document.querySelectorAll("[data-invoice-print] [data-invoice-copy]")].map((e) => e.textContent ?? ""));
    });
    render(tree(client(), true));
    await checkOut();
    await found("[data-tax-invoice-print-again]");
    expect(pages).toEqual([["ORIGINAL FOR RECIPIENT"]]);
  });

  it("left to Invoices: nothing is issued at check-out", async () => {
    withSetting("invoices");
    const printed = vi.spyOn(window, "print").mockImplementation(() => {});
    render(tree(client(), true));
    await checkOut();
    expect((await found("[data-tax-invoice-elsewhere]")).textContent).toMatch("Invoices");
    expect(calls.some((c) => c.startsWith("POST /api/hotels/5EL/stays/stay-1/invoice"))).toBe(false);
    expect(printed).not.toHaveBeenCalled();
  });

  it("offered: checks out, offers Issue, asks first, then offers Print or send", async () => {
    withSetting("offer");
    const qc = client();
    const { rerender } = render(tree(qc, true));
    await waitFor(() => expect(listReads()).toBe(1));
    /* Nothing to invoice before the guest leaves. */
    await checkOut();

    const issue = await found("[data-tax-invoice-issue]");
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
    rerender(tree(qc, false));
    await waitFor(() => expect(listReads()).toBe(2));
  });
});
