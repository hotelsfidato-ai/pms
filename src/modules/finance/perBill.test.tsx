import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import * as folios from "@/modules/finance/data/folios";
import * as billing from "@/modules/finance/data/billing";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";
import InvoicesPage from "./pages/Invoices";

/* ══════════════════════════════════════════════════════════════════
   ONE BILL AT A TIME - QA FI-1, FI-2, FI-3, FI-15 (28 September)

   A split stay: the guest's ₹157.50 and Agoda's ₹6,000. Settle asked for
   the whole stay and paid the guest's bill whichever tab was open; Invoices
   had one row for the stay and took a legal number on one click. The
   server's half is api/test/modules/finance/perBill.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "208", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

const BILLS = [
  { id: "f-guest", billTo: "guest", companyId: null, company: null, status: "open", balance: 157.5, lines: 1 },
  { id: "f-agoda", billTo: "company", companyId: "c-1", company: "Agoda", status: "open", balance: 6000, lines: 1 },
];

const row = (folioId: string, billTo: string) => ({
  folioId, stayId: "stay-1", reference: "FH-TEST-1", guest: "A Guest", roomNumber: "208",
  roomType: "Deluxe", source: "Agoda", arrival: "2026-09-21", departure: "2026-09-23",
  nights: 2, billTo, bills: 2, charges: 100, tax: 5, paid: 105, balance: 0,
  status: "settled" as const, invoice: null,
});

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("Settle on a split bill (FI-2, FI-3)", () => {
  beforeEach(() => {
    vi.spyOn(postings, "getFolioBalance").mockResolvedValue(6157.5 as never);
    vi.spyOn(postings, "getFolioPostings").mockResolvedValue([]);
    vi.spyOn(folios, "listStayFolios").mockResolvedValue(BILLS as never);
  });

  it("asks for the open tab's bill, and pays THAT bill", async () => {
    const paid = vi.spyOn(postings, "settle").mockImplementation(() => new Promise(() => {}));
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Agoda/ }));
    const open = screen.getByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/₹6,000 outstanding · Agoda/)).toBeTruthy();
    expect((within(dialog).getByLabelText("Amount") as HTMLInputElement).value).toBe("6000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Take payment" }));
    await waitFor(() => expect(paid).toHaveBeenCalledTimes(1));
    expect(paid.mock.calls[0]![2]).toMatchObject({ amount: 6000, folioId: "f-agoda" });
  });
});

describe("Invoices, per bill (FI-1, FI-15)", () => {
  it("lists each bill with its party, and asks before taking a number", async () => {
    vi.spyOn(billing, "listBillable").mockResolvedValue(
      [row("f-guest", "A Guest"), row("f-agoda", "Agoda")]);
    vi.spyOn(billing, "getInvoiceSeries").mockResolvedValue(
      [{ prefix: "5EL", finYear: "2026-27", next: "5EL/2026-27/00007", issued: 6, note: "" }]);
    vi.spyOn(billing, "listInvoices").mockResolvedValue([]);
    vi.spyOn(billing, "listVatBills").mockResolvedValue([]);
    const issued = vi.spyOn(billing, "issueInvoice").mockImplementation(() => new Promise(() => {}));

    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/h/5EL/invoices"]}>
          <Routes><Route path="/h/:code/invoices" element={<InvoicesPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.querySelectorAll("[data-bill-to]").length).toBeGreaterThan(0));
    const parties = [...document.querySelectorAll("[data-bill-to]")].map((e) => e.textContent);
    expect(parties).toEqual(expect.arrayContaining(["A Guest", "Agoda"]));

    const issue = screen.getAllByRole("button", { name: "Issue" });
    fireEvent.click(issue[issue.length - 1]!);
    const dialog = await screen.findByRole("dialog");
    expect(issued, "a number was taken on one click").not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Agoda/).textContent).toBeTruthy();
    expect(dialog.textContent).toMatch(/5EL\/2026-27\/00007/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Issue the invoice" }));
    await waitFor(() => expect(issued).toHaveBeenCalledTimes(1));
    expect(issued.mock.calls[0]).toEqual(["5EL", "stay-1", "f-agoda"]);
  });
});
