import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Download } from "lucide-react";
import { useUi } from "@/lib/ui";
import { moneyPrecise, dateShort } from "@/lib/format";
import { BUSINESS_DATE, PTD_FROM } from "@/data/repositories";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, Input, fieldProps,
  DataTable, ReadFailed, readError, EmptyState, type Column,
} from "@/components/ui";
import {
  FORMATS, getDayBook, downloadDayBook,
  type DayBook, type DayBookRow, type ExportFormat,
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

  const book = query.data ?? null;
  const chosen = FORMATS.find((f) => f.key === format) ?? FORMATS[0]!;
  const canExport = Boolean(book?.days.length) && chosen.blocked === null;

  return (
    <Page>
      <PageHeader
        title="Accounting export"
        description="Your month in the form your accountant takes. It reads the same figures the reports print and changes nothing."
        actions={
          <Button
            variant="primary"
            disabled={!canExport}
            onClick={() => { if (book) downloadDayBook(book); }}
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
              picks what their accountant asks for. Two of them say
              plainly why they produce nothing yet, rather than being
              greyed out with no reason beside them. */}
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-ink-900 mb-2">Format</legend>
            <div className="grid gap-2">
              {FORMATS.map((f) => (
                <label
                  key={f.key}
                  className="flex gap-3 items-start p-3 min-h-11 rounded-md border border-grey-300 cursor-pointer"
                >
                  <input
                    type="radio" name="format" value={f.key}
                    checked={format === f.key}
                    onChange={() => setFormat(f.key)}
                    className="mt-1 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-base text-ink-900">{f.label}</span>
                    <span className="block text-sm text-grey-600 mt-0.5">{f.what}</span>
                    {f.blocked && (
                      <span className="block text-sm text-amber-700 mt-1">{f.blocked}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>

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

/* ── The file, drawn ───────────────────────────────────────────────── */

const cash = (v: number) => moneyPrecise(v);

/** A range in which the hotel charged nothing and received nothing.
    Not the same as "no rows": there is always a row per day. */
const quiet = (book: DayBook) =>
  book.total.sales === 0 && book.total.tax === 0 && book.total.receipt === 0;

const COLUMNS: Column<DayBookRow>[] = [
  { key: "date", header: "Date", cell: (d) => dateShort(d.date) },
  { key: "room", header: "Room revenue", numeric: true, cell: (d) => cash(d.room) },
  { key: "roomTax", header: "Room tax", numeric: true, hideBelow: "lg", cell: (d) => cash(d.roomTax) },
  { key: "extra", header: "Extra charges", numeric: true, cell: (d) => cash(d.extra) },
  { key: "extraTax", header: "Extra tax", numeric: true, hideBelow: "lg", cell: (d) => cash(d.extraTax) },
  { key: "discount", header: "Discount", numeric: true, hideBelow: "xl", cell: (d) => cash(d.discount) },
  { key: "sales", header: "Sales", numeric: true, cell: (d) => cash(d.sales) },
  { key: "tax", header: "Tax", numeric: true, cell: (d) => cash(d.tax) },
  { key: "receipt", header: "Receipts", numeric: true, cell: (d) => cash(d.receipt) },
  /* The one column that is not a figure, and the reason this screen
     can be trusted: a day the night audit has not run is exported
     with everything it has and SAYS SO. Never quietly a zero. */
  { key: "closed", header: "Night audit", cell: (d) => (d.closed ? "Closed" : "Not run") },
];

function DayBookTable({ book, loading }: { book: DayBook | null; loading: boolean }) {
  return (
    <>
      {book && book.openDays.length > 0 && (
        <p className="text-sm text-amber-700 mb-3">
          {book.openDays.length === 1
            ? `The night audit has not run for ${dateShort(book.openDays[0]!)}. Its figures are here and may still change.`
            : `The night audit has not run for ${book.openDays.length} of these days, from ${dateShort(book.openDays[0]!)}. Their figures are here and may still change.`}
          {" "}Today is {dateShort(book.businessDate)} at this property.
        </p>
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

      {book && book.days.length > 0 && (
        <Card className="mt-3">
          <CardBody className="flex flex-wrap gap-x-8 gap-y-2 justify-end tabular">
            <span className="text-base text-grey-600">
              Sales <span className="text-ink-900 font-semibold ml-1.5">{cash(book.total.sales)}</span>
            </span>
            <span className="text-base text-grey-600">
              Tax <span className="text-ink-900 font-semibold ml-1.5">{cash(book.total.tax)}</span>
            </span>
            <span className="text-base text-grey-600">
              Receipts <span className="text-ink-900 font-semibold ml-1.5">{cash(book.total.receipt)}</span>
            </span>
          </CardBody>
        </Card>
      )}
    </>
  );
}
