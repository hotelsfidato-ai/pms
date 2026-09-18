import { describe, it, expect } from "vitest";
import { orderDocument, type OrderFacts } from "../../../src/modules/purchasing/orderDocument.ts";
import { renderPdf } from "../../../src/reportRender.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PURCHASE ORDER AS A DOCUMENT (D18-3)

   The DRAWING is the shared renderer's and is gated by the reports
   suite. What is proved here is the document this service hands it:
   the facts a supplier reads, the lines, and - the one that matters -
   that an order with a line nobody priced carries NO total rather than
   a total of the rest.
   ══════════════════════════════════════════════════════════════════ */

const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  reference: "PO-5EL-2609-0007",
  date: "2026-09-18",
  supplier: {
    name: "Akkalkot Traders", contact: "Mr Patil", phone: "9822012345",
    email: null, gstin: "27AAGCF5655F1ZI",
    address: "Market Road, Akkalkot, Solapur 413216",
  },
  deliverTo: "Main store",
  raisedBy: "Test Inventory Manager",
  approvedBy: "Test GM",
  reason: "The rice is down to two days",
  property: {
    code: "5EL", name: "5 Elements Akkalkot",
    address: "Akkalkot, Solapur", gstin: "27AAGCF5655F1ZI",
    timezone: "Asia/Kolkata",
  },
  lines: [
    { lineNo: 1, item: "Basmati rice", unit: "kg", quantity: 50, unitPrice: 62 },
    { lineNo: 2, item: "Sunflower oil", unit: "litre", quantity: 10, unitPrice: 140 },
  ],
  ...over,
});

const items = (doc: ReturnType<typeof orderDocument>) =>
  doc.sections.find((s) => s.key === "items")!;

describe("the purchase order document", () => {
  it("says what a supplier needs, and names the property from its own row", () => {
    const doc = orderDocument(facts());
    expect(doc.title).toBe("Purchase order");
    /* NOT a report: it must never appear on the Reports screen. */
    expect(doc.report).toBe("purchase-order");
    expect(doc.property.name).toBe("5 Elements Akkalkot");

    const fact = (label: string) => doc.facts.find((f) => f.label === label)?.value;
    expect(fact("Order")).toBe("PO-5EL-2609-0007");
    expect(fact("Supplier")).toBe("Akkalkot Traders");
    expect(fact("Deliver to")).toBe("Main store");
    expect(fact("Approved by")).toBe("Test GM");
    expect(fact("Currency")).toBe("INR");

    /* The supplier's own details, and nothing invented: an email nobody
       entered is simply not a line on the paper. */
    const supplier = doc.sections.find((s) => s.key === "supplier")!;
    const lines = supplier.rows.map((r) => r.cells["detail"]);
    expect(lines).toContain("Mr Patil");
    expect(lines).toContain("GSTIN 27AAGCF5655F1ZI");
    expect(lines.some((l) => String(l).includes("@"))).toBe(false);
  });

  it("totals the lines", () => {
    const section = items(orderDocument(facts()));
    const total = section.rows.find((r) => r.kind === "total")!;
    expect(total.cells["amount"]).toBe(4500);
    const rice = section.rows[0]!;
    expect(rice.cells["amount"]).toBe(3100);
  });

  it("CARRIES NO TOTAL when a line has no agreed price", () => {
    /* The owner's oldest rule, said the other way round: a total over the
       lines that happen to have a price is a smaller number printed as the
       whole bill. Null prints "-". */
    const doc = orderDocument(facts({
      lines: [
        { lineNo: 1, item: "Basmati rice", unit: "kg", quantity: 50, unitPrice: null },
        { lineNo: 2, item: "Sunflower oil", unit: "litre", quantity: 10, unitPrice: 140 },
      ],
    }));
    const section = items(doc);
    expect(section.rows.find((r) => r.kind === "total")!.cells["amount"]).toBeNull();
    expect(section.rows[0]!.cells["price"]).toBeNull();
    expect(section.rows[0]!.cells["amount"]).toBeNull();
  });

  it("says on the paper that nothing about it is sent automatically (D18-3)", () => {
    const doc = orderDocument(facts());
    expect(doc.footnotes.some((f) => f.includes("sent by hand"))).toBe(true);
    expect(doc.footnotes.some((f) => f.includes("The rice is down to two days"))).toBe(true);
  });

  it("leaves the supplier's block out entirely when there is none yet", () => {
    const doc = orderDocument(facts({ supplier: null }));
    expect(doc.sections.some((s) => s.key === "supplier")).toBe(false);
    expect(doc.facts.find((f) => f.label === "Supplier")?.value).toBeNull();
  });

  it("draws as one page of real PDF through the shared renderer", async () => {
    const pdf = await renderPdf(orderDocument(facts()), {
      name: "Test Inventory Manager", at: new Date("2026-09-18T14:00:00Z"),
      timezone: "Asia/Kolkata",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages).toBe(1);
  });
});
