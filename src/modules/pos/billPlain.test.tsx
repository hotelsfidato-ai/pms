import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import type { Order } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT BILL ADDS UP (the owner's D27-334)

   10% off 333.00 at 5% GST, rounded to the rupee - the database's figures:
   the tax on the DISCOUNTED value, payable with the round off. The old
   paper taxed the undiscounted price, printed neither the discount nor the
   round off, and its TOTAL was not what the till asked for. Sub total -
   Discount + every tax line + Round off must be GRAND TOTAL, to the paisa.
   ══════════════════════════════════════════════════════════════════ */

const order = {
  id: "o-1", orderNo: "20261015-7", outlet: "REST", outletName: "Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: "Akkalkot", hotelGstin: null, hotelFssai: null,
  table: "T2", status: "open", businessDate: "2026-10-15", paymentMethod: null,
  openedBy: "Owner", waiter: "Ravi", covers: 2, eventTitle: null, vatBill: null,
  lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 333, taxRate: 5, taxScheme: "gst",
    note: null, voided: false, numberedAddons: null, extra: null }],
  net: 333, discount: 33.3, discountType: "percent", discountValue: 10,
  taxable: 299.7, tax: 14.99, taxes: [{ scheme: "gst", rate: 5, tax: 14.99 }],
  gross: 314.69, roundOff: 0.31, payable: 315,
} as unknown as Order;

const figure = (s: string | null | undefined) => Number((s ?? "").replace(/[₹,+]/g, ""));

describe("the restaurant bill (D27-334)", () => {
  it("adds up: Sub total - Discount + tax + Round off = GRAND TOTAL", () => {
    const { container } = render(<BillSlip order={order} heading="interim" />);
    const rows = [...container.querySelectorAll("dl > div")]
      .map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent] as const);
    expect(rows.map(([label]) => label))
      .toEqual(["Sub total", "Discount 10%", "CGST 2.5%", "SGST 2.5%", "Round off", "GRAND TOTAL"]);
    const total = figure(rows.pop()?.[1]);
    const sum = rows.reduce((a, [, v]) => a + figure(v), 0);
    expect(Math.round(sum * 100) / 100).toBe(total);
    expect(total).toBe(315);
  });

  it("is a plain BILL before payment: never interim, never not paid", () => {
    const { container } = render(<BillSlip order={order} heading="interim" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/interim|not paid|not a tax invoice/i);
    expect(text).toContain("Steward Ravi");
    expect(text).toContain("Thank you. Visit again.");
  });
});
