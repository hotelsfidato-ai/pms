import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Download, TriangleAlert, ReceiptText, Landmark, Wallet } from "lucide-react";
import { useUi } from "@/lib/ui";
import { moneyPrecise, dateShort } from "@/lib/format";
import { BUSINESS_DATE, PTD_FROM } from "@/data/repositories";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, Input, fieldProps,
  DataTable, ReadFailed, readError, EmptyState, toast, FigureRow, FigureTile, type Column,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  FORMATS, getDayBook, downloadDayBook, downloadDayBookXlsx, downloadTally,
  getTallyLedgers, saveTallyLedgers, whyNot,
  type DayBook, type DayBookRow, type ExportFormat, type TallyLedgers,
} from "@/modules/accounting/data/accounting";

/* ══════════════════════════════════════════════════════════════════
   ACCOUNTING EXPORT — the hotel's month, handed to its accountant

   A date range, a format, a file. This screen is the whole service:
   it is not a ledger, it holds no chart of accounts, and it never
   posts anything back.

   WHAT IS ON THE SCREEN IS WHAT IS IN THE FILE. The table below the
   controls is the file, drawn - the same object, so nobody has to
   trust that two code paths agree. And every figure in it was read
   through the reports service's front door, so this and the Manager
   report cannot print different sales for one month.
   ══════════════════════════════════════════════════════════════════ */

/** The property in view: the one in the address, or the one the
    switcher is on. The same three lines every report screen uses. */
function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

export default function AccountingPage() {
  const hotelId = useHotel();
  /* The month so far, which is what somebody opening this screen
     nearly always wants. Both ends are INCLUDED - said out loud under
     the fields, because every other range in this system is half-open
     and an accountant losing the last day of a month would not spot
     it until the return was filed. */
  const [from, setFrom] = useState(PTD_FROM);
  const [to, setTo] = useState(BUSINESS_DATE);
  const [format, setFormat] = useState<ExportFormat>("day-book-csv");

  const ordered = Boolean(from && to) && from <= to;

  const query = useQuery({
    queryKey: ["accounting-day-book", hotelId, from, to],
    queryFn: () => getDayBook(hotelId, from, to),
    enabled: Boolean(hotelId) && ordered,
  });

  const ledgers = useQuery({
    queryKey: ["accounting-tally-ledgers", hotelId],
    queryFn: () => getTallyLedgers(hotelId),
    enabled: Boolean(hotelId),
  });

  const book = query.data ?? null;
  const chosen = FORMATS.find((f) => f.key === format) ?? FORMATS[0]!;
  const canExport = Boolean(book?.days.length) && whyNot(chosen.key, ledgers.data) === null;
  const tally = format.startsWith("tally");

  return (
    <Page>
      <PageHeader
        title="Accounting export"
        description="Your month in the form your accountant takes. It reads the same figures the reports print and changes nothing."
        actions={
          <Button
            variant="primary"
            disabled={!canExport}
            onClick={() => {
              if (!book) return;
              if (format === "day-book-csv") return downloadDayBook(book);
              const made = tally ? downloadTally(book, format) : downloadDayBookXlsx(book);
              made.catch((error: unknown) => toast.error(
                tally ? "The Tally file was not made" : "The Excel file was not made",
                error instanceof ApiError ? error.message : String(error)));
            }}
          >
            <Download className="size-4" />
            Export
          </Button>
        }
      />

      <Card className="mb-5">
        <CardHeader title="What to export" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="From" hint="This day is included.">
            {(p) => (
              <Input {...fieldProps(p)} type="date" value={from} max={to || undefined}
                onChange={(e) => setFrom(e.target.value)} />
            )}
          </Field>
          <Field
            label="To"
            hint="This day is included too."
            error={ordered ? undefined : "The last day is before the first one."}
          >
            {(p) => (
              <Input {...fieldProps(p)} type="date" value={to} min={from || undefined}
                onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>

          {/* All three formats are offered (D18-16): whoever exports
              picks what their accountant asks for. A Tally format with a
              ledger name still blank says which, rather than being greyed
              out with no reason beside it (D27-382). */}
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-ink-900 mb-2">Format</legend>
            <div className="grid gap-2">
              {FORMATS.map((f) => (
                <label
                  key={f.key}
                  /* A choice to tap: a small tile on a hairline that darkens
                     under the pointer; the chosen one is ringed in ink. */
                  className="flex gap-3 items-start px-3.5 py-3 min-h-11 rounded-lg bg-white ring-1 ring-inset ring-grey-200 hover:ring-grey-400 has-[:checked]:ring-ink-900 cursor-pointer press-tile"
                >
                  <input
                    type="radio" name="format" value={f.key}
                    checked={format === f.key}
                    onChange={() => setFormat(f.key)}
                    className="mt-0.5 size-4 shrink-0 accent-brand-orange-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-900">{f.label}</span>
                    <span className="block text-sm text-grey-500 mt-0.5">{f.what}</span>
                    {whyNot(f.key, ledgers.data) && (
                      <span className="block text-sm text-brand-yellow-800 mt-1">{whyNot(f.key, ledgers.data)}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* What a Tally file is and is not (ACC-4). Said before the press,
              because a voucher in somebody's books is hard to take back. */}
          {tally && (
            <div className="sm:col-span-2 text-sm text-grey-600 grid gap-2">
              <p>
                One Sales voucher a day, what was paid on bills, refunds, bills moved to a
                company and each company receipt, for days the night audit has closed.
                The ledgers must already be in Tally: the file creates none. A name that
                does not match stops that voucher and Tally takes the rest, so read what
                Tally reports. Put the name right, export the day again and import it again.
              </p>
              <p>
                Not in the file: credit notes and cancelled VAT bills, which the day book
                does not count; NC bills, which have no value; supplier bills, cash
                expenses and cash banked. A day's voucher does not list each bill.
              </p>
              <p>
                If a closed day is corrected, export it again and its vouchers are replaced.
                A voucher the corrected day no longer has stays in Tally until it is deleted there.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {ledgers.isError ? (
        <ReadFailed error={readError(ledgers)} what="the ledger names" onRetry={() => void ledgers.refetch()} />
      ) : ledgers.data ? (
        /* Keyed by hotel: what was typed for one hotel is never offered as another's. */
        <LedgerNames key={hotelId} hotelId={hotelId} answer={ledgers.data} />
      ) : null}

      {query.isError ? (
        <ReadFailed
          error={readError(query)}
          what="the day book"
          onRetry={() => void query.refetch()}
        />
      ) : !ordered ? (
        <EmptyState
          compact
          title="Choose a range"
          description="The last day has to fall on or after the first one."
        />
      ) : query.data === null ? (
        <EmptyState compact title="No such property" description="This is not a property you may export." />
      ) : (
        <DayBookTable book={book} loading={query.isLoading} />
      )}
    </Page>
  );
}

/* ── The ledger names in the hotel's Tally (D27-382) ───────────────── */

/** One name per ledger, exactly as in the hotel's Tally. No name is ever
    suggested: a blank stays blank, and the labels are this system's words for
    what a ledger is for, never a name. */
function LedgerNames({ hotelId, answer }: { hotelId: string; answer: TallyLedgers }) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const value = (key: string, name: string | null) => typed[key] ?? name ?? "";

  const save = useMutation({
    mutationFn: () => saveTallyLedgers(hotelId, Object.fromEntries(
      answer.ledgers.map((l) => [l.key, value(l.key, l.name)]))),
    onSuccess: (next) => {
      queryClient.setQueryData(["accounting-tally-ledgers", hotelId], next);
      setTyped({});
      toast.success("Ledger names saved");
    },
    onError: (error: unknown) => toast.error(
      "The ledger names were not saved",
      error instanceof ApiError ? error.message : String(error)),
  });

  return (
    <Card className="mb-5">
      <CardHeader
        title="Tally ledger names"
        description="Type each name exactly as it is in this hotel's Tally. No name is suggested, and none is made here."
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {answer.ledgers.map((l) => (
          <Field key={l.key} label={l.label} hint={l.what}>
            {(p) => (
              <Input {...fieldProps(p)} value={value(l.key, l.name)} maxLength={200}
                onChange={(e) => setTyped((t) => ({ ...t, [l.key]: e.target.value }))} />
            )}
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Save ledger names
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── The file, drawn ───────────────────────────────────────────────── */

const cash = (v: number) => moneyPrecise(v);

/** A range in which the hotel charged nothing and received nothing.
    Not the same as "no rows": there is always a row per day. */
const quiet = (book: DayBook) =>
  book.total.sales === 0 && book.total.tax === 0 && book.total.vat === 0
  && book.total.receipt === 0 && (book.total.companyReceipt ?? 0) === 0;

const COLUMNS: Column<DayBookRow>[] = [
  /* One line: fifteen columns since ACC-3, and a date broken over three
     lines reads as three rows. The table scrolls inside its card instead. */
  { key: "date", header: "Date", cell: (d) => <span className="whitespace-nowrap">{dateShort(d.date)}</span> },
  { key: "room", header: "Room revenue", numeric: true, cell: (d) => cash(d.room) },
  { key: "roomTax", header: "Room tax", numeric: true, hideBelow: "lg", cell: (d) => cash(d.roomTax) },
  /* Food on a bill, apart from the other extras (ACC-3, D27-382). */
  { key: "food", header: "Food charged to a room", numeric: true, cell: (d) => cash(d.food) },
  { key: "otherExtra", header: "Other extras", numeric: true, cell: (d) => cash(d.otherExtra) },
  { key: "extraTax", header: "Extra tax", numeric: true, hideBelow: "lg", cell: (d) => cash(d.extraTax) },
  /* What the outlets took, as the file has it (D24-24). */
  { key: "pos", header: "Restaurant", numeric: true, hideBelow: "lg", cell: (d) => cash(d.pos) },
  { key: "posTax", header: "Restaurant tax", numeric: true, hideBelow: "xl", cell: (d) => cash(d.posTax) },
  { key: "discount", header: "Discount", numeric: true, hideBelow: "xl", cell: (d) => cash(d.discount) },
  /* Alcohol and its VAT, apart from everything GST (D21-91). */
  { key: "alcohol", header: "Alcohol", numeric: true, hideBelow: "xl", cell: (d) => cash(d.alcohol) },
  { key: "vat", header: "VAT", numeric: true, hideBelow: "lg", cell: (d) => cash(d.vat) },
  { key: "sales", header: "Sales", numeric: true, cell: (d) => cash(d.sales) },
  { key: "tax", header: "GST", numeric: true, cell: (d) => cash(d.tax) },
  { key: "receipt", header: "Receipts", numeric: true, cell: (d) => cash(d.receipt) },
  /* What companies paid on the City ledger (D27-242): receipts, apart
     from sales and from the guests' receipts. */
  { key: "companyReceipt", header: "Received from companies", numeric: true, hideBelow: "lg",
    cell: (d) => cash(d.companyReceipt ?? 0) },
  /* The one column that is not a figure, and the reason this screen
     can be trusted: a day the night audit has not run is exported
     with everything it has and SAYS SO. Never quietly a zero. */
  { key: "closed", header: "Night audit", cell: (d) => (d.closed ? "Closed" : "Not run") },
];

function DayBookTable({ book, loading }: { book: DayBook | null; loading: boolean }) {
  return (
    <>
      {book && book.openDays.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-yellow-100 bg-brand-yellow-50 px-4 py-3.5 mb-3">
          <TriangleAlert className="size-4 text-brand-yellow-800 shrink-0 mt-0.5" />
          <p className="min-w-0 text-sm text-brand-yellow-800">
            {book.openDays.length === 1
              ? `The night audit has not run for ${dateShort(book.openDays[0]!)}. Its figures are here and may still change.`
              : `The night audit has not run for ${book.openDays.length} of these days, from ${dateShort(book.openDays[0]!)}. Their figures are here and may still change.`}
            {" "}Today is {dateShort(book.businessDate)} at this property.
          </p>
        </div>
      )}

      {/* A range where nothing was charged and nothing was received is a
          real answer, and the file of zeros it produces is truthful - but
          somebody about to send that to their accountant should be told
          before they do, not after. It is said HERE rather than as the
          table's empty state: `dailyFigures` returns a row for every day
          of the range whether or not anything happened, so the table is
          never empty and that state could never have appeared (ACC-8). */}
      {book && quiet(book) && (
        <p className="text-sm text-grey-600 mb-3">
          Nothing was charged or received in this range. The file will have a
          row for each day, all of them nil.
        </p>
      )}

      <DataTable
        columns={COLUMNS}
        rows={book?.days ?? []}
        rowKey={(d) => d.date}
        loading={loading}
        stickyHeader
      />

      {/* The two bases, said once, where somebody comparing the two
          files is standing (ACC-6, the owner's answer of 19 September).
          This counts the LEDGER by day; the Lodging tax report counts
          the BILLS that were issued, because a return is filed from the
          bills. For a month with a stay still in house the two do not
          tie out, and that is correct in both of them. */}
      {book && book.days.length > 0 && (
        <p className="text-sm text-grey-600 mt-3">
          This counts what was charged and received each day. The Lodging tax
          report counts the bills that were issued, so a stay still in house
          appears here and not there.
        </p>
      )}

      {/* ACC-3, the owner's D27-382. Said where the two columns are read. */}
      {book && book.days.length > 0 && (
        <p className="text-sm text-grey-600 mt-2">
          Food charged to a room is food on a bill: charged at the desk, or a
          restaurant bill charged to a room or a function. Other extras are
          laundry, the spa, drinks that are not alcohol, late check-out and the
          rest. What the restaurant took itself is under Restaurant.
        </p>
      )}

      {/* The range's totals, on the Figure Rule: level tiles, label with
          its chip over the figure. */}
      {book && book.days.length > 0 && (
        <FigureRow className="sm:grid-cols-2 lg:grid-cols-4 mt-3">
          <FigureTile icon={<ReceiptText />} label="Sales" value={cash(book.total.sales)} />
          <FigureTile icon={<Landmark />} label="Tax" value={cash(book.total.tax)} />
          <FigureTile icon={<Wallet />} label="Receipts" value={cash(book.total.receipt)} />
          <FigureTile icon={<Wallet />} label="Received from companies"
                      value={cash(book.total.companyReceipt ?? 0)} note="Apart from sales" />
        </FigureRow>
      )}

      {/* Each company receipt (D27-242): what the accountant matches against
          the bank, and what a Tally receipt voucher will be made from. */}
      {book && (book.companyReceipts ?? []).length > 0 && (
        <div className="mt-3 rounded-lg border border-grey-200 bg-white">
          <p className="px-4 pt-3 text-base font-medium">Received from companies</p>
          <ul className="divide-y divide-grey-200 px-4">
            {book.companyReceipts!.map((r, i) => (
              <li key={`${r.date}-${i}`} className="flex items-baseline gap-3 py-2.5">
                <span className="text-sm text-grey-600 whitespace-nowrap">{dateShort(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.account} · {r.method}{r.reference ? ` · ${r.reference}` : ""}
                </span>
                <span className="tabular">{cash(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
