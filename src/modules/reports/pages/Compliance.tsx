import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Skeleton } from "@/components/ui";
import {
  ReportShell, ReportTable, ReportHead, Amount,
} from "@/modules/reports/components/ReportShell";
import {
  getGuestLedger, getCashierShift, getGstSales, getCForm, type CFormRow,
} from "@/modules/reports/data/reportData";
import { PTD_FROM } from "@/modules/reports/data/statistics";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE FOUR REPORTS THAT WERE LISTED AND NEVER BUILT

   Each appeared on the reports index with a `stage:` note where its
   path should have been. Two of those notes were CONDITIONS, and both
   have been met:

     GST Sales Register  "needs the invoice series to be live first"
     Form III register   "needs passport capture at check-in"

   The other two — Guest Ledger and Cashier Shift — were waiting on
   nothing but the work.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

function Loading() {
  return (
    <div className="p-5 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/** A value nobody recorded. Never a zero, never an invented placeholder. */
function Unknown({ what }: { what: string }) {
  return (
    <span className="text-danger text-2xs" title={what}>
      not on record
    </span>
  );
}

/* ── Guest ledger ─────────────────────────────────────────────────── */

const GUEST_LEDGER_COLUMNS = [
  { key: "guest", label: "Guest" },
  { key: "room", label: "Room" },
  { key: "opening", label: "Opening", numeric: true },
  { key: "charges", label: "Charges", numeric: true },
  { key: "payments", label: "Received", numeric: true },
  { key: "closing", label: "Closing", numeric: true },
];

export function GuestLedgerPage() {
  const hotelId = useHotel();

  const { data, isLoading } = useQuery({
    queryKey: ["guest-ledger", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getGuestLedger(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const rows = data?.rows ?? [];
  const t = rows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      charges: acc.charges + r.charges,
      payments: acc.payments + r.payments,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, charges: 0, payments: 0, closing: 0 },
  );

  return (
    <ReportShell
      title="Guest ledger"
      period={`${dateShort(PTD_FROM)} to ${dateShort(BUSINESS_DATE)}`}
      meta={`Date From ${dateShort(PTD_FROM)} To ${dateShort(BUSINESS_DATE)}   Folios that moved in the window`}
      csv={() => ({
        headers: ["Reference", "Guest", "Room", "Status",
                  "Opening", "Charges", "Payments", "Closing"],
        rows: rows.map((r) => [
          r.reference, r.guest, r.room, r.status,
          r.opening, r.charges, r.payments, r.closing,
        ]),
      })}
    >
      {isLoading ? <Loading /> : (
        <>
          <ReportTable>
            <ReportHead columns={GUEST_LEDGER_COLUMNS} />
            <tbody>
              {rows.map((r) => (
                <tr key={r.folioId} className="border-b border-grey-100">
                  <td className="px-4 py-2 text-ink-900">
                    {r.guest}
                    <span className="text-grey-500 text-2xs tabular ml-1.5">
                      {r.reference}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular text-grey-600">{r.room}</td>
                  <td className="px-4 py-2 text-right">
                    <Amount value={r.opening} format={money} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Amount value={r.charges} format={money} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Amount value={r.payments} format={money} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Amount value={r.closing} format={money} bold />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-grey-500">
                    No folio moved in this window.
                  </td>
                </tr>
              )}
              <tr className="bg-grey-50 border-t-2 border-ink-900">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-ink-900">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.opening} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.charges} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.payments} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.closing} format={money} bold /></td>
              </tr>
            </tbody>
          </ReportTable>

          <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
            Opening is the folio balance strictly before the window; closing
            includes everything up to and including the last day. A reversed
            charge and its reversal are both excluded — counting the pair would
            show two movements that net to nothing.
          </p>
        </>
      )}
    </ReportShell>
  );
}

/* ── Cashier shift ────────────────────────────────────────────────── */

const CASHIER_COLUMNS = [
  { key: "cashier", label: "Cashier" },
  { key: "method", label: "Method" },
  { key: "count", label: "Receipts", numeric: true },
  { key: "amount", label: "Amount", numeric: true },
];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Credit card",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  city_ledger: "City ledger",
  unrecorded: "Unrecorded",
};

export function CashierShiftPage() {
  const hotelId = useHotel();

  const { data, isLoading } = useQuery({
    queryKey: ["cashier-shift", hotelId, BUSINESS_DATE],
    queryFn: () => getCashierShift(hotelId, BUSINESS_DATE, BUSINESS_DATE),
  });

  const rows = data?.rows ?? [];
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const count = rows.reduce((n, r) => n + r.count, 0);

  return (
    <ReportShell
      title="Cashier shift"
      period={dateShort(BUSINESS_DATE)}
      meta={`Business date ${dateShort(BUSINESS_DATE)}   Receipts by cashier and method`}
      csv={() => ({
        headers: ["Cashier", "Method", "Receipts", "Amount"],
        /* Named columns, not Object.values. Key order is not column
           order, and a report that silently reshuffles when somebody
           adds a field is worse than one that fails to compile. */
        rows: rows.map((r) => [
          /* A dash, never "System". 042 established that a posting with
             no attributed staff says so. */
          r.cashier ?? "-", r.method, r.count, r.amount,
        ]),
      })}
    >
      {isLoading ? <Loading /> : (
        <>
          <ReportTable>
            <ReportHead columns={CASHIER_COLUMNS} />
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.staffId ?? "none"}-${r.method}-${i}`} className="border-b border-grey-100">
                  <td className="px-4 py-2 text-ink-900">
                    {r.cashier ?? <Unknown what="This posting predates staff attribution." />}
                  </td>
                  <td className="px-4 py-2 text-grey-600">
                    {METHOD_LABEL[r.method] ?? r.method}
                  </td>
                  <td className="px-4 py-2 text-right tabular">{r.count}</td>
                  <td className="px-4 py-2 text-right">
                    <Amount value={r.amount} format={money} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-grey-500">
                    Nothing was taken on this date.
                  </td>
                </tr>
              )}
              <tr className="bg-grey-50 border-t-2 border-ink-900">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-ink-900">Total</td>
                <td className="px-4 py-2.5 text-right tabular font-semibold">{count}</td>
                <td className="px-4 py-2.5 text-right"><Amount value={total} format={money} bold /></td>
              </tr>
            </tbody>
          </ReportTable>

          <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
            A receipt whose posting has been reversed is not money the cashier
            holds, so it is excluded - the same definition the Manager Report
            uses. A blank cashier is a posting made before this system recorded
            who made it; naming somebody would be worse than the dash.
          </p>
        </>
      )}
    </ReportShell>
  );
}

/* ── GST sales register ───────────────────────────────────────────── */

const GST_COLUMNS = [
  { key: "number", label: "Invoice" },
  { key: "issued", label: "Date" },
  { key: "recipient", label: "Recipient" },
  { key: "gstin", label: "GSTIN" },
  { key: "type", label: "Type" },
  { key: "pos", label: "Place" },
  { key: "taxable", label: "Taxable", numeric: true },
  { key: "cgst", label: "CGST", numeric: true },
  { key: "sgst", label: "SGST", numeric: true },
  { key: "total", label: "Total", numeric: true },
];

export function GstSalesPage() {
  const hotelId = useHotel();

  const { data, isLoading } = useQuery({
    queryKey: ["gst-sales", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getGstSales(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const rows = data?.rows ?? [];
  const t = rows.reduce(
    (acc, r) => ({
      taxable: acc.taxable + r.taxable,
      cgst: acc.cgst + r.cgst,
      sgst: acc.sgst + r.sgst,
      total: acc.total + r.total,
    }),
    { taxable: 0, cgst: 0, sgst: 0, total: 0 },
  );

  return (
    <ReportShell
      title="GST sales register"
      period={`${dateShort(PTD_FROM)} to ${dateShort(BUSINESS_DATE)}`}
      meta={`GSTR-1 extract   Every document issued in the period, credit notes included`}
      csv={() => ({
        /* The columns a GSTR-1 upload wants. Credit notes carry their
           own row with the invoice they credit, because that is how the
           return reads them — not as an adjustment to the original. */
        headers: [
          "Invoice number", "Issued", "Recipient", "Recipient GSTIN", "Type",
          "Place of supply", "SAC", "Taxable value",
          "CGST", "SGST", "Total", "Credits invoice",
        ],
        rows: rows.map((r) => [
          r.number, r.issued, r.recipient ?? "", r.gstin ?? "", r.type,
          r.placeOfSupply ?? "", r.sac,
          r.taxable, r.cgst, r.sgst, r.total, r.creditsInvoice ?? "",
        ]),
      })}
    >
      {isLoading ? <Loading /> : (
        <>
          <ReportTable>
            <ReportHead columns={GST_COLUMNS} />
            <tbody>
              {rows.map((r) => (
                <tr key={r.number} className="border-b border-grey-100">
                  <td className="px-4 py-2 tabular text-ink-900">
                    {r.number}
                    {r.creditsInvoice && (
                      <span className="block text-2xs text-danger">
                        credits {r.creditsInvoice}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular text-grey-600">{dateShort(r.issued)}</td>
                  <td className="px-4 py-2 text-grey-700">{r.recipient ?? "-"}</td>
                  <td className="px-4 py-2 tabular text-grey-600">
                    {/* A dash, not "URP". An unregistered recipient is a
                        fact; a code invented here would not be. */}
                    {r.gstin ?? <span className="text-grey-500">-</span>}
                  </td>
                  <td className="px-4 py-2 text-grey-600" data-gst-type>{r.type}</td>
                  <td className="px-4 py-2 text-grey-600">{r.placeOfSupply ?? "-"}</td>
                  <td className="px-4 py-2 text-right"><Amount value={r.taxable} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.cgst} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.sgst} format={money} /></td>
                  <td className="px-4 py-2 text-right"><Amount value={r.total} format={money} bold /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-grey-500">
                    No invoice was issued in this period.
                  </td>
                </tr>
              )}
              <tr className="bg-grey-50 border-t-2 border-ink-900">
                <td colSpan={6} className="px-4 py-2.5 font-semibold text-ink-900">
                  Total · {rows.length} document{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.taxable} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.cgst} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.sgst} format={money} bold /></td>
                <td className="px-4 py-2.5 text-right"><Amount value={t.total} format={money} bold /></td>
              </tr>
            </tbody>
          </ReportTable>

          <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
            Credit notes appear as their own rows with negative values, because
            that is how they are filed. Netting them into the invoice would
            leave this register disagreeing with the invoices actually issued.
            Place of supply is the property's state on every row - accommodation
            is supplied where the hotel is, so a hotel supply is never IGST.
          </p>
        </>
      )}
    </ReportShell>
  );
}

/* ── The Form III register ────────────────────────────────────────── */

const CFORM_COLUMNS = [
  { key: "guest", label: "Guest" },
  { key: "passport", label: "Passport and visa" },
  { key: "arrival", label: "Arrival" },
  { key: "departure", label: "Departure" },
  { key: "filed", label: "Portal numbers" },
];

/* Form III's own order (G.S.R. 596(E)), then the portal's other boxes. */
const CFORM_CSV: Array<[string, keyof CFormRow]> = [
  ["Name (as in the passport)", "guest"], ["Nationality", "nationality"],
  ["Passport number", "passport"], ["Visa or OCI number", "visaNumber"],
  ["Visa type", "visaType"], ["Phone in India", "phoneInIndia"],
  ["Mobile in India", "mobileInIndia"], ["Phone outside India", "phoneAbroad"],
  ["Mobile outside India", "mobileAbroad"], ["Email", "email"],
  ["Remarks", "remarks"], ["Arrived from", "arrivedFrom"],
  ["Arrival (date and time)", "arrivedAt"], ["Purpose of visit", "purpose"],
  ["Other purpose", "purposeOther"], ["Previous place of stay", "previousStay"],
  ["Departure (date and time)", "departedAt"], ["Next destination", "nextDestination"],
  ["Gender", "gender"], ["Date of birth", "dateOfBirth"],
  ["Passport issued on", "passportIssuedOn"], ["Passport issued at", "passportIssuePlace"],
  ["Passport expiry", "passportExpiry"], ["Visa issued on", "visaIssuedOn"],
  ["Visa expiry", "visaExpiry"], ["Arrived in India on", "arrivedInIndiaOn"],
  ["Port of arrival", "arrivalPort"], ["Address abroad", "address"],
  ["Reference address in India", "refAddress"], ["Employed in India", "employedInIndia"],
  ["Room", "room"], ["Booked from", "arrived"], ["Booked to", "departed"],
  ["Portal number, arrival", "reference"], ["Portal number, departure", "departureReference"],
];

/** "YYYY-MM-DD HH:MM" in the property's clock, as the rest of the page prints a date. */
const when = (at: string) => `${dateShort(at.slice(0, 10))}, ${at.slice(11)}`;

export function CFormPage() {
  const hotelId = useHotel();

  const { data, isLoading } = useQuery({
    queryKey: ["c-form", hotelId, PTD_FROM, BUSINESS_DATE],
    queryFn: () => getCForm(hotelId, PTD_FROM, BUSINESS_DATE),
  });

  const rows = data?.rows ?? [];
  const unfiled = rows.filter((r) => !r.reference).length;

  return (
    <ReportShell
      title="Form III register"
      period={`${dateShort(PTD_FROM)} to ${dateShort(BUSINESS_DATE)}`}
      meta={`Arrivals in the period   ${unfiled} awaiting an FRRO number`}
      csv={() => ({
        headers: CFORM_CSV.map(([h]) => h),
        /* Blanks, not "unknown". A missing passport number on a Form III
           extract is a fact the person filing has to see and chase -
           filling it with a placeholder hides exactly the row that
           needs attention. */
        rows: rows.map((r) => CFORM_CSV.map(([, k]) => r[k] ?? "")),
      })}
    >
      {isLoading ? <Loading /> : (
        <>
          {/* Said on the page, not only in the code. Somebody reading
              this must not walk away believing the filing has happened. */}
          <p className="px-4 py-3 text-2xs text-ink-900 bg-brand-yellow-50 border-b border-brand-yellow-100 leading-relaxed">
            {data?.note ??
              "This system does not file with the FRRO. Filing happens on the government portal."}
          </p>

          <ReportTable>
            <ReportHead columns={CFORM_COLUMNS} />
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.guest}-${r.arrived}-${i}`} className="border-b border-grey-100">
                  <td className="px-4 py-2 text-ink-900">
                    {r.guest}
                    <span className="block text-2xs text-grey-500">
                      {r.nationality} · room {r.room}
                      {r.address ? ` · ${r.address}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular text-grey-700">
                    {r.passport ?? <Unknown what="No document was captured at check-in." />}
                    <span className="block text-2xs text-grey-500">
                      visa {r.visaNumber ?? "-"} · {r.visaType ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular text-grey-600">
                    {r.arrivedAt ? when(r.arrivedAt) : dateShort(r.arrived)}
                    <span className="block text-2xs text-grey-500">
                      from {r.arrivedFrom ?? "-"} · {r.purpose ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular text-grey-600">
                    {r.departedAt ? when(r.departedAt) : "In house"}
                    <span className="block text-2xs text-grey-500">
                      to {r.nextDestination ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular text-2xs">
                    {r.reference
                      ? <span className="text-ink-900">{r.reference}</span>
                      : <span className="text-danger">not filed</span>}
                    {r.departedAt && (
                      <span className="block">
                        {r.departureReference
                          ? <span className="text-ink-900">{r.departureReference}</span>
                          : <span className="text-danger">departure not filed</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-grey-500">
                    No foreign national arrived in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </ReportTable>

          <p className="px-4 py-3 text-2xs text-grey-500 leading-relaxed border-t border-grey-200">
            A blank passport is a guest whose document was not captured at
            check-in. It is shown rather than hidden: the filing cannot be made
            without it, and a report that looked complete would be worse than
            one that names the gap. The download carries every Form III field.
          </p>
        </>
      )}
    </ReportShell>
  );
}
