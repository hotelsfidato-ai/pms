import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Download, Printer, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise, dateShort } from "@/lib/format";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Field, fieldProps, Input, NativeSelect, DataTable,
  StatusPill, Dialog, DialogContent, Skeleton, ReadFailed, toast, type Column,
} from "@/components/ui";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { useBillPrint } from "@/modules/pos/flows/printBill";
import {
  listBillHistory, listWaiters, getOrder, nextBillHeading, type BillHistoryAsk, type BillHistoryRow,
} from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   BILL HISTORY (the owner's D27-370, 27 October)

   Every finished bill - paid, VOID and NC - of any range of dates, found
   by its number, table, guest, how it was paid, the waiter or the outlet.
   Tap one to see the whole bill and print it again (BILL · DUPLICATE, the
   Till's own reprint); the list on screen downloads as a file Excel opens.

   It asks the Till's earlier-bills route, which answers for both. At most
   `cap` bills come back and the screen says so when more matched, so a
   short list is never mistaken for the whole of a long range.
   ══════════════════════════════════════════════════════════════════ */

const MODE_WORD: Record<string, string> = {
  cash: "Cash", card: "Card", upi: "UPI", room: "To a room", function: "To a function",
  allowance: "Owner's allowance", split: "Split",
};
const modesWords = (r: BillHistoryRow) => (r.modes.length ? r.modes.map((m) => MODE_WORD[m] ?? m).join(", ") : "-");

const STATE: Record<string, { words: string; tone: "success" | "danger" | "neutral" }> = {
  settled: { words: "Paid", tone: "success" },
  void: { words: "VOID", tone: "danger" },
  no_charge: { words: "NC", tone: "neutral" },
};

type Draft = Required<BillHistoryAsk>;
const EMPTY: Draft = { from: "", to: "", no: "", table: "", guest: "", mode: "", waiter: "", outlet: "" };

export default function BillHistoryPage() {
  const { code = "" } = useParams();
  const today = useSession((s) => s.hotels.find((h) => h.code === code)?.businessDate) ?? "";
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [applied, setApplied] = useState<Draft | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  /* It opens on today's business day, as the Till is. */
  useEffect(() => {
    if (today && applied === null) {
      const day = { ...EMPTY, from: today, to: today };
      setDraft(day);
      setApplied(day);
    }
  }, [today, applied]);

  const history = useQuery({
    queryKey: ["bill-history", code, applied],
    queryFn: () => listBillHistory(code, applied!),
    enabled: applied !== null,
    placeholderData: (previous) => previous,
  });
  const waiters = useQuery({ queryKey: ["till-waiters", code], queryFn: () => listWaiters(code) });

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.from && !draft.to && !draft.no.trim() && !draft.table.trim() && !draft.guest.trim()) {
      return setProblem("Pick the dates, or type a bill number, a table or a guest.");
    }
    if (draft.from && draft.to && draft.from > draft.to) return setProblem("The first date is after the last.");
    setProblem("");
    setApplied(draft);
  };

  const bills = history.data?.bills ?? [];
  const outletName = (c: string) => history.data?.outlets.find((o) => o.code === c)?.name ?? c;

  const download = () => {
    /* Figures are bare numbers so Excel can sum them; NC has none, and a
       blank is not a zero. The bill's own date, 2026-10-27, sorts there. */
    const csv = toCsv(
      ["Bill", "Date", "Time", "Outlet", "Table", "Guest", "Phone", "Waiter", "Paid by", "Total", "State"],
      bills.map((b) => [
        b.orderNo, b.businessDate, b.openedAt, outletName(b.outlet), b.table ?? "", b.guest ?? "",
        b.phone ?? "", b.waiter ?? "", b.modes.map((m) => MODE_WORD[m] ?? m).join(", "),
        b.status === "no_charge" ? "" : b.payable.toFixed(2), STATE[b.status]?.words ?? b.status,
      ]),
    );
    downloadCsv(reportFilename(code, "bill history", `${applied?.from || "start"} to ${applied?.to || "end"}`), csv);
    if (history.data?.capped) {
      toast.warning("Only the first " + history.data.cap + " bills", "More matched. Narrow the dates for the rest.");
    }
  };

  const columns: Column<BillHistoryRow>[] = [
    { key: "no", header: "Bill", cell: (b) => <span className="font-medium tabular">{b.orderNo}</span> },
    { key: "when", header: "Date and time", cell: (b) => <span className="tabular">{dateShort(b.businessDate)} · {b.openedAt}</span> },
    { key: "outlet", header: "Outlet", hideBelow: "lg", cell: (b) => outletName(b.outlet) },
    { key: "table", header: "Table", cell: (b) => b.table ?? "-" },
    {
      key: "guest", header: "Guest", hideBelow: "md",
      cell: (b) => b.guest || b.phone ? (
        <span>{b.guest ?? "-"}{b.phone && <span className="block text-2xs text-grey-500 tabular">{b.phone}</span>}</span>
      ) : "-",
    },
    { key: "waiter", header: "Waiter", hideBelow: "md", cell: (b) => b.waiter ?? "-" },
    { key: "mode", header: "Paid by", cell: (b) => modesWords(b) },
    {
      /* A voided bill keeps its number and its total, struck (D27-324); a
         bill given free says NC and no value (D27-351). */
      key: "total", header: "Total", numeric: true,
      cell: (b) => b.status === "no_charge" ? "NC"
        : <span className={cn(b.status === "void" && "text-grey-500 line-through")}>{moneyPrecise(b.payable)}</span>,
    },
    {
      key: "state", header: "State",
      cell: (b) => <StatusPill tone={STATE[b.status]?.tone ?? "neutral"}>{STATE[b.status]?.words ?? b.status}</StatusPill>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Bill history"
        description="Every paid, voided and NC bill of any dates. Open one to see it and print it again."
        actions={
          <Button variant="secondary" onClick={download} disabled={bills.length === 0}>
            <Download className="size-4" />
            Download to Excel
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody>
          <form onSubmit={search} className="space-y-3" data-bill-filters>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="From">
                {(f) => <Input {...fieldProps(f)} type="date" value={draft.from} max={today || undefined}
                  onChange={(e) => set("from")(e.target.value)} />}
              </Field>
              <Field label="To">
                {(f) => <Input {...fieldProps(f)} type="date" value={draft.to} max={today || undefined}
                  onChange={(e) => set("to")(e.target.value)} />}
              </Field>
              <Field label="Bill number">
                {(f) => <Input {...fieldProps(f)} value={draft.no} maxLength={40} placeholder="R-0012"
                  onChange={(e) => set("no")(e.target.value)} />}
              </Field>
              <Field label="Table">
                {(f) => <Input {...fieldProps(f)} value={draft.table} maxLength={40}
                  onChange={(e) => set("table")(e.target.value)} />}
              </Field>
              <Field label="Guest name or phone">
                {(f) => <Input {...fieldProps(f)} value={draft.guest} maxLength={60}
                  onChange={(e) => set("guest")(e.target.value)} />}
              </Field>
              <Field label="Paid by">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={draft.mode} onChange={(e) => set("mode")(e.target.value)}>
                    <option value="">Any way</option>
                    {Object.entries(MODE_WORD).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Waiter">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={draft.waiter} onChange={(e) => set("waiter")(e.target.value)}>
                    <option value="">Anyone</option>
                    {(waiters.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Outlet">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={draft.outlet} onChange={(e) => set("outlet")(e.target.value)}>
                    <option value="">All outlets</option>
                    {(history.data?.outlets ?? []).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button type="submit"><Search className="size-4" />Show bills</Button>
              <Button type="button" variant="link" onClick={() => { setDraft(EMPTY); setProblem(""); }}>Clear</Button>
              {problem && <p className="text-sm text-brand-red-700" role="alert">{problem}</p>}
            </div>
          </form>
        </CardBody>
      </Card>

      {history.data && (
        <p className="text-sm text-grey-600 mb-2" data-bill-count>
          {history.data.capped
            ? `Showing the first ${history.data.cap} bills. More matched: narrow the dates or add a filter to see the rest.`
            : `${bills.length} bill${bills.length === 1 ? "" : "s"}.`}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={bills}
        rowKey={(b) => b.id}
        loading={applied === null || (history.isLoading && !history.data)}
        error={history.isError ? history.error : undefined}
        onRetry={() => void history.refetch()}
        onRowClick={(b) => setOpened(b.id)}
        hasFilters
        onClearFilters={() => { setDraft(EMPTY); setProblem(""); }}
      />

      <OpenedBill hotelId={code} id={opened} onClose={() => setOpened(null)} />
    </Page>
  );
}

/* The whole bill, drawn by the bill's own paper (BillSlip) and printed by the
   Till's own reprint, which the server heads BILL · DUPLICATE (D27-292). */
function OpenedBill({ hotelId, id, onClose }: { hotelId: string; id: string | null; onClose: () => void }) {
  const bill = useBillPrint(hotelId);
  const order = useQuery({
    queryKey: ["bill-history-order", hotelId, id],
    queryFn: () => getOrder(hotelId, id ?? ""),
    enabled: id !== null,
    staleTime: 0,
  });
  return (
    <>
      <Dialog open={id !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent
          size="sm"
          title={order.data ? `Bill ${order.data.orderNo}` : "Bill"}
          footer={
            <>
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button disabled={!order.data}
                onClick={() => order.data && void bill.print(order.data.id, () => void order.refetch())}>
                <Printer className="size-4" />
                Print the bill
              </Button>
            </>
          }
        >
          {order.isLoading ? <Skeleton className="h-64 w-full" />
            : order.data ? <BillSlip order={order.data} heading={nextBillHeading(order.data)} />
            : <ReadFailed error={order.error} what="this bill" onRetry={() => void order.refetch()} />}
        </DialogContent>
      </Dialog>
      {bill.dialog}
    </>
  );
}
