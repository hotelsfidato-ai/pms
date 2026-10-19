import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { invoicePdf, NO_BRAND, type InvoiceBrand } from "../../../src/modules/guest-messaging/invoiceDocument.ts";

/* ══════════════════════════════════════════════════════════════════
   THE E-MAILED INVOICE IS THE PRINTED ONE (the owner's D27-343: "one PDF",
   A4, Fidato's design, the hotel's and the group's logos)

   The guest's PDF carries what the desk's printed invoice carries: both logos
   (PNG), the stay, every line with its taxes, who checked the guest in and
   out, the two signatures, and the group's office at the foot - on one A4
   page for an ordinary stay.
   ══════════════════════════════════════════════════════════════════ */

/** The text a PDF draws, from its deflated streams (testHotels.test.ts's).
    ponytail: copied - a shared test helper if a third test reads PDFs. */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString("latin1");
  const runs: string[] = [];
  let at = 0;
  while ((at = s.indexOf("stream", at)) >= 0) {
    const start = s.indexOf("\n", at) + 1;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const body = zlib.inflateSync(Buffer.from(s.slice(start, end).replace(/\r?\n$/, ""), "latin1"))
        .toString("latin1");
      for (const m of body.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
        const hex = m[1] !== undefined
          ? [...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]).join("")
          : m[2]!;
        runs.push(Buffer.from(hex, "hex").toString("latin1"));
      }
    } catch { /* not a deflated stream: an image, a font */ }
    at = end + "endstream".length;
  }
  return runs.join(" ");
}

/* A real 4 x 2 PNG, without transparency (a transparent one is two images). */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGP8lyjPAANMcBYDAwMAJP0BgnmrPW4AAAAASUVORK5CYII=";
const BRAND: InvoiceBrand = {
  groupName: "Fidato Hotels", hotelLogoPng: PNG, groupLogoPng: PNG,
  office: { address: "1 Office Road, Pune", phone: null, email: null, website: "fidatohotels.com", instagram: null },
};

const facts = {
  number: "5EL/2026-27/00021", finYear: "2026-27", issuedAt: "17 Oct 2026, 11:04", businessDate: "2026-10-11",
  placeOfSupply: "MH", sacCode: "996311", vatBill: null, issuedBy: "Asha",
  creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null,
  total: 4200, taxableValue: 4000, cgst: { rate: 2.5, amount: 100 }, sgst: { rate: 2.5, amount: 100 },
  supplier: { name: "5 Elements Akkalkot", address: "1 Ghat Road", city: "Akkalkot", state: "MH",
              gstin: "27ABCDE1234F1Z5", fssai: null, phone: "+91 2181 220 555", email: null, website: null, pan: "ABCDE1234F" },
  recipient: { name: "Ravi Iyer", address: null, gstin: null },
  lines: [{ description: "Room 204 - 1 night", category: "room", date: "2026-10-11", amount: 4000,
            taxRate: 5, taxAmount: 200, sac: "996311" }],
  stay: { reference: "FH-0007", grCardNo: 421, guest: "Ravi Iyer", roomType: "Deluxe", room: "204", adults: 2, children: 0,
          plan: "CP", nights: 1, arrival: "11 Oct 2026, 14:05", departure: "12 Oct 2026, 10:30",
          source: "Walk-in", checkedInBy: "Meera", checkedOutBy: "Asha" },
  payments: [{ date: "2026-10-12", description: "Received - UPI", amount: 4200 }],
} as unknown as Parameters<typeof invoicePdf>[0];

const images = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe("the e-mailed tax invoice, as printed (D27-343)", () => {
  it("draws both logos, the stay, the taxes, who checked in and out, and the group's foot, on one A4 page", async () => {
    const pdf = await invoicePdf(facts, false, BRAND);
    const text = pdfText(pdf);
    expect(images(pdf), "the hotel's and the group's logos").toBe(2);
    expect(pages(pdf)).toBe(1);
    for (const words of ["TAX INVOICE", "by Fidato Hotels", "PAN ABCDE1234F", "FH-0007", "G.R. card no", "421", "Deluxe / 204",
      "RECEPTION (C/I)", "Meera", "Guest signature", "Authorised signatory", "FIDATO HOTELS", "1 Office Road, Pune",
      "11 Oct 2026", "Received - UPI"]) {
      expect(text, words).toContain(words);
    }
  });

  it("without the group's settings: no logos, and the hotel's own name at the foot", async () => {
    const pdf = await invoicePdf(facts, false, NO_BRAND);
    expect(images(pdf)).toBe(0);
    expect(pdfText(pdf)).toContain("5 ELEMENTS AKKALKOT");
  });
});
