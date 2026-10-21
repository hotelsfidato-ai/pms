import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { FileText, GlassWater, Plus, Sparkles } from "lucide-react";
import { bottlesAndMl, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, EmptyState, NativeSelect, Input,
  Segmented, StatusPill, toast,
} from "@/components/ui";
import { BarBills, BAR_RECORDERS } from "@/modules/purchasing";
import { getBarPours, saveBarPours, type BarDish, type BarPours, type Pour } from "@/modules/stores/data/barPours";
import {
  getBarSheet, saveBarCount, setSheetFormat, type BarSheet, type SheetDrink, type SheetFormat,
} from "@/modules/stores/data/barSheet";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK (the owner's D27-354, 21 October evening)

   One place for the bar, in the Restaurant menu: TODAY'S SHEET, the bar
   register on paper in the system - opening, received, sold (NIP, 30, 60,
   90 ml and loose ml), closing, rate, amount - and the count typed into it;
   BILLS, recorded as printed; SET UP, what each drink takes and how the
   sheet looks ("Like the paper register" or "Simple", the owner's setting).
   The same three parts are Inventory's Bar tab.
   ══════════════════════════════════════════════════════════════════ */

type Part = "sheet" | "bills" | "setup";

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
  const part: Part = params.get("part") === "bills" ? "bills" : params.get("part") === "setup" ? "setup" : "sheet";
  const go = (p: Part) => setParams((all) => {
    const next = new URLSearchParams(all);
    if (p === "sheet") next.delete("part"); else next.set("part", p);
    return next;
  }, { replace: true });

  return (
    <div className="space-y-4">
      <Segmented value={part} onChange={go}
        options={[{ value: "sheet", label: "Today's sheet" }, { value: "bills", label: "Bills" },
                  { value: "setup", label: "Set up" }]} />
      {part === "sheet" ? <Sheet code={code} /> : part === "bills" ? <Bills code={code} /> : <SetUp code={code} />}
    </div>
  );
}

/* ── Today's sheet ─────────────────────────────────────────────────── */

/** Full bottles and the ml of the open one; a drink not poured, its count. */
function split(q: number, d: SheetDrink): { nip: string; ml: string } {
  if (!d.poured || !d.sizeMl) return { nip: String(Math.round(q * 1000) / 1000), ml: "" };
  const sign = q < 0 ? "-" : "";
  const a = Math.abs(q);
  const whole = Math.floor(a + 1e-9);
  const ml = Math.round((a - whole) * d.sizeMl);
  return { nip: `${sign}${whole}`, ml: ml ? `${sign}${ml}` : "" };
}

/** "5 + 120 ml" or "120 ml" for what is poured, "12" for what is not. */
const held = (q: number, d: SheetDrink) => {
  if (!d.poured || !d.sizeMl) return String(Math.round(q * 1000) / 1000);
  const s = split(q, d);
  if (!s.ml) return s.nip;
  return /^-?0$/.test(s.nip) ? `${s.ml} ml` : `${s.nip} + ${Math.abs(Number(s.ml))} ml`;
};

const differenceText = (diff: number, d: SheetDrink) =>
  Math.abs(diff) < 0.0005 ? "matches" : `${diff > 0 ? "+" : "-"}${held(Math.abs(diff), d)}`;

type CountDraft = Record<string, { nip: string; ml: string }>;

/** The typed count as one figure, or null when the line is blank; a reason when it cannot be. */
function countOf(d: SheetDrink, x: { nip: string; ml: string } | undefined): number | null | string {
  if (!x || (x.nip.trim() === "" && x.ml.trim() === "")) return null;
  const nip = x.nip.trim() === "" ? 0 : Number(x.nip);
  const ml = x.ml.trim() === "" ? 0 : Number(x.ml);
  if (!Number.isFinite(nip) || nip < 0) return `${d.name}: a count is zero or more.`;
  if (!d.poured || !d.sizeMl) return nip;
  if (!Number.isInteger(nip) || !Number.isInteger(ml) || ml < 0 || ml >= d.sizeMl) {
    return `${d.name}: whole NIPs, and the open one's ml under ${d.sizeMl}.`;
  }
  return Math.round((nip + ml / d.sizeMl) * 1000) / 1000;
}

function Sheet({ code }: { code: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | undefined>(undefined);
  const q = useQuery({ queryKey: ["bar-sheet", code, date ?? "today"], queryFn: () => getBarSheet(code, date) });
  const [draft, setDraft] = useState<CountDraft>({});
  const [saving, setSaving] = useState(false);

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
  const typed = all.filter((d) => countOf(d, draft[d.id]) !== null);

  const save = async () => {
    const lines: { itemId: string; book: number; counted: number }[] = [];
    for (const d of typed) {
      const n = countOf(d, draft[d.id]);
      if (typeof n === "string") return toast.error("Not saved", n);
      lines.push({ itemId: d.id, book: d.onHand, counted: n! });
    }
    setSaving(true);
    const res = await saveBarCount(code, lines);
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("The count is saved", res.recorded
      ? `${res.recorded} difference${res.recorded === 1 ? "" : "s"} corrected; ${res.matched} matched.`
      : "Everything counted matched the book.");
    setDraft({});
    void qc.invalidateQueries({ queryKey: ["bar-sheet", code] });
  };

  const totalAmount = all.every((d) => d.amount === null) ? null : all.reduce((t, d) => t + (d.amount ?? 0), 0);

  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs text-grey-600">Day</span>
            <Input id="bar-sheet-day" type="date" className="w-44" value={s.date} max={s.businessDate}
              onChange={(e) => { setDate(e.target.value || undefined); setDraft({}); }} />
          </label>
          <p className="text-sm text-grey-600 min-w-0 basis-full order-last sm:order-none sm:basis-auto sm:flex-1">
            {s.date === s.businessDate
              ? (counting ? "Today. Type the closing count of each drink you count; a blank line is not counted." : "Today.")
              : "An earlier day: the count is typed on today's sheet."}
          </p>
          {counting && (
            <Button variant="primary" loading={saving} disabled={typed.length === 0} onClick={() => void save()}>
              Save the count{typed.length ? ` (${typed.length})` : ""}
            </Button>
          )}
        </div>
        {all.length === 0 ? (
          <EmptyState icon={<GlassWater />} title="No drink in the bar's store"
            description="A bar bill recorded puts its drinks here." />
        ) : s.format === "paper"
          ? <PaperSheet sheet={s} draft={draft} onDraft={setDraft} />
          : <SimpleSheet sheet={s} draft={draft} onDraft={setDraft} />}
        {totalAmount !== null && s.format === "paper" && (
          <p className="text-right text-base font-medium text-ink-900 tabular">Amount, all drinks: {money(totalAmount)}</p>
        )}
      </CardBody>
    </Card>
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

function CountBoxes({ d, draft, onDraft }: { d: SheetDrink; draft: CountDraft; onDraft: (f: (x: CountDraft) => CountDraft) => void }) {
  const x = draft[d.id] ?? { nip: "", ml: "" };
  const set = (patch: Partial<{ nip: string; ml: string }>) => onDraft((all) => ({ ...all, [d.id]: { ...x, ...patch } }));
  return (
    <div className="flex items-center justify-end gap-1">
      <Input className="w-14 h-8 text-right tabular" inputMode="numeric" aria-label={`Counted, ${d.name}${d.poured ? ", NIPs" : ""}`}
        value={x.nip} onChange={(e) => set({ nip: e.target.value })} />
      {d.poured && d.sizeMl && (
        <Input className="w-16 h-8 text-right tabular" inputMode="numeric" aria-label={`Counted, ${d.name}, ml in the open one`}
          placeholder="ml" value={x.ml} onChange={(e) => set({ ml: e.target.value })} />
      )}
    </div>
  );
}

/** The difference the typed count makes today, or the day's count made. */
function Difference({ d, draft, sheet }: { d: SheetDrink; draft: CountDraft; sheet: BarSheet }) {
  if (sheet.mayCount) {
    const n = countOf(d, draft[d.id]);
    if (typeof n === "number") {
      const diff = n - d.onHand;
      return <span className={cn(Math.abs(diff) >= 0.0005 && "text-brand-red-700 font-medium")}>{differenceText(diff, d)}</span>;
    }
  }
  if (d.counted !== null && d.countBook !== null) {
    const diff = d.counted - d.countBook;
    return <span className={cn(Math.abs(diff) >= 0.0005 && "text-brand-red-700")}>{differenceText(diff, d)}</span>;
  }
  return <span className="text-grey-400">-</span>;
}

function PaperSheet({ sheet, draft, onDraft }: { sheet: BarSheet; draft: CountDraft; onDraft: (f: (x: CountDraft) => CountDraft) => void }) {
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
              <SectionRow section={g.section} span={18} />
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
                      {sheet.mayCount ? <CountBoxes d={d} draft={draft} onDraft={onDraft} />
                        : d.counted === null ? "-" : held(d.counted, d)}
                    </td>
                    <td className={TD}><Difference d={d} draft={draft} sheet={sheet} /></td>
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

function SimpleSheet({ sheet, draft, onDraft }: { sheet: BarSheet; draft: CountDraft; onDraft: (f: (x: CountDraft) => CountDraft) => void }) {
  return (
    <div className="overflow-x-auto scrollbar-quiet -mx-4 sm:mx-0" data-bar-sheet="simple">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-grey-50 border-b border-grey-200">
          <tr>
            <th className={cn(TH, FIRST, "bg-grey-50 text-left")}>Drink</th>
            <th className={TH}>Opening</th><th className={TH}>Received</th><th className={TH}>Sold</th>
            <th className={TH}>Closing</th><th className={TH}>Counted</th><th className={TH}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {sheet.groups.map((g) => (
            <Fragment key={g.section}>
              <SectionRow section={g.section} span={7} />
              {g.drinks.map((d) => (
                <tr key={d.id} className="border-b border-grey-100">
                  <td className={cn(TD, FIRST, "text-ink-900 font-medium")}>{d.name}</td>
                  <td className={TD}>{held(d.opening, d)}</td>
                  <td className={TD}>{held(d.received, d)}</td>
                  <td className={TD}>{held(d.sold, d)}</td>
                  <td className={cn(TD, "font-medium text-ink-900")}>{held(d.closing, d)}</td>
                  <td className={TD}>
                    {sheet.mayCount ? <CountBoxes d={d} draft={draft} onDraft={onDraft} />
                      : d.counted === null ? "-" : held(d.counted, d)}
                  </td>
                  <td className={TD}><Difference d={d} draft={draft} sheet={sheet} /></td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
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
        : <WhatEachTakes code={code} data={q.data} />}
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
    toast.success("Saved", "Each KOT sent now takes these off the bar's stock.");
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
                      {k.name}{k.onHand !== null ? ` - ${bottlesAndMl(k.onHand, k.unit, k.sizeMl)} in the bar` : ""}
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
