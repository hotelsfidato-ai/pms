import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { FileText, GlassWater, Pencil, Plus, Sparkles } from "lucide-react";
import { bottlesAndMl, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, EmptyState, NativeSelect, Input,
  Segmented, StatusPill, toast, Dialog, DialogContent, Field, fieldProps, Checkbox,
} from "@/components/ui";
import { BarBills, BAR_RECORDERS } from "@/modules/purchasing";
import { getBarPours, saveBarPours, type BarDish, type BarPours, type Pour } from "@/modules/stores/data/barPours";
import {
  getBarSheet, saveBarCount, setSheetFormat, markBarClosed, undoBarClosed, downloadRegister,
  getBarRequests, askTheStore, approveRequest, rejectRequest, addBarDrink, editBarDrink, LIQUORS,
  type BarSheet, type SheetDrink, type SheetFormat, type Place, type Moment, type CountAs, type DrinkInput,
} from "@/modules/stores/data/barSheet";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK (the owner's D27-354; the store and the counter, D27-361)

   One place for the bar, in the Restaurant menu: TODAY'S SHEET, the bar
   register on paper in the system - for the BAR COUNTER (opening, from the
   store, sold - NIP, 30, 60, 90 ml and loose ml - closing, rate, amount) or
   the BAR STORE (opening, bills, to the counter, closing) - and the closing
   count or the morning count typed into it; REQUESTS, the counter asking
   the store and the GM or the Inventory Manager approving; BILLS, recorded
   as printed; SET UP, the bar's drinks (how each is counted, where it sits
   in the excise registers), what each dish takes and how the sheet looks.
   The same parts are Inventory's Bar tab.
   ══════════════════════════════════════════════════════════════════ */

type Part = "sheet" | "requests" | "bills" | "setup";
const PARTS: Part[] = ["sheet", "requests", "bills", "setup"];

export default function BarStockPage() {
  const { code = "" } = useParams<{ code: string }>();
  return (
    <Page>
      <PageHeader
        title="Bar stock"
        description="The bar's day: what came, what was sold, what is left, and the count."
        actions={
          <Button asChild variant="secondary" leadingIcon={<FileText />}>
            <Link to="/reports/bar-stock">Bar stock report</Link>
          </Button>
        }
      />
      <BarStockBody code={code} />
    </Page>
  );
}

export function BarStockBody({ code }: { code: string }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("part") as Part | null;
  const part: Part = asked && PARTS.includes(asked) ? asked : "sheet";
  const go = (p: Part) => setParams((all) => {
    const next = new URLSearchParams(all);
    if (p === "sheet") next.delete("part"); else next.set("part", p);
    return next;
  }, { replace: true });

  return (
    <div className="space-y-4">
      <Segmented value={part} onChange={go}
        options={[{ value: "sheet", label: "Today's sheet" }, { value: "requests", label: "Requests" },
                  { value: "bills", label: "Bills" }, { value: "setup", label: "Set up" }]} />
      {part === "sheet" ? <Sheet code={code} onRequests={() => go("requests")} />
        : part === "requests" ? <Requests code={code} />
        : part === "bills" ? <Bills code={code} /> : <SetUp code={code} />}
    </div>
  );
}

/* ── Today's sheet ─────────────────────────────────────────────────── */

/** The open one's part at this place: a poured bottle's ml, an open
    packet's sticks; null where it is counted whole (the store, beer). */
function subOf(d: SheetDrink, place: Place): { size: number; label: string } | null {
  if (place === "store") return null;
  if (d.countAs === "poured" && d.sizeMl) return { size: d.sizeMl, label: "ml" };
  if (d.countAs === "packet" && d.packSize && d.packSize > 1) return { size: d.packSize, label: "sticks" };
  return null;
}
const wholeWord = (d: SheetDrink) => (d.countAs === "packet" ? "packets" : d.countAs === "poured" ? "NIPs" : "bottles");

/** "5 + 120 ml", "3 + 4 sticks", "120 ml" - or the count, counted whole. */
function held(q: number, d: SheetDrink, place: Place): string {
  const sub = subOf(d, place);
  if (!sub) return String(Math.round(q * 1000) / 1000);
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const whole = Math.floor(a + 1e-9);
  const rest = Math.round((a - whole) * sub.size);
  if (!rest) return `${sign}${whole}`;
  return whole === 0 ? `${sign}${rest} ${sub.label}` : `${sign}${whole} + ${rest} ${sub.label}`;
}

/** Full bottles and the ml of the open one, for the paper register's two columns. */
function split(q: number, d: SheetDrink): { nip: string; ml: string } {
  if (!d.poured || !d.sizeMl) return { nip: held(q, d, "counter"), ml: "" };
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const whole = Math.floor(a + 1e-9);
  const ml = Math.round((a - whole) * d.sizeMl);
  return { nip: `${sign}${whole}`, ml: ml ? `${sign}${ml}` : "" };
}

const differenceText = (diff: number, d: SheetDrink, place: Place) =>
  Math.abs(diff) < 0.0005 ? "matches" : `${diff > 0 ? "+" : "-"}${held(Math.abs(diff), d, place)}`;

type CountDraft = Record<string, { nip: string; ml: string }>;

/** The typed count as one figure, or null when the line is blank; a reason when it cannot be. */
function countOf(d: SheetDrink, x: { nip: string; ml: string } | undefined, place: Place): number | null | string {
  if (!x || (x.nip.trim() === "" && x.ml.trim() === "")) return null;
  const nip = x.nip.trim() === "" ? 0 : Number(x.nip);
  const ml = x.ml.trim() === "" ? 0 : Number(x.ml);
  if (!Number.isFinite(nip) || nip < 0) return `${d.name}: a count is zero or more.`;
  const sub = subOf(d, place);
  if (!Number.isInteger(nip)) return `${d.name}: whole ${wholeWord(d)}.`;
  if (!sub) return nip;
  if (!Number.isInteger(ml) || ml < 0 || ml >= sub.size) {
    return `${d.name}: whole ${wholeWord(d)}, and the open one's ${sub.label} under ${sub.size}.`;
  }
  return Math.round((nip + ml / sub.size) * 1000) / 1000;
}

function Sheet({ code, onRequests }: { code: string; onRequests: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [place, setPlace] = useState<Place>("counter");
  const [moment, setMoment] = useState<Moment>("closing");
  const q = useQuery({ queryKey: ["bar-sheet", code, date ?? "today", place], queryFn: () => getBarSheet(code, date, place) });
  const [draft, setDraft] = useState<CountDraft>({});
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState title="The bar's sheet did not load" onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s.store) {
    return <Card><CardBody className="text-sm text-grey-600">
      This hotel has no bar store marked. Mark it in Places and suppliers.
    </CardBody></Card>;
  }
  const all = s.groups.flatMap((g) => g.drinks);
  const counting = s.mayCount;
  const today = s.date === s.businessDate;
  const typed = all.filter((d) => countOf(d, draft[d.id], s.place) !== null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });

  const save = async () => {
    const lines: { itemId: string; book: number; counted: number }[] = [];
    for (const d of typed) {
      const n = countOf(d, draft[d.id], s.place);
      if (typeof n === "string") return toast.error("Not saved", n);
      lines.push({ itemId: d.id, book: d.onHand, counted: n! });
    }
    setSaving(true);
    const res = await saveBarCount(code, s.place, moment, lines);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(moment === "morning" ? "The morning count is saved" : "The closing count is saved", res.recorded
      ? `${res.recorded} difference${res.recorded === 1 ? "" : "s"} corrected; ${res.matched} matched.`
      : "Everything counted matched the book.");
    setDraft({});
    refresh();
  };
  const closeBar = async () => {
    const res = await markBarClosed(code, closing ?? "");
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("The bar is marked closed today", "The night audit will not wait for its count.");
    setClosing(null);
    refresh();
  };
  const openBar = async () => {
    const res = await undoBarClosed(code);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success("The bar is open today", "The night audit waits for its closing count again.");
    refresh();
  };
  const register = async (which: "flr-daily" | "flr-monthly") => {
    try { await downloadRegister(code, which, s.date); }
    catch (error) { toast.error("The register did not download", (error as Error).message); }
  };

  const totalAmount = all.every((d) => d.amount === null) ? null : all.reduce((t, d) => t + (d.amount ?? 0), 0);
  const placeName = s.place === "store" ? s.places.store?.name ?? "Bar store" : s.places.counter?.name ?? "Bar counter";

  return (
    <div className="space-y-3">
      {s.closedToday && (
        <Card><CardBody className="flex flex-wrap items-center gap-3 text-sm">
          <StatusPill tone="warning">Bar closed today</StatusPill>
          <span className="flex-1 min-w-0 text-grey-700">{s.closedToday.reason}{s.closedToday.by ? ` - ${s.closedToday.by}` : ""}</span>
          {s.mayCloseBar && today && <Button size="sm" variant="secondary" onClick={() => void openBar()}>The bar opened</Button>}
        </CardBody></Card>
      )}
      {s.pendingRequests > 0 && (
        <Card><CardBody className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex-1 min-w-0 text-ink-900">
            {s.pendingRequests === 1 ? "One request from the counter waits" : `${s.pendingRequests} requests from the counter wait`} for the GM or the Inventory Manager.
          </span>
          <Button size="sm" variant="secondary" onClick={onRequests}>Open requests</Button>
        </CardBody></Card>
      )}
      <Card className="overflow-hidden">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-grey-600">Day</span>
              <Input id="bar-sheet-day" type="date" className="w-44" value={s.date} max={s.businessDate}
                onChange={(e) => { setDate(e.target.value || undefined); setDraft({}); }} />
            </label>
            {s.places.counter && (
              <Segmented value={s.place} onChange={(p) => { setPlace(p); setDraft({}); }}
                options={[{ value: "counter", label: s.places.counter.name }, { value: "store", label: s.places.store?.name ?? "Bar store" }]} />
            )}
            {counting && (
              <Segmented value={moment} onChange={(m) => { setMoment(m); setDraft({}); }}
                options={[{ value: "closing", label: "Closing count" }, { value: "morning", label: "Morning count" }]} />
            )}
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {s.mayApprove && (
                <>
                  <Button size="sm" variant="secondary" leadingIcon={<FileText />} onClick={() => void register("flr-daily")}>FLR-1A/2A/3A</Button>
                  <Button size="sm" variant="secondary" leadingIcon={<FileText />} onClick={() => void register("flr-monthly")}>FLR-3</Button>
                </>
              )}
              {counting && (
                <Button variant="primary" loading={saving} disabled={typed.length === 0} onClick={() => void save()}>
                  Save the {moment === "morning" ? "morning" : "closing"} count{typed.length ? ` (${typed.length})` : ""}
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-grey-600">
            {!today ? `${placeName}, an earlier day: the count is typed on today's sheet.`
              : !counting ? `${placeName}, today.`
              : moment === "morning"
                ? `${placeName}: the morning count, before the first KOT. A difference from last night's count shows in red.`
                : `${placeName}: the closing count, before the night audit. Type each drink you count; a blank line is not counted.`}
          </p>
          {s.mayCloseBar && today && !s.closedToday && (
            closing === null ? (
              <button type="button" className="text-sm font-medium text-ink-900 underline underline-offset-2"
                onClick={() => setClosing("")}>The bar did not open today</button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Why the bar did not open" className="flex-1 min-w-56">
                  {(f) => <Input {...fieldProps(f)} value={closing} placeholder="Dry day"
                    onChange={(e) => setClosing(e.target.value)} />}
                </Field>
                <Button variant="primary" disabled={!closing.trim()} onClick={() => void closeBar()}>Mark the bar closed today</Button>
                <Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
              </div>
            )
          )}
          {all.length === 0 ? (
            <EmptyState icon={<GlassWater />} title={`Nothing in the ${placeName}`}
              description={s.place === "store" ? "A bar bill recorded puts its drinks here." : "A request approved moves drinks here from the store."} />
          ) : s.place === "counter" && s.format === "paper"
            ? <PaperSheet sheet={s} draft={draft} onDraft={setDraft} />
            : <SimpleSheet sheet={s} draft={draft} onDraft={setDraft} />}
          {totalAmount !== null && s.place === "counter" && s.format === "paper" && (
            <p className="text-right text-base font-medium text-ink-900 tabular">Amount, all drinks: {money(totalAmount)}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const TH = "text-2xs font-semibold uppercase tracking-wide text-grey-500 px-2 h-8 whitespace-nowrap text-right";
const TD = "px-2 py-1.5 text-right tabular whitespace-nowrap";
const FIRST = "sticky left-0 z-10 bg-white text-left border-r border-grey-200";

/** A menu section's heading row: the name stays in sight when the table scrolls. */
function SectionRow({ section, span }: { section: string; span: number }) {
  return (
    <tr className="bg-grey-50 border-b border-grey-100">
      <td className="sticky left-0 z-10 bg-grey-50 px-2 py-1.5 text-xs font-semibold text-ink-700 whitespace-nowrap">{section}</td>
      <td colSpan={span - 1} />
    </tr>
  );
}

type OnDraft = (f: (x: CountDraft) => CountDraft) => void;

function CountBoxes({ d, draft, onDraft, place }: { d: SheetDrink; draft: CountDraft; onDraft: OnDraft; place: Place }) {
  const x = draft[d.id] ?? { nip: "", ml: "" };
  const set = (patch: Partial<{ nip: string; ml: string }>) => onDraft((all) => ({ ...all, [d.id]: { ...x, ...patch } }));
  const sub = subOf(d, place);
  return (
    <div className="flex items-center justify-end gap-1">
      <Input className="w-14 h-8 text-right tabular" inputMode="numeric" aria-label={`Counted, ${d.name}, ${wholeWord(d)}`}
        value={x.nip} onChange={(e) => set({ nip: e.target.value })} />
      {sub && (
        <Input className="w-16 h-8 text-right tabular" inputMode="numeric" aria-label={`Counted, ${d.name}, ${sub.label} in the open one`}
          placeholder={sub.label} value={x.ml} onChange={(e) => set({ ml: e.target.value })} />
      )}
    </div>
  );
}

/** The difference the typed count makes today, or the day's closing count made. */
function Difference({ d, draft, sheet }: { d: SheetDrink; draft: CountDraft; sheet: BarSheet }) {
  if (sheet.mayCount) {
    const n = countOf(d, draft[d.id], sheet.place);
    if (typeof n === "number") {
      const diff = n - d.onHand;
      return <span className={cn(Math.abs(diff) >= 0.0005 && "text-brand-red-700 font-medium")}>{differenceText(diff, d, sheet.place)}</span>;
    }
  }
  if (d.counted !== null && d.countBook !== null) {
    const diff = d.counted - d.countBook;
    return <span className={cn(Math.abs(diff) >= 0.0005 && "text-brand-red-700")}>{differenceText(diff, d, sheet.place)}</span>;
  }
  return <span className="text-grey-400">-</span>;
}

/** The morning count against the book: anything but "matches" moved overnight. */
function Morning({ d, place }: { d: SheetDrink; place: Place }) {
  if (d.morning === null || d.morningBook === null) return <span className="text-grey-400">-</span>;
  const diff = d.morning - d.morningBook;
  return <span className={cn(Math.abs(diff) >= 0.0005 && "text-brand-red-700 font-medium")}>{differenceText(diff, d, place)}</span>;
}

function PaperSheet({ sheet, draft, onDraft }: { sheet: BarSheet; draft: CountDraft; onDraft: OnDraft }) {
  const blank = (n: number) => (n ? String(n) : "");
  return (
    <div className="overflow-x-auto scrollbar-quiet -mx-4 sm:mx-0" data-bar-sheet="paper">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-grey-50 border-b border-grey-200">
          <tr>
            <th rowSpan={2} className={cn(TH, FIRST, "bg-grey-50 text-left")}>Products</th>
            <th colSpan={2} className={cn(TH, "text-center border-l border-grey-200")}>Opening</th>
            <th rowSpan={2} className={cn(TH, "border-l border-grey-200")}>Recd</th>
            <th colSpan={2} className={cn(TH, "text-center border-l border-grey-200")}>Total</th>
            <th colSpan={5} className={cn(TH, "text-center border-l border-grey-200")}>Sell</th>
            <th colSpan={2} className={cn(TH, "text-center border-l border-grey-200")}>Closing</th>
            <th rowSpan={2} className={cn(TH, "border-l border-grey-200")}>Rate</th>
            <th rowSpan={2} className={TH}>Amount</th>
            <th rowSpan={2} className={cn(TH, "border-l border-grey-200")}>Counted</th>
            <th rowSpan={2} className={TH}>Difference</th>
            <th rowSpan={2} className={TH}>Morning</th>
          </tr>
          <tr>
            {["Nip", "ML"].map((h, i) => <th key={`o${h}`} className={cn(TH, i === 0 && "border-l border-grey-200")}>{h}</th>)}
            {["Nip", "ML"].map((h, i) => <th key={`t${h}`} className={cn(TH, i === 0 && "border-l border-grey-200")}>{h}</th>)}
            {["Nip", "30", "60", "90", "ML"].map((h, i) => <th key={`s${h}`} className={cn(TH, i === 0 && "border-l border-grey-200")}>{h}</th>)}
            {["Nip", "ML"].map((h, i) => <th key={`c${h}`} className={cn(TH, i === 0 && "border-l border-grey-200")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sheet.groups.map((g) => (
            <Fragment key={g.section}>
              <SectionRow section={g.section} span={19} />
              {g.drinks.map((d) => {
                const open = split(d.opening, d);
                const total = split(d.opening + d.received, d);
                const close = split(d.closing, d);
                return (
                  <tr key={d.id} className="border-b border-grey-100">
                    <td className={cn(TD, FIRST, "text-ink-900 font-medium")}>{d.name}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>{open.nip}</td><td className={TD}>{open.ml}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>{blank(d.received)}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>{total.nip}</td><td className={TD}>{total.ml}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>{d.poured ? blank(d.sell.nip) : blank(d.sold)}</td>
                    <td className={TD}>{blank(d.sell.p30)}</td><td className={TD}>{blank(d.sell.p60)}</td>
                    <td className={TD}>{blank(d.sell.p90)}</td><td className={TD}>{blank(d.sell.ml)}</td>
                    <td className={cn(TD, "border-l border-grey-100 font-medium text-ink-900")}>{close.nip}</td>
                    <td className={cn(TD, "font-medium text-ink-900")}>{close.ml}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>{d.rate === null ? "-" : money(d.rate)}</td>
                    <td className={TD}>{d.amount === null ? "-" : money(d.amount)}</td>
                    <td className={cn(TD, "border-l border-grey-100")}>
                      {sheet.mayCount ? <CountBoxes d={d} draft={draft} onDraft={onDraft} place={sheet.place} />
                        : d.counted === null ? "-" : held(d.counted, d, sheet.place)}
                    </td>
                    <td className={TD}><Difference d={d} draft={draft} sheet={sheet} /></td>
                    <td className={TD}><Morning d={d} place={sheet.place} /></td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleSheet({ sheet, draft, onDraft }: { sheet: BarSheet; draft: CountDraft; onDraft: OnDraft }) {
  const store = sheet.place === "store";
  return (
    <div className="overflow-x-auto scrollbar-quiet -mx-4 sm:mx-0" data-bar-sheet={store ? "store" : "simple"}>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-grey-50 border-b border-grey-200">
          <tr>
            <th className={cn(TH, FIRST, "bg-grey-50 text-left")}>Drink</th>
            <th className={TH}>Opening</th><th className={TH}>{store ? "Received" : "From the store"}</th>
            <th className={TH}>{store ? "To the counter" : "Sold"}</th>
            <th className={TH}>Closing</th><th className={TH}>Counted</th><th className={TH}>Difference</th>
            <th className={TH}>Morning</th>
          </tr>
        </thead>
        <tbody>
          {sheet.groups.map((g) => (
            <Fragment key={g.section}>
              <SectionRow section={g.section} span={8} />
              {g.drinks.map((d) => (
                <tr key={d.id} className="border-b border-grey-100">
                  <td className={cn(TD, FIRST, "text-ink-900 font-medium")}>{d.name}</td>
                  <td className={TD}>{held(d.opening, d, sheet.place)}</td>
                  <td className={TD}>{held(d.received, d, sheet.place)}</td>
                  <td className={TD}>{held(store ? d.moved : d.sold, d, sheet.place)}</td>
                  <td className={cn(TD, "font-medium text-ink-900")}>{held(d.closing, d, sheet.place)}</td>
                  <td className={TD}>
                    {sheet.mayCount ? <CountBoxes d={d} draft={draft} onDraft={onDraft} place={sheet.place} />
                      : d.counted === null ? "-" : held(d.counted, d, sheet.place)}
                  </td>
                  <td className={TD}><Difference d={d} draft={draft} sheet={sheet} /></td>
                  <td className={TD}><Morning d={d} place={sheet.place} /></td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Requests: the counter asks the store (D27-361) ────────────────── */

function Requests({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bar-requests", code], queryFn: () => getBarRequests(code) });
  const pours = useQuery({ queryKey: ["bar-pours", code], queryFn: () => getBarPours(code) });
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: "", qty: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);

  if (q.isPending || pours.isPending) return <Skeleton className="h-64" />;
  if (q.isError || pours.isError) return <ErrorState title="The requests did not load" onRetry={() => { void q.refetch(); void pours.refetch(); }} />;
  const { mayAsk, mayApprove, requests } = q.data;
  const drinks = pours.data.drinks;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bar-requests", code] });
    void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });
    void qc.invalidateQueries({ queryKey: ["bar-pours", code] });
  };
  const whole = (n: number) => String(Math.round(n * 1000) / 1000);
  const unitOf = (countAs: CountAs | null) => (countAs === "packet" ? "packets" : countAs === "poured" ? "NIPs/bottles" : "bottles");

  const ask = async () => {
    const chosen = lines.filter((l) => l.itemId || l.qty.trim());
    if (!chosen.length) return toast.error("Not sent", "Pick a drink and how many.");
    if (chosen.some((l) => !l.itemId || !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) {
      return toast.error("Not sent", "Each line: a drink, and how many whole NIPs, bottles or packets.");
    }
    setBusy("ask");
    const res = await askTheStore(code, chosen.map((l) => ({ itemId: l.itemId, quantity: Number(l.qty) })), note);
    setBusy(null);
    if (!res.ok) return toast.error("Not sent", res.reason);
    toast.success("Sent to the store", "The GM or the Inventory Manager approves it, and it moves to the counter.");
    setLines([{ itemId: "", qty: "" }]);
    setNote("");
    refresh();
  };
  const approve = async (id: string) => {
    setBusy(id);
    const res = await approveRequest(code, id);
    setBusy(null);
    if (!res.ok) return toast.error("Not approved", res.reason);
    toast.success("Approved", "The drinks moved from the store to the counter.");
    refresh();
  };
  const reject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    const res = await rejectRequest(code, rejecting.id, rejecting.note);
    setBusy(null);
    if (!res.ok) return toast.error("Not rejected", res.reason);
    toast.success("Rejected", "The counter sees why.");
    setRejecting(null);
    refresh();
  };

  return (
    <div className="space-y-4">
      {mayAsk && (
        <Card>
          <CardBody className="space-y-3">
            <div>
              <p className="text-base font-semibold text-ink-900">Ask the store</p>
              <p className="text-sm text-grey-600">Whole NIPs, bottles or packets. The GM or the Inventory Manager approves, and they move to the counter.</p>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label={`Drink, line ${i + 1}`} className="flex-1 min-w-56" value={l.itemId}
                  onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                  <option value="">Pick a drink</option>
                  {drinks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.onHand !== null ? ` - the store has ${whole(d.onHand)}` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <Input aria-label={`How many, line ${i + 1}`} className="w-24 tabular" inputMode="numeric" placeholder="How many"
                  value={l.qty} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setLines((all) => [...all, { itemId: "", qty: "" }])}>
                Another drink
              </Button>
              <Field label="Note (optional)" className="flex-1 min-w-48">
                {(f) => <Input {...fieldProps(f)} value={note} placeholder="For tonight's party" onChange={(e) => setNote(e.target.value)} />}
              </Field>
              <Button variant="primary" loading={busy === "ask"} onClick={() => void ask()}>Ask the store</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {requests.length === 0 ? (
        <EmptyState icon={<GlassWater />} title="No requests yet" description="The counter's requests of the store show here, waiting first." />
      ) : (
        <ul className="space-y-3" data-bar-requests>
          {requests.map((r) => (
            <li key={r.id}>
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={r.status === "pending" ? "warning" : r.status === "approved" ? "success" : "danger"}>
                      {r.status === "pending" ? "Waiting" : r.status === "approved" ? "Approved, moved" : "Rejected"}
                    </StatusPill>
                    <span className="text-sm text-grey-600">{r.requestedBy ?? "Somebody"} · {r.requestedAt}</span>
                    {r.decidedBy && <span className="text-sm text-grey-600">· {r.status === "approved" ? "approved" : "rejected"} by {r.decidedBy}, {r.decidedAt}</span>}
                  </div>
                  <ul className="text-base text-ink-900">
                    {r.lines.map((l) => (
                      <li key={l.itemId} className="flex flex-wrap gap-x-2">
                        <span className="tabular font-medium">{whole(l.quantity)}</span>
                        <span>{unitOf(l.countAs)} of {l.name}</span>
                        {r.status === "pending" && l.inStore !== null && (
                          <span className={cn("text-sm", l.inStore < l.quantity ? "text-brand-red-700 font-medium" : "text-grey-500")}>
                            (the store has {whole(l.inStore)})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {r.note && <p className="text-sm text-grey-600">Note: {r.note}</p>}
                  {r.decisionNote && <p className="text-sm text-brand-red-700">Why: {r.decisionNote}</p>}
                  {r.status === "pending" && mayApprove && (r.mine ? (
                    <p className="text-sm text-grey-600">Your own request: somebody else approves it.</p>
                  ) : rejecting?.id === r.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Why it is rejected" className="flex-1 min-w-48">
                        {(f) => <Input {...fieldProps(f)} value={rejecting.note} onChange={(e) => setRejecting({ id: r.id, note: e.target.value })} />}
                      </Field>
                      <Button variant="danger" loading={busy === r.id} disabled={!rejecting.note.trim()} onClick={() => void reject()}>Reject</Button>
                      <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" loading={busy === r.id} onClick={() => void approve(r.id)}>Approve and move</Button>
                      <Button variant="secondary" onClick={() => setRejecting({ id: r.id, note: "" })}>Reject</Button>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Bills ─────────────────────────────────────────────────────────── */

function Bills({ code }: { code: string }) {
  const mayRecord = BAR_RECORDERS.includes(useRole());
  const [recording, setRecording] = useState(false);
  return (
    <div className="space-y-3">
      {mayRecord && (
        <div className="flex justify-end">
          <Button variant="primary" leadingIcon={<Plus />} onClick={() => setRecording(true)}>Record a bar bill</Button>
        </div>
      )}
      <BarBills hotelId={code} mayRecord={mayRecord} recording={recording} onRecording={setRecording} />
    </div>
  );
}

/* ── Set up ────────────────────────────────────────────────────────── */

function SetUp({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["bar-pours", code], queryFn: () => getBarPours(code) });
  return (
    <div className="space-y-4">
      <SheetLook code={code} />
      {q.isPending ? <Skeleton className="h-64" />
        : q.isError ? <ErrorState title="What each drink takes did not load" onRetry={() => void q.refetch()} />
        : <>
            <Drinks code={code} data={q.data} />
            <WhatEachTakes code={code} data={q.data} />
          </>}
    </div>
  );
}

/** How the daily sheet looks: the owner's setting, both formats kept. */
function SheetLook({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bar-sheet", code, "today"], queryFn: () => getBarSheet(code) });
  if (!q.data?.store) return null;
  const change = async (format: SheetFormat) => {
    const res = await setSheetFormat(code, format);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(format === "paper" ? "The sheet is like the paper register" : "The sheet is simple");
    void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });
  };
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-ink-900">How the daily sheet looks</p>
          <p className="text-sm text-grey-600">
            {q.data.maySetFormat
              ? "Like the paper register: NIP and ml, the 30, 60 and 90 ml sells, rate and amount. Simple: opening, received, sold, closing and the count."
              : "Set by the owner, an Admin or the GM."}
          </p>
        </div>
        {q.data.maySetFormat ? (
          <Segmented value={q.data.format} onChange={(f) => void change(f)}
            options={[{ value: "paper", label: "Like the paper register" }, { value: "simple", label: "Simple" }]} />
        ) : (
          <StatusPill tone="neutral">{q.data.format === "paper" ? "Like the paper register" : "Simple"}</StatusPill>
        )}
      </CardBody>
    </Card>
  );
}

/* ── The bar's drinks: how each is counted, its place in the registers ─ */

type DrinkDraft = {
  name: string; sizeMl: string; countAs: CountAs; packSize: string; brand: string; liquor: string; imported: boolean;
};
const COUNTED: { value: CountAs; label: string }[] = [
  { value: "poured", label: "NIPs or bottles, poured in pegs" },
  { value: "whole", label: "Whole bottles (beer)" },
  { value: "packet", label: "Packets, and loose ones (cigarettes)" },
];
const countedLabel = (c: CountAs) => COUNTED.find((x) => x.value === c)!.label;

function Drinks({ code, data }: { code: string; data: BarPours }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "stock");
  const [editing, setEditing] = useState<{ id: string | null; draft: DrinkDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const blank: DrinkDraft = { name: "", sizeMl: "", countAs: "poured", packSize: "", brand: "", liquor: "", imported: false };

  const save = async () => {
    if (!editing) return;
    const d = editing.draft;
    const size = d.sizeMl.trim() === "" ? null : Number(d.sizeMl);
    const pack = d.packSize.trim() === "" ? null : Number(d.packSize);
    const input: DrinkInput = {
      name: d.name, sizeMl: size, countAs: d.countAs, packSize: d.countAs === "packet" ? pack : null,
      brand: d.brand.trim() || null, liquor: d.liquor || null, imported: d.imported,
    };
    setSaving(true);
    const res = editing.id ? await editBarDrink(code, editing.id, input) : await addBarDrink(code, input);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(editing.id ? "The drink is changed" : "The drink is on the bar's list");
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["bar-pours", code] });
    void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });
  };
  const set = (patch: Partial<DrinkDraft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const kindLabel = (v: string | null) => (v ? LIQUORS.find((l) => l.value === v)?.label ?? v : "Not in the registers");

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ink-900">The bar's drinks</p>
            <p className="text-sm text-grey-600">
              {mayEdit ? "Each drink and bottle size, how it is counted, and its kind of liquor for the excise registers (FLR-1A/2A/3A, FLR-3)."
                : "Set by the GM or the Inventory Manager."}
            </p>
          </div>
          {mayEdit && <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setEditing({ id: null, draft: blank })}>Add a drink</Button>}
        </div>
        {data.drinks.length === 0 ? (
          <EmptyState icon={<GlassWater />} title="No drink on the bar's list"
            description="Add each drink and size here, or record a bar bill: its new drinks come onto the list." />
        ) : (
          <div className="overflow-x-auto scrollbar-quiet -mx-4 sm:mx-0">
            <table className="w-full border-collapse text-sm" data-bar-drinks>
              <thead className="bg-grey-50 border-b border-grey-200">
                <tr>
                  <th className={cn(TH, "text-left")}>Drink</th><th className={TH}>Size</th>
                  <th className={cn(TH, "text-left")}>Counted as</th><th className={cn(TH, "text-left")}>Register</th>
                  <th className={TH}>In the store</th>{mayEdit && <th className={TH} />}
                </tr>
              </thead>
              <tbody>
                {data.drinks.map((d) => (
                  <tr key={d.id} className="border-b border-grey-100">
                    <td className={cn(TD, "text-left text-ink-900 font-medium")}>{d.name}{d.brand ? <span className="block text-xs text-grey-500 font-normal">{d.brand}</span> : null}</td>
                    <td className={TD}>{d.sizeMl ? `${d.sizeMl} ml` : "-"}</td>
                    <td className={cn(TD, "text-left")}>{countedLabel(d.countAs)}{d.countAs === "packet" && d.packSize ? `, ${d.packSize} to a packet` : ""}</td>
                    <td className={cn(TD, "text-left")}>{kindLabel(d.liquor)}{d.liquor && d.imported ? ", imported" : ""}</td>
                    <td className={TD}>{d.onHand === null ? "-" : String(Math.round(d.onHand * 1000) / 1000)}</td>
                    {mayEdit && (
                      <td className={TD}>
                        <Button size="sm" variant="ghost" leadingIcon={<Pencil />} aria-label={`Change ${d.name}`}
                          onClick={() => setEditing({ id: d.id, draft: {
                            name: d.name, sizeMl: d.sizeMl ? String(d.sizeMl) : "", countAs: d.countAs,
                            packSize: d.packSize ? String(d.packSize) : "", brand: d.brand ?? "", liquor: d.liquor ?? "", imported: d.imported,
                          } })}>Change</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        {editing && (
          <DialogContent title={editing.id ? "Change the drink" : "Add a drink"}
            description="One line for each bottle size: Blenders Pride 180 ml and Blenders Pride 750 ml are two."
            footer={<>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" loading={saving} disabled={!editing.draft.name.trim()} onClick={() => void save()}>Save</Button>
            </>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required className="sm:col-span-2">
                {(f) => <Input {...fieldProps(f)} value={editing.draft.name} placeholder="Blenders Pride 180 ml" onChange={(e) => set({ name: e.target.value })} />}
              </Field>
              <Field label="Counted as">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={editing.draft.countAs} onChange={(e) => set({ countAs: e.target.value as CountAs })}>
                    {COUNTED.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
              {editing.draft.countAs === "packet" ? (
                <Field label="How many in a packet" required>
                  {(f) => <Input {...fieldProps(f)} inputMode="numeric" value={editing.draft.packSize} placeholder="20" onChange={(e) => set({ packSize: e.target.value })} />}
                </Field>
              ) : (
                <Field label="Bottle size, ml" required={editing.draft.countAs === "poured" || editing.draft.liquor !== ""}>
                  {(f) => <Input {...fieldProps(f)} inputMode="numeric" value={editing.draft.sizeMl} placeholder="180" onChange={(e) => set({ sizeMl: e.target.value })} />}
                </Field>
              )}
              <Field label="Kind of liquor (the register's group)">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={editing.draft.liquor} onChange={(e) => set({ liquor: e.target.value })}>
                    <option value="">Not liquor (cigarettes, soft drinks)</option>
                    {LIQUORS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Brand, as the register names it" hint="Blank: the name without its size.">
                {(f) => <Input {...fieldProps(f)} value={editing.draft.brand} placeholder="Blenders Pride" onChange={(e) => set({ brand: e.target.value })} />}
              </Field>
              {editing.draft.liquor !== "" && (
                <Checkbox className="sm:col-span-2" checked={editing.draft.imported} onCheckedChange={(v) => set({ imported: v })}
                  label="Imported (not Indian made)" />
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

type Draft = { stockItemId: string; how: "ml" | "units"; amount: string };
const keyOf = (d: BarDish) => `${d.itemId}/${d.variationId ?? ""}`;
const draftOf = (p: Pour | null): Draft =>
  p ? { stockItemId: p.stockItemId, how: p.ml !== null ? "ml" : "units", amount: String(p.ml ?? p.units ?? "") }
    : { stockItemId: "", how: "units", amount: "" };
const same = (a: Draft, b: Draft) =>
  a.stockItemId === b.stockItemId && (a.stockItemId === "" || (a.how === b.how && Number(a.amount) === Number(b.amount)));

function WhatEachTakes({ code, data }: { code: string; data: BarPours }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "stock");
  const saved = useMemo(() => new Map(data.dishes.map((d) => [keyOf(d), draftOf(d.pour)])), [data]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(saved));
  const [saving, setSaving] = useState(false);
  const drinks = new Map(data.drinks.map((d) => [d.id, d]));
  const proposals = data.dishes.filter((d) => d.proposed && !d.pour && drafts[keyOf(d)]!.stockItemId === "");
  const changed = data.dishes.filter((d) => !same(drafts[keyOf(d)]!, saved.get(keyOf(d))!));

  const set = (d: BarDish, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [keyOf(d)]: { ...all[keyOf(d)]!, ...patch } }));

  const save = async () => {
    for (const d of changed) {
      const x = drafts[keyOf(d)]!;
      if (x.stockItemId && !(Number(x.amount) > 0)) {
        return toast.error("Not saved", `${d.item}${d.size ? ` ${d.size}` : ""}: how much it takes, more than none.`);
      }
    }
    setSaving(true);
    const res = await saveBarPours(code, changed.map((d) => {
      const x = drafts[keyOf(d)]!;
      return x.stockItemId === ""
        ? { itemId: d.itemId, variationId: d.variationId, stockItemId: null, ml: null, units: null }
        : { itemId: d.itemId, variationId: d.variationId, stockItemId: x.stockItemId,
            ml: x.how === "ml" ? Number(x.amount) : null, units: x.how === "units" ? Number(x.amount) : null };
    }));
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved", "Each KOT sent now takes these off the Bar counter.");
    void qc.invalidateQueries({ queryKey: ["bar-pours", code] });
    void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });
  };

  if (!data.store) {
    return <Card><CardBody className="text-sm text-grey-600">
      This hotel has no bar store marked, so nothing can be taken off one. Mark it in Places and suppliers.
    </CardBody></Card>;
  }
  if (data.dishes.length === 0) {
    return <EmptyState icon={<GlassWater />} title="No bar dish on the menu"
      description="A dish in a section taxed as bar or alcohol shows here, with each of its sizes." />;
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ink-900">What each drink takes from the bar</p>
            <p className="text-sm text-grey-600">
              {mayEdit ? "Pick the NIP each dish and size is poured from, and how much. Saved, every KOT sent takes it off."
                : "Set by the GM or the Inventory Manager."}
            </p>
          </div>
          {mayEdit && proposals.length > 0 && (
            <Button variant="secondary" leadingIcon={<Sparkles />}
              onClick={() => setDrafts((all) => ({ ...all,
                ...Object.fromEntries(proposals.map((d) => [keyOf(d), draftOf(d.proposed)])) }))}>
              Use the {proposals.length} suggestion{proposals.length === 1 ? "" : "s"}
            </Button>
          )}
          {mayEdit && (
            <Button variant="primary" loading={saving} disabled={changed.length === 0} onClick={() => void save()}>
              Save{changed.length ? ` ${changed.length}` : ""}
            </Button>
          )}
        </div>

        <ul className="divide-y divide-grey-100" data-bar-pours>
          {data.dishes.map((d) => {
            const x = drafts[keyOf(d)]!;
            const drink = drinks.get(x.stockItemId);
            const label = `${d.item}${d.size ? ` ${d.size}` : ""}`;
            return (
              <li key={keyOf(d)} className="py-3 grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-base text-ink-900 break-words">{label}</p>
                  <p className="text-xs text-grey-500">
                    {d.category}
                    {d.pour ? "" : d.proposed && x.stockItemId === "" ? " · a suggestion is ready" : x.stockItemId ? "" : " · nothing set: takes nothing"}
                  </p>
                </div>
                <NativeSelect aria-label={`Poured from, ${label}`} value={x.stockItemId} disabled={!mayEdit}
                  onChange={(e) => {
                    const next = drinks.get(e.target.value);
                    set(d, { stockItemId: e.target.value, how: next?.sizeMl && x.how === "ml" ? "ml" : x.how });
                  }}>
                  <option value="">Nothing set</option>
                  {data.drinks.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}{k.onHand !== null ? ` - ${bottlesAndMl(k.onHand, k.unit, k.sizeMl)} in the store` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <div className="flex items-center gap-2">
                  <Input className="w-20 tabular" inputMode="numeric" aria-label={`How much, ${label}`}
                    disabled={!mayEdit || !x.stockItemId} value={x.amount}
                    onChange={(e) => set(d, { amount: e.target.value })} />
                  <NativeSelect className="w-auto" aria-label={`ml or whole, ${label}`} value={x.how}
                    disabled={!mayEdit || !x.stockItemId}
                    onChange={(e) => set(d, { how: e.target.value as Draft["how"] })}>
                    {drink?.sizeMl ? <option value="ml">ml of it</option> : null}
                    <option value="units">whole</option>
                  </NativeSelect>
                  {d.pour && same(x, saved.get(keyOf(d))!) && <StatusPill tone="success">Set</StatusPill>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
