import { describe, it, expect } from "vitest";
import {
  money, plain, voucherFigures, voucherPdf, voucherPolicies, type VoucherFacts, type VoucherRoom,
} from "../../../src/modules/guest-messaging/voucherDocument.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BOOKING VOUCHER (D27-171, D27-172) - made-up bookings only

   The owner's rule the master asked to see fail: NO GST RATE, NO TOTAL.
   The voucher prints "-" for the GST and the grand total where the
   database has no GST rule for the rate, never a figure nobody agreed to.
   ══════════════════════════════════════════════════════════════════ */

const room = (over: Partial<VoucherRoom> = {}): VoucherRoom => ({
  roomType: "Superior", mealPlan: "MAP · Room + breakfast + one meal", adults: 2, children: 0, nights: 2,
  rate: 2734.25, complimentary: false, gstRate: 5, ...over,
});

const facts = (rooms: VoucherRoom[]): VoucherFacts => ({
  reference: "FH-TST-2610-0001", bookedOn: "2026-09-28", checkIn: "2026-10-01",
  checkOut: "2026-10-03", nights: 2,
  hotel: { name: "Test Hotel", address: "1 Test Road", city: "Testpur", state: "MH",
    phone: "+91 00000 00000", email: "desk@example.test", gstin: "27AAAAA0000A1Z5",
    checkInTime: "14:00", checkOutTime: "11:00" },
  groupName: "Test Group", logoPng: null,
  guest: { name: "Asha Test", email: "asha@example.test", phone: null },
  company: null, rooms,
  terms: { name: null, freeUntilHours: null, cancelBasis: null, cancelPercent: null,
    cancelAmount: null, noShowBasis: null, noShowPercent: null, noShowAmount: null },
  confirmedBy: "Test Desk", confirmedAt: "2026-09-28T19:19",
});

describe("the voucher's figures (V1)", () => {
  it("prints no total at all where the database has no GST rate for the rate", () => {
    const f = voucherFigures([room({ gstRate: null })]);
    expect(f.roomCharges, "the room charges are still known").toBe(5468.5);
    expect(f.gst).toBeNull();
    expect(f.bands).toBeNull();
    expect(f.total, "no GST rule, no total").toBeNull();
    expect(money(f.total)).toBe("-");
  });

  it("works GST out per night, as the audit posts it, and adds it up", () => {
    /* 2,734.25 x 5% = 136.7125 a night, posted as 136.71, twice. */
    const f = voucherFigures([room(), room({ roomType: "Deluxe", rate: 8000, gstRate: 18, nights: 2 })]);
    expect(f.lines.map((l) => [l.amount, l.tax])).toEqual([[5468.5, 273.42], [16000, 2880]]);
    expect(f.roomCharges).toBe(21468.5);
    expect(f.bands).toEqual([{ rate: 5, tax: 273.42 }, { rate: 18, tax: 2880 }]);
    expect(f.total).toBe(24621.92);
    expect(money(f.total)).toBe("INR 24,621.92");
  });

  it("counts a complimentary room as nothing, taxed at nothing", () => {
    const f = voucherFigures([room({ complimentary: true, rate: 0, gstRate: null }), room()]);
    expect(f.lines[0]).toMatchObject({ amount: 0, tax: 0 });
    expect(f.total).toBe(5741.92);
  });

  it("prints no room charges where a rate was never set", () => {
    const f = voucherFigures([room({ rate: null })]);
    expect([f.roomCharges, f.gst, f.total]).toEqual([null, null, null]);
  });
});

/* Found reading the first voucher sent from New booking, 29 September: the
   room line printed "EP" alone. The owner's D27-164: the code with its words,
   everywhere - read from meal_plans by app.guest_voucher, and drawn with its
   middot, which pdfkit's Helvetica has (WinAnsi 0xB7). */
describe("the meal plan, as every screen says it (D27-164)", () => {
  it("keeps the code with its words, middot and all", () => {
    expect(plain("EP · Room only")).toBe("EP · Room only");
    expect(plain("MAP • Room + breakfast + one meal ₹")).toBe("MAP · Room + breakfast + one meal INR ");
  });
});

describe("the voucher's policies (V4)", () => {
  it("says so when the booking carries no terms, and always the hotel's times", () => {
    expect(voucherPolicies(facts([room()]))).toEqual([
      "This booking carries no cancellation terms.",
      "Check-in from 14:00; check-out by 11:00.",
    ]);
  });

  it("prints the booking's own terms in the desk's words", () => {
    const f = facts([room()]);
    f.terms = { ...f.terms, name: "Flexible", freeUntilHours: 48, cancelBasis: "first_night",
      noShowBasis: "percent", noShowPercent: 100 };
    expect(voucherPolicies(f).slice(0, 4)).toEqual([
      "Cancellation terms: Flexible.",
      "Free cancellation until: 48 hours before arrival.",
      "Cancelled after that: The first night.",
      "No-show: 100% of the booking.",
    ]);
  });
});

describe("the PDF", () => {
  it("is drawn, for a priced booking and for one with no GST rate", async () => {
    for (const rooms of [[room()], [room({ gstRate: null })], [room({ complimentary: true, rate: 0 })]]) {
      const bytes = await voucherPdf(facts(rooms));
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });
});
