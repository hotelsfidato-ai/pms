import { describe, it, expect } from "vitest";
import {
  instagramLink, money, plain, voucherBlocks, voucherFields, voucherFigures, voucherHeight, voucherPdf, voucherPolicies,
  type VoucherFacts, type VoucherRoom,
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

  /* D27-227: a day use has no night; it is one day at its typed rate, charged
     at check-in. Its zero nights printed ₹0 and no GST. */
  it("charges a day use one day at its rate, with its GST", () => {
    const f = voucherFigures([room({ nights: 0, rate: 1500, gstRate: 5 })]);
    expect(f.lines[0]).toMatchObject({ amount: 1500, tax: 75 });
    expect(f.total).toBe(1575);
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

/* ══════════════════════════════════════════════════════════════════
   THE VOUCHER, REFINED TO THE OWNER'S REFERENCE (D27-215)

   What each block says is worked out in one place (voucherBlocks) and the
   PDF draws exactly that, so the words are tested here and the drawing is
   read by eye. The owner's answers:
     - a PAYMENT cell: the advance and the balance at the hotel; "Pay at
       the hotel" with no advance; "Bill to company"; never a negative
       balance, never one worked from a total nobody agreed to;
     - Contact and, once the footer is the group's, the hotel's GSTIN in
       the HOTEL block; Booked by in the GUEST block;
     - extra guests under the room's line;
     - BANK DETAILS when set, the block left out when not;
     - the hotel's house policies AFTER the booking's terms and the times;
     - Instagram as a line of text;
     - the footer is the GROUP's office once any of it is typed, and the
       hotel's own, as today, until then.
   A hotel with nothing new set prints today's voucher but for the
   Payment cell.
   ══════════════════════════════════════════════════════════════════ */
describe("the voucher's blocks (D27-215)", () => {
  const BANK = { accountName: "Test Hotels Private Limited", accountNumber: "000011112222",
    bankName: "Test Bank", branch: "Akkalkot", ifsc: "TEST0001234", upi: "testhotel@testbank" };
  const OFFICE = { name: "Test Group", address: "1 Office Road, Pune", phone: "+91 20 0000 0000",
    email: "office@example.test", website: "www.example.test", gstin: "27BBBBB0000B1Z5", instagram: "@testgroup" };

  it("prints today's voucher for a hotel with nothing new set, but for the Payment cell", () => {
    expect(voucherBlocks(facts([room()]))).toEqual({
      payment: { value: "Pay at the hotel" },
      hotelRows: [["Phone", "+91 00000 00000"], ["Email", "desk@example.test"]],
      guestRows: [["Email", "asha@example.test"]],
      extras: [""],
      bank: null,
      policies: ["This booking carries no cancellation terms.", "Check-in from 14:00; check-out by 11:00."],
      instagram: null,
      qr: null,
      checkIn: null,
      footer: { name: "TEST GROUP", address: "1 Test Road",
        lines: ["+91 00000 00000", "desk@example.test", "GSTIN 27AAAAA0000A1Z5"] },
    });
    /* The same with the new keys present and empty, as app.guest_voucher sends them. */
    const empty: VoucherFacts = { ...facts([room({ extraAdults: 0, extraChildren: 0 })]),
      contact: null, bookedBy: null, payment: { received: 0, billTo: "guest" }, bank: null,
      group: { name: "Test Group", address: null, phone: null, email: null, website: null, gstin: null, instagram: null },
      housePolicies: [] };
    expect(voucherBlocks(empty)).toEqual(voucherBlocks(facts([room()])));
  });

  it.each([
    ["an advance: what was received, and the balance at the hotel",
      { received: 2000, billTo: "guest" }, [room()], { value: "Advance INR 2,000.00", hint: "Balance INR 3,741.92 at the hotel" }],
    ["paid in full: a balance of nothing, said",
      { received: 5741.92, billTo: "guest" }, [room()], { value: "Advance INR 5,741.92", hint: "Balance INR 0.00 at the hotel" }],
    ["paid more than the total: the advance alone, never a negative balance",
      { received: 9000, billTo: "guest" }, [room()], { value: "Advance INR 9,000.00" }],
    ["no total (no GST rate): the advance alone, never a balance from a total nobody agreed to",
      { received: 2000, billTo: "guest" }, [room({ gstRate: null })], { value: "Advance INR 2,000.00" }],
    ["no advance", { received: 0, billTo: "guest" }, [room()], { value: "Pay at the hotel" }],
    ["a company's booking, even with an advance",
      { received: 2000, billTo: "company" }, [room()], { value: "Bill to company" }],
  ])("the Payment cell - %s", (_, payment, rooms, cell) => {
    expect(voucherBlocks({ ...facts(rooms), payment }).payment).toEqual(cell);
  });

  it("adds Contact under the hotel's email, and Booked by under the guest's", () => {
    const b = voucherBlocks({ ...facts([room()]), contact: "Meera Kulkarni", bookedBy: "Test Desk" });
    expect(b.hotelRows).toEqual([["Phone", "+91 00000 00000"], ["Email", "desk@example.test"], ["Contact", "Meera Kulkarni"]]);
    expect(b.guestRows).toEqual([["Email", "asha@example.test"], ["Booked by", "Test Desk"]]);
  });

  it("says the extra guests under a room's line, and nothing where there are none", () => {
    const b = voucherBlocks(facts([
      room({ extraAdults: 1, extraChildren: 0 }), room({ extraAdults: 2, extraChildren: 1 }),
      room({ extraAdults: 0, extraChildren: 2 }), room(),
    ]));
    expect(b.extras).toEqual(["1 extra adult", "2 extra adults, 1 extra child", "2 extra children", ""]);
  });

  it("prints the bank details that are set, and leaves the block out when there are none", () => {
    expect(voucherBlocks({ ...facts([room()]), bank: BANK }).bank).toEqual([
      ["Account name", "Test Hotels Private Limited"], ["Account no.", "000011112222"],
      ["Bank", "Test Bank"], ["Branch", "Akkalkot"], ["IFSC", "TEST0001234"], ["UPI", "testhotel@testbank"],
    ]);
    expect(voucherBlocks({ ...facts([room()]), bank: { ...BANK, branch: null, upi: null } }).bank).toEqual([
      ["Account name", "Test Hotels Private Limited"], ["Account no.", "000011112222"],
      ["Bank", "Test Bank"], ["IFSC", "TEST0001234"],
    ]);
    expect(voucherBlocks({ ...facts([room()]), bank: null }).bank).toBeNull();
  });

  it("puts the hotel's house policies after the booking's terms and the times, in the hotel's order", () => {
    const f = { ...facts([room()]), housePolicies: ["Pets are welcome.", "No smoking in the rooms."] };
    expect(voucherPolicies(f)).toEqual([
      "This booking carries no cancellation terms.",
      "Check-in from 14:00; check-out by 11:00.",
      "Pets are welcome.",
      "No smoking in the rooms.",
    ]);
    expect(voucherBlocks(f).policies).toEqual(voucherPolicies(f));
  });

  it("makes the footer the group's office once any of it is typed, and moves the hotel's GSTIN up", () => {
    const b = voucherBlocks({ ...facts([room()]), contact: "Meera Kulkarni", group: OFFICE });
    expect(b.footer).toEqual({ name: "TEST GROUP", address: "1 Office Road, Pune",
      lines: ["+91 20 0000 0000", "office@example.test", "www.example.test", "GSTIN 27BBBBB0000B1Z5"] });
    expect(b.instagram).toBe("Instagram: @testgroup");
    /* The hotel's own GSTIN was only in the footer: it must not vanish. */
    expect(b.hotelRows).toEqual([["Phone", "+91 00000 00000"], ["Email", "desk@example.test"],
      ["Contact", "Meera Kulkarni"], ["GSTIN", "27AAAAA0000A1Z5"]]);

    /* One detail is enough, and an unset one is simply absent. */
    const one = voucherBlocks({ ...facts([room()]),
      group: { ...OFFICE, address: null, email: null, website: null, gstin: null, instagram: null } });
    expect(one.footer).toEqual({ name: "TEST GROUP", address: null, lines: ["+91 20 0000 0000"] });
    expect(one.instagram).toBeNull();
  });

  it("keeps Instagram and the hotel's own footer when the group typed only that", () => {
    const b = voucherBlocks({ ...facts([room()]),
      group: { name: "Test Group", address: null, phone: null, email: null, website: null, gstin: null, instagram: "@testgroup" } });
    expect(b.instagram).toBe("Instagram: @testgroup");
    expect(b.footer.address).toBe("1 Test Road");
  });
});

/* D27-223: "Scan to connect" beside the Instagram address, only when one is set. */
describe("the Instagram QR code", () => {
  it.each([
    ["@fidatohotels", "https://instagram.com/fidatohotels"],
    ["fidato.hotels", "https://instagram.com/fidato.hotels"],
    ["https://www.instagram.com/fidatohotels/", "https://www.instagram.com/fidatohotels/"],
    ["instagram.com/fidatohotels", "https://instagram.com/fidatohotels"],
    ["Follow us on Instagram!", null],
    ["", null],
    [null, null],
  ])("opens %j as %j", (typed, link) => {
    expect(instagramLink(typed)).toBe(link);
  });

  it("is on the voucher only when the group has an Instagram address", () => {
    const office = { name: "Test Group", address: null, phone: null, email: null, website: null, gstin: null };
    expect(voucherBlocks({ ...facts([room()]), group: { ...office, instagram: "@testgroup" } }).qr)
      .toBe("https://instagram.com/testgroup");
    expect(voucherBlocks({ ...facts([room()]), group: { ...office, instagram: null } }).qr).toBeNull();
  });

  it("is drawn in the PDF, and the voucher stays one page", async () => {
    const office = { name: "Test Group", address: null, phone: null, email: null, website: null, gstin: null };
    const withCode = await voucherPdf({ ...facts([room()]), group: { ...office, instagram: "@testgroup" } });
    const without = await voucherPdf({ ...facts([room()]), group: { ...office, instagram: null } });
    /* The modules are many small squares: the page's drawing grows by them. */
    expect(withCode.byteLength).toBeGreaterThan(without.byteLength + 500);
    expect((Buffer.from(withCode).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1);
  });
});

/* D27-264: the voucher IS the confirmation, and it carries the guest's own
   check-in page - the link written out and its QR code. */
describe("the check-in link in the voucher", () => {
  const LINK = "https://pms.fidatohotels.com/g/a-made-up-token-0123456789abcdefghijklmnop";

  it("is on the voucher only when the message carries one (the desk's View voucher has none)", () => {
    expect(voucherBlocks({ ...facts([room()]), checkInLink: LINK }).checkIn).toBe(LINK);
    expect(voucherBlocks(facts([room()])).checkIn).toBeNull();
  });

  it("is drawn in the PDF with its QR code, and the voucher stays one page", async () => {
    const withLink = await voucherPdf({ ...facts([room()]), checkInLink: LINK });
    const without = await voucherPdf(facts([room()]));
    expect(withLink.byteLength).toBeGreaterThan(without.byteLength + 500);
    expect((Buffer.from(withLink).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1);
  });
});

/* D27-265: the voucher on WhatsApp is our own template, booking_voucher -
   ten numbered fields, written as the owner's sample writes them: "Sat, 10
   Oct 2026", the hotel's own times as "2:00 PM", its phone, a dash where a
   figure is missing. */
describe("the WhatsApp voucher's ten fields (booking_voucher, D27-265)", () => {
  it("writes each as the owner's sample does", () => {
    expect(voucherFields({ ...facts([room({ roomType: "Deluxe A/C" })]), checkIn: "2026-10-10", checkOut: "2026-10-12" }))
      .toEqual({
        guestName: "Asha Test", hotelName: "Test Hotel", reference: "FH-TST-2610-0001",
        checkInDay: "Sat, 10 Oct 2026", checkInFrom: "2:00 PM",
        checkOutDay: "Mon, 12 Oct 2026", checkOutBy: "11:00 AM",
        room: "1 × Deluxe A/C", guests: "2 adults", hotelPhone: "+91 00000 00000",
      });
  });

  it("counts a group's rooms by type, says noon and midnight right, and writes a dash for what is missing", () => {
    const f = facts([room(), room(), room({ roomType: "Suite", adults: 1, children: 1 })]);
    expect(voucherFields({ ...f, checkIn: "2026-09-05",
      hotel: { ...f.hotel, phone: null, checkInTime: "12:00", checkOutTime: "00:30" } })).toMatchObject({
      checkInDay: "Sat, 5 Sep 2026", checkInFrom: "12:00 PM", checkOutBy: "12:30 AM",
      room: "2 × Superior, 1 × Suite", guests: "5 adults, 1 child", hotelPhone: "-",
    });
    expect(voucherFields({ ...f, hotel: { ...f.hotel, checkInTime: null, checkOutTime: null } }))
      .toMatchObject({ checkInFrom: "-", checkOutBy: "-" });
  });
});

describe("the PDF, with everything the reference has", () => {
  const pages = (bytes: Uint8Array) =>
    (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

  it("still fits ONE A4 page with bank details, eight house policies of the greatest length and three rooms", async () => {
    const long = "A house policy of the greatest length a hotel may type, which is two hundred characters, so that the page is proved with the most words any hotel can put on it and not the fewest words anyone would.";
    expect(long.length).toBeLessThanOrEqual(200);
    const f: VoucherFacts = {
      ...facts([room({ extraAdults: 1, extraChildren: 1 }), room({ roomType: "Deluxe", extraAdults: 1 }), room({ roomType: "Suite" })]),
      contact: "Meera Kulkarni", bookedBy: "Test Desk",
      payment: { received: 2000, billTo: "guest" },
      bank: { accountName: "Test Hotels Private Limited", accountNumber: "000011112222",
        bankName: "Test Bank", branch: "Akkalkot", ifsc: "TEST0001234", upi: "testhotel@testbank" },
      group: { name: "Test Group", address: "1 Office Road, Pune 411001", phone: "+91 20 0000 0000",
        email: "office@example.test", website: "www.example.test", gstin: "27BBBBB0000B1Z5", instagram: "@testgroup" },
      housePolicies: Array.from({ length: 8 }, () => long),
    };
    f.terms = { ...f.terms, name: "Flexible", freeUntilHours: 48, cancelBasis: "first_night",
      noShowBasis: "percent", noShowPercent: 100 };
    /* More than the page at full size, so it is drawn smaller - and whole. */
    expect(voucherHeight(f)).toBeGreaterThan(297);
    expect(pages(await voucherPdf(f))).toBe(1);

    /* The reference's own four lines, twice over: nine tenths of full size. */
    const eight = { ...f, housePolicies: Array.from({ length: 8 }, () =>
      "Guests must present government photo identity at check in - driving licence, voter ID, Aadhaar or passport.") };
    expect(297 / voucherHeight(eight)).toBeGreaterThan(0.88);
    expect(pages(await voucherPdf(eight))).toBe(1);
  });

  it("is one page at full size for a booking with nothing new set, as today", async () => {
    expect(voucherHeight(facts([room()]))).toBeLessThanOrEqual(297);
    expect(pages(await voucherPdf(facts([room()])))).toBe(1);
  });

  it("runs onto a second page, whole, only when it is longer than the smallest drawing holds", async () => {
    const many = facts(Array.from({ length: 20 }, () => room()));
    expect(pages(await voucherPdf(many))).toBe(2);
  });
});
