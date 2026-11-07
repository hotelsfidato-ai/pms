import {
  col, row, total, type ReportDoc,
} from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PURCHASE ORDER, AS A DOCUMENT (D18-3)

   The owner's answer: the order reaches the supplier as a printed / PDF
   order, sent by hand — printed, or attached to a WhatsApp by whoever
   orders. NOTHING HERE WAITS ON n8n, and nothing here sends anything.

   It is built as a `ReportDoc` and drawn by the SHARED renderer,
   api/src/reportRender.ts, because the brief says so in as many words:
   the PDF is made by that renderer, and a second one is not written. So
   the order gets the group's layout — the property's name top left, the
   title and its facts top right, ruled tables, a bold total, and the
   footer saying when it was printed and by whom — for free, and it
   cannot drift away from every other document the group prints.

   NO PRICE IS INVENTED. A line nobody has priced prints "-" (the
   renderer does that for a null), and `app.mark_purchase_ordered`
   refuses to send an order that still has one, so a supplier never
   receives a blank to fill in themselves.
   ══════════════════════════════════════════════════════════════════ */

export interface OrderLine {
  lineNo: number;
  item: string;
  unit: string;
  quantity: number;
  /** Null until somebody agrees one. Prints "-", never 0. */
  unitPrice: number | null;
  /** The GST rate agreed, in per cent (D27-383 item 11). None prints "-". */
  gstRate?: number | null;
}

export interface OrderFacts {
  reference: string;
  /** The day the order was sent, or today for one not yet sent. */
  date: string;
  supplier: {
    name: string; contact: string | null; phone: string | null;
    email: string | null; gstin: string | null; address: string | null;
  } | null;
  deliverTo: string;
  raisedBy: string | null;
  approvedBy: string | null;
  reason: string;
  property: ReportDoc["property"];
  lines: OrderLine[];
}

/** An order as the group prints it. Portrait A4, like every other
    document; a purchase order has seven columns and needs no more. */
export function orderDocument(o: OrderFacts): ReportDoc {
  const amount = (l: OrderLine) =>
    l.unitPrice === null ? null : Math.round(l.quantity * l.unitPrice * 100) / 100;

  /* The order total, or NOTHING. A total over lines where one price is
     missing is a smaller number presented as the whole bill, which is
     the oldest rule here said the other way round: never show a figure
     the data has not agreed to. */
  const priced = o.lines.every((l) => l.unitPrice !== null);
  const sum = priced
    ? Math.round(o.lines.reduce((t, l) => t + (amount(l) ?? 0), 0) * 100) / 100
    : null;

  const supplierLines = o.supplier
    ? [
        o.supplier.name,
        o.supplier.contact,
        o.supplier.phone,
        o.supplier.email,
        o.supplier.gstin ? `GSTIN ${o.supplier.gstin}` : null,
        o.supplier.address,
      ].filter((s): s is string => !!s && s.trim().length > 0)
    : [];

  return {
    report: "purchase-order",
    title: "Purchase order",
    property: o.property,
    orientation: "portrait",
    facts: [
      { label: "Order", value: o.reference, kind: "text" },
      { label: "Date", value: o.date, kind: "date" },
      { label: "Supplier", value: o.supplier?.name ?? null, kind: "text" },
      { label: "Deliver to", value: o.deliverTo, kind: "text" },
      { label: "Raised by", value: o.raisedBy, kind: "text" },
      { label: "Approved by", value: o.approvedBy, kind: "text" },
      { label: "Currency", value: "INR", kind: "text" },
    ],
    sections: [
      ...(supplierLines.length
        ? [{
            key: "supplier",
            title: "Supplier",
            columns: [col("detail", "", "text")],
            rows: supplierLines.map((line) => row({ detail: line })),
          }]
        : []),
      {
        key: "items",
        title: "Items",
        columns: [
          col("no", "#", "text"),
          col("item", "Item", "text"),
          col("unit", "Unit", "text"),
          col("quantity", "Quantity", "ratio"),
          col("price", "Rate", "money"),
          col("gst", "GST %", "percent"),
          col("amount", "Amount", "money"),
        ],
        rows: [
          ...o.lines.map((l) => row({
            no: String(l.lineNo),
            item: l.item,
            unit: l.unit,
            quantity: l.quantity,
            price: l.unitPrice,
            gst: l.gstRate ?? null,
            amount: amount(l),
          })),
          total({ item: "Total", amount: sum }),
        ],
        empty: "Nothing has been added to this order yet.",
      },
    ],
    footnotes: [
      `Why this was asked for: ${o.reason}`,
      /* Said on the paper, because the supplier is the person who finds
         out otherwise. */
      "Prices are as agreed, before GST, at the GST rate shown where one is. Anything not priced here has not been agreed and must not be supplied.",
      "This order is sent by hand - printed, or attached to a message. Nothing about it is sent automatically.",
    ],
  };
}
