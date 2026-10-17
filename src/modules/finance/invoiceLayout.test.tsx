import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import InvoicePage, { splitByLine } from "./pages/Invoice";
import type { InvoiceDetail } from "./data/billing";

/* ══════════════════════════════════════════════════════════════════
   THE INVOICE AS THE HOTEL'S OLD FOLIO INVOICE PRINTED IT (D27-342)

   The owner's sample: the stay in two columns, every line with its SAC,
   quantity, rate, discount, taxable value and each tax, the payments, the
   tax by rate, the totals, who checked the guest in and out. Each line's
   CGST and SGST add up to the invoice's own totals, to the paisa.
   ══════════════════════════════════════════════════════════════════ */

const line = (description: string, category: string, amount: number, taxAmount: number) =>
  ({ description, category, amount, taxRate: 5, taxAmount, date: "2026-10-11", sac: "996311" });

const INVOICE: InvoiceDetail = {
  number: "5EL/2026-27/00021", finYear: "2026-27", issuedAt: "17 Oct 2026, 11:04", issuedBy: "Asha",
  businessDate: "2026-10-11",
  supplier: { name: "5 Elements Akkalkot", address: "1 Ghat Road", city: "Akkalkot", state: "MH",
              gstin: "27ABCDE1234F1Z5", fssai: null, phone: "+91 2181 220 555", email: null,
              website: null, pan: "ABCDE1234F" },
  recipient: { name: "Ravi Iyer", gstin: null, address: null },
  placeOfSupply: "MH", sacCode: "996311",
  lines: [line("Room 204 · 1 night", "room", 4000, 200), line("Discount", "discount", -500, -25)],
  taxableValue: 3500, cgst: { rate: 2.5, amount: 87.5 }, sgst: { rate: 2.5, amount: 87.5 },
  taxTotal: 175, total: 3675,
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
  stay: { reference: "FH-0007", guest: "Ravi Iyer", roomType: "Deluxe", room: "204", adults: 2, children: 1,
          plan: "CP", nights: 1, arrival: "11 Oct 2026, 14:05", departure: "12 Oct 2026, 10:30",
          source: "Walk-in", checkedInBy: "Meera", checkedOutBy: "Asha" },
  payments: [{ date: "2026-10-11", description: "Received - UPI", amount: 3675 }],
};

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const value = (label: string) =>
  screen.getByText(label, { selector: "th" }).closest("tr")!.querySelector("td")!.textContent;

describe("the printed tax invoice, the hotel's layout (D27-342)", () => {
  it("prints the stay, the lines, the payments and the totals", async () => {
    /* Both logos, and the group's office at the foot (D27-343). */
    const PNG = { type: "image/png", data: "iVBORw0KGgo=" };
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) =>
      (url.includes("/invoices/") ? INVOICE : {
        name: "Fidato Hotels", logo: PNG, hotelLogo: PNG,
        office: { address: "1 Office Road", phone: null, email: null, website: "fidatohotels.com", gstin: null, instagram: null },
      }) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/h/5EL/invoices/doc/5EL/2026-27/00021"]}>
          <Routes><Route path="/h/:code/invoices/doc/*" element={<InvoicePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Tax Invoice");
    await screen.findByText("by Fidato Hotels");
    expect(document.querySelectorAll("[data-invoice-sheet] header img").length, "the hotel's and the group's logos").toBe(2);
    expect(document.querySelector("footer")!.textContent).toContain("1 Office Road");

    expect(screen.getByText(/PAN/).closest("p")!.textContent).toContain("ABCDE1234F");
    expect(value("Booking ref")).toBe("FH-0007");
    expect(value("Room")).toBe("Deluxe / 204");
    expect(value("Persons")).toBe("2 adults · 1 children");
    /* Who checked in and out: the washed strip of facts (D27-343). */
    const strip = (label: string) => screen.getByText(label).parentElement!.textContent;
    expect(strip("Reception (C/I)")).toBe("Reception (C/I)Meera");
    expect(strip("Cashier (C/O)")).toBe("Cashier (C/O)Asha");

    /* The discount's figure under Discount; the totals row is the invoice's own. */
    const cells = (tr: Element) => [...tr.querySelectorAll("td")].map((td) => td.textContent);
    const discountRow = screen.getByText("Discount", { selector: "span" }).closest("tr")!;
    expect(cells(discountRow).slice(4, 8)).toEqual(["-", "-", "500.00", "-500.00"]);
    const total = document.querySelector("[data-invoice-line-total]")!;
    expect(cells(total).slice(1)).toEqual(["4,000.00", "500.00", "3,500.00", "87.50", "87.50", "0.00", "0.00"]);

    const totals = document.querySelector("[data-invoice-totals]")!;
    expect(within(totals as HTMLElement).getByText("Total").closest("tr")!.textContent).toContain("3,675.00");
    expect(within(totals as HTMLElement).getByText("Balance").closest("tr")!.textContent).toContain("0.00");
    expect(document.querySelector("[data-invoice-payments]")!.textContent).toContain("Received - UPI");
  });

  it("splits each line's tax so the columns add up to the invoice's totals", () => {
    /* Two lines of 5 paise: each alone is CGST 3 / SGST 2, which would print
       CGST 0.06 over a total of 0.05. The last line takes the difference. */
    const split = splitByLine([{ taxAmount: 0.05 }, { taxAmount: 0.05 }], 0.05, 0.05);
    expect(split).toEqual([{ cgst: 0.03, sgst: 0.02 }, { cgst: 0.02, sgst: 0.03 }]);
    const sum = (k: "cgst" | "sgst") => Math.round(split.reduce((n, s) => n + s[k], 0) * 100) / 100;
    expect([sum("cgst"), sum("sgst")]).toEqual([0.05, 0.05]);
  });
});
