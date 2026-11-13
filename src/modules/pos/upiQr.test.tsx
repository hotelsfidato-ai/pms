import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { loadUpiQr, type Upi } from "@/modules/finance";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import type { Order } from "@/modules/pos/data/till";

/* THE UPI QR ON AN OPEN RESTAURANT BILL (D27-396 wave 4): for the GRAND
   TOTAL; never a paid, void, NC or sample bill, nor with no UPI ID. The link
   itself: finance/upiQr.test.tsx. */

const upi: Upi = { id: "fidato.5el@okaxis", payee: "Fidato Hotels & Resorts" };
const qr = () => document.querySelector("[data-upi-qr]");

beforeAll(() => loadUpiQr());

describe("the restaurant bill", () => {
  const order = (over: Partial<Order> = {}) => ({
    id: "o-1", orderNo: "20261015-7", outlet: "REST", outletName: "Restaurant",
    hotelName: "5 Elements Akkalkot", hotelCity: "Akkalkot", hotelGstin: null, hotelFssai: null,
    table: "T2", status: "open", businessDate: "2026-10-15", paymentMethod: null,
    openedBy: "Owner", waiter: "Ravi", covers: 2, eventTitle: null, vatBill: null,
    lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 300, taxRate: 5, taxScheme: "gst",
      note: null, voided: false, numberedAddons: null, extra: null }],
    net: 300, discount: 0, taxable: 300, tax: 15, taxes: [{ scheme: "gst", rate: 5, tax: 15 }],
    gross: 315, roundOff: 0, payable: 315, upi,
    ...over,
  }) as unknown as Order;

  it("open: the QR for the GRAND TOTAL", () => {
    render(<BillSlip order={order()} heading="bill" />);
    expect(qr()?.textContent).toContain("₹315.00");
  });

  it("no UPI ID, paid, void, NC or a sample: no QR", () => {
    render(<BillSlip order={order({ upi: null })} heading="bill" />);
    expect(qr()).toBeNull();
    render(<BillSlip order={order({ status: "settled", paymentMethod: "cash" })} heading="bill" />);
    expect(qr()).toBeNull();
    render(<BillSlip order={order({ status: "void", voidReason: "wrong table" })} heading="bill" />);
    expect(qr()).toBeNull();
    render(<BillSlip order={order({ status: "no_charge" })} heading="nc" />);
    expect(qr()).toBeNull();
    render(<BillSlip order={order()} heading="bill" sample="SAMPLE · NOT VALID" />);
    expect(qr()).toBeNull();
  });
});
