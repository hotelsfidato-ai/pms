import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Printer, Receipt } from "lucide-react";
import { downloadKotSetup } from "@/modules/pos/lib/kotSetupFile";
import { apiBase } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  Section, Card, CardBody, Button, Checkbox, Skeleton, StatusPill, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, ReadFailed, Segmented,
} from "@/components/ui";
import { useRole } from "@/lib/session";
import {
  addKotKind, renameKotKind, kotKindOff, setSectionKot, setThisComputer, removeKotStation, setStationSlip,
  setKotDesign, KOT_TODAY, type KotDesign, type KotKind, type KotSetup, type Docket, type Order,
} from "@/modules/pos/data/till";
import { kotDevice, kotSetupKey, useKotSetup, since, Reprints, useSlipPrinter } from "@/modules/pos/components/KotStation";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { DEFAULT_SLIP_MM } from "@/modules/pos/lib/printRoll";

/* ══════════════════════════════════════════════════════════════════
   THE KOT SECTION OF RESTAURANT SETUP (the owner's D27-292)

   "Configure several KOT machines, by place." Four parts, in the order a
   person sets them up:

   1. THIS COMPUTER - its name, the KOT kinds it prints, and whether it
      prints the bills. Done ON the computer at the bar, in the kitchen: the
      website cannot reach a printer by its IP, so the computer prints
      through its own printer. Ticked here, a kind moves here.
   2. THE KOT KINDS - Kitchen and Bar to start (renamed, never switched
      off), more added; each with the computer that prints it.
   3. THE COMPUTERS - what each prints, and whether it is online.
   4. WHICH SECTION PRINTS WHERE - each menu section, pre-filled from its
      tax heading: Bar and Alcohol to the Bar, the rest to the Kitchen.

   And on a computer that prints, its last 20 KOTs with Reprint (moved here
   from the Kitchen screen). For Restaurant setup's people and the kitchen
   manager (roleGate KOT_SWITCH).
   ══════════════════════════════════════════════════════════════════ */

type Done = { ok: boolean; reason?: string };

export function KotSection({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const setup = useKotSetup(hotelId);

  const run = async (write: Promise<Done>, done: string) => {
    let res: Done;
    try {
      res = await write;
    } catch {
      res = { ok: false, reason: "The connection is down. Try again when it is back." };
    }
    if (!res.ok) {
      toast.error("Not saved", res.reason);
      return false;
    }
    toast.success(done);
    void qc.invalidateQueries({ queryKey: kotSetupKey(hotelId) });
    void qc.invalidateQueries({ queryKey: ["kot-queue", hotelId] });
    return true;
  };

  /* The one-click setup (D27-299) opens the KOT station window on
     /pos/<code>/setup#kot: once the section has drawn, it is brought into
     view, as a link to #kot would on a page drawn by the server. */
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !setup.data || window.location.hash !== "#kot") return;
    scrolled.current = true;
    document.getElementById("kot")?.scrollIntoView?.({ block: "start" });
  }, [setup.data]);

  return (
    <div id="kot" className="scroll-mt-20">
      <Section
        title="KOT section"
        description="What each KOT is, which computer prints it, and where each menu section's dishes go. A computer at the hotel prints through its own printer: the website cannot reach a printer by its address."
      >
        {setup.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : setup.isError || !setup.data ? (
          <Card>
            <ReadFailed compact error={setup.error} what="the KOT section"
                        onRetry={() => void setup.refetch()} />
          </Card>
        ) : (
          <div className="space-y-4">
            <ThisComputer hotelId={hotelId} setup={setup.data} run={run} />
            {setup.data.me && <Printing hotelId={hotelId} setup={setup.data} run={run} />}
            <KotDesignCard hotelId={hotelId} setup={setup.data} run={run} />
            <Kinds hotelId={hotelId} setup={setup.data} run={run} />
            <Computers hotelId={hotelId} setup={setup.data} run={run} />
            <Routing hotelId={hotelId} setup={setup.data} run={run} />
            {setup.data.me && (
              <Card><CardBody><Reprints hotelId={hotelId} /></CardBody></Card>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

type Run = (write: Promise<Done>, done: string) => Promise<boolean>;

/* ── 1a. Setting up the computer (D27-299, D27-360) ───────────────── */
/* The Fidato Printer app (printer/) prints with no window and no print
   screen. It is downloaded from the API's server, not the website, whose
   host refuses executables (MEMORY 426, D27-362; deploy/nginx.conf). The one
   Windows file, made for this hotel, stays as the other way: a Chrome
   shortcut, the receipt printer as the default, Startup, no sleep - then
   this section. lib/kotSetupFile.ts. */
const PRINTER_APP = "/downloads/Fidato-Printer-Setup.exe";

function OneClickSetup({ code }: { code: string }) {
  const base = useQuery({ queryKey: ["api-base"], queryFn: apiBase, staleTime: Infinity });
  const get = () => {
    try {
      const name = downloadKotSetup(window.location.origin, code);
      toast.success(`${name} downloaded`, "Open it on the computer the printer is plugged into.");
    } catch (error) {
      toast.error("The setup file could not be made", (error as Error).message);
    }
  };
  return (
    <div className="rounded-lg border border-grey-200 bg-grey-50 p-3.5 space-y-2" aria-label="Set up this computer for printing" role="group">
      <p className="text-sm font-semibold text-ink-900">Set up this computer for printing</p>
      <p className="text-sm text-grey-600 leading-relaxed">
        On the Windows computer the printer is plugged into, install Fidato Printer. It prints
        each KOT and bill straight away, with no window and no print screen, starts with Windows
        and keeps the computer awake. In its window, sign in, open this section, name the computer
        and tick what it prints. Pick the receipt printer from its icon by the clock: Printer.
      </p>
      <Button asChild className="w-full sm:w-auto">
        <a href={base.data ? `${base.data}${PRINTER_APP}` : undefined}>
          <Download className="size-4" aria-hidden /> Download Fidato Printer for Windows
        </a>
      </Button>
      <p className="text-2xs text-grey-600 leading-relaxed">
        When it runs, Windows may say "Windows protected your PC": press More info, then Run
        anyway. The other way, with Chrome:{" "}
        <button type="button" onClick={get} className="font-medium text-ink-900 underline underline-offset-2">
          download the setup file
        </button>{" "}
        - it makes a Chrome shortcut that prints, and your receipt printer the default.
      </p>
    </div>
  );
}

/* ── 1. This computer ─────────────────────────────────────────────── */
function ThisComputer({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const me = setup.stations.find((s) => s.mine) ?? null;
  const [name, setName] = useState(me?.name ?? "");
  const [kinds, setKinds] = useState<string[]>(me?.kinds ?? []);
  const [bills, setBills] = useState(me?.printsBills ?? false);
  const [busy, setBusy] = useState(false);

  const nothing = kinds.length === 0 && !bills;
  const save = async () => {
    setBusy(true);
    await run(setThisComputer(hotelId, kotDevice(), name.trim(), kinds, bills),
      nothing ? "This computer prints nothing now" : `${name.trim()} saved`);
    setBusy(false);
  };
  const toggle = (id: string, on: boolean) =>
    setKinds((prev) => (on ? [...prev, id] : prev.filter((k) => k !== id)));

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h3 className="text-md font-semibold text-ink-900">This computer</h3>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            {me
              ? `This is ${me.name}. It prints what is ticked, through its own printer, while a restaurant screen is open on it.`
              : "Open this on the computer that has the printer - at the bar, in the kitchen - and tick what it prints."}
          </p>
        </div>
        <OneClickSetup code={hotelId} />
        <Field label="This computer's name" required={!nothing} hint="For example Bar PC or Kitchen PC.">
          {(f) => (
            <Input {...fieldProps(f)} value={name} placeholder="Bar PC"
                   onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="space-y-2.5" role="group" aria-label="What this computer prints">
          {setup.kinds.map((k) => {
            const elsewhere = k.station && !k.station.mine ? k.station.name : null;
            return (
              <div key={k.id}>
                <Checkbox label={`Prints ${k.name} KOTs`} checked={kinds.includes(k.id)}
                          onCheckedChange={(on) => toggle(k.id, on)} />
                {elsewhere && (
                  <p className="text-2xs text-grey-600 pl-7 mt-0.5">
                    {elsewhere} prints them now. Ticked here, they move here.
                  </p>
                )}
              </div>
            );
          })}
          <div>
            <Checkbox label="Prints the bills" checked={bills} onCheckedChange={setBills} />
            {setup.billPrinter && !setup.billPrinter.mine && (
              <p className="text-2xs text-grey-600 pl-7 mt-0.5">
                {setup.billPrinter.name} prints them now. Ticked here, they move here.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" loading={busy}
                  disabled={(!nothing && !name.trim()) || (nothing && !me)}
                  onClick={() => void save()}>
            {nothing && me ? "Stop printing here" : "Save"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── 1b. How this computer prints, and a test (the owner's D27-363) ─
   The BAR PC's KOTs came out sideways and its bills upright (MEMORY 427):
   its printer turns a slip it takes for landscape. So each computer has its
   shortest slip - a slip is as long as it needs and never shorter - tried
   with a test KOT and a test bill, printed here as the real ones are. */
const TEST_KOT: Docket = {
  kotNo: 0, kind: { id: "test", name: "Test" }, orderNo: "TEST", table: "Test print", orderType: "dine_in",
  outlet: "Test print", hotel: "Test print", sentAt: "Test print",
  lines: [{ id: "t1", parentId: null, name: "Test dish", qty: 1, note: null, isAddon: false }],
};
const TEST_BILL: Order = {
  id: "test", orderNo: "TEST", outlet: "REST", outletName: "Test print",
  hotelName: "Test print", hotelCity: null, hotelGstin: null, hotelFssai: null, hotelSac: null,
  table: "Test print", status: "open", businessDate: "2026-01-01", paymentMethod: null,
  openedBy: null, settledBy: null, settledAt: null, abandonedReason: null, ticketId: null,
  eventId: null, eventTitle: null,
  lines: [{ id: "t1", name: "Test dish", qty: 1, unitPrice: 100, taxRate: 5, note: null, voided: false, kotStatus: "sent",
    addedBy: null, parentLineId: null, isAddon: false, variationId: null }],
  net: 100, discount: 0, discountType: null, discountValue: null, discountReason: null,
  promotionId: null, promotionName: null, taxable: 100, tax: 5, taxes: [{ scheme: "gst", rate: 5, tax: 5 }],
  gross: 105, roundOff: 0, payable: 105, tenders: [], covers: 1, waiter: null, orderType: "dine_in",
  customerName: null, customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
};

function Printing({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const me = setup.stations.find((s) => s.mine)!;
  const [mm, setMm] = useState(me.slipMm ? String(me.slipMm) : "");
  const [busy, setBusy] = useState(false);
  const { print, node, design } = useSlipPrinter(hotelId);
  const test = async (paper: "kot" | "bill") => {
    try {
      await (paper === "kot" ? print(<DocketSlip d={TEST_KOT} design={design} />, design?.widthMm)
        : print(<BillSlip order={TEST_BILL} heading="interim" sample="TEST PRINT" />));
    } catch (error) {
      toast.error("The test did not print", (error as Error).message);
    }
  };
  const save = async () => {
    const value = mm.trim() === "" ? null : Number(mm);
    setBusy(true);
    await run(setStationSlip(hotelId, me.id, value),
      value === null ? `Back to ${DEFAULT_SLIP_MM} mm` : `Slips on ${me.name} are at least ${value} mm`);
    setBusy(false);
  };
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h3 className="text-md font-semibold text-ink-900">Printing on {me.name}</h3>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Each slip is as long as it needs, and never shorter than this. If a KOT comes out sideways,
            make it longer and print a test KOT again. Blank is {DEFAULT_SLIP_MM} mm.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Shortest slip, mm" className="w-40">
            {(f) => <Input {...fieldProps(f)} inputMode="numeric" value={mm} placeholder={String(DEFAULT_SLIP_MM)}
                           onChange={(e) => setMm(e.target.value)} />}
          </Field>
          <Button variant="secondary" loading={busy} onClick={() => void save()}>Save</Button>
          <Button variant="secondary" onClick={() => void test("kot")}><Printer className="size-4" aria-hidden /> Print a test KOT</Button>
          <Button variant="secondary" onClick={() => void test("bill")}><Receipt className="size-4" aria-hidden /> Print a test bill</Button>
        </div>
        {node}
      </CardBody>
    </Card>
  );
}

/* ── The KOT's design, with a live preview (the owner's D27-368) ──────
   One for the hotel, by the GM, the owner or an Admin; anyone who sees the
   section sees it. The preview is the KOT itself, drawn as it will print. */
const SIZE_OPTIONS = [{ value: "small", label: "Small" }, { value: "normal", label: "Normal" }, { value: "large", label: "Large" }] as const;
const LINE_LABEL: Record<keyof KotDesign["show"], string> = {
  waiter: "Waiter", covers: "Covers", time: "Time sent", kind: "The KOT kind (KITCHEN, BAR)",
  notes: "Notes", orderNo: "The order number",
};
const PREVIEW_KOT: Docket = {
  kotNo: 14, kind: { id: "p", name: "Kitchen" }, orderNo: "20261027-12", table: "4", orderType: "dine_in",
  outlet: "Restaurant", hotel: "Hotel", sentAt: "27/10/26 13:05", covers: 3, waiter: "Ramesh",
  lines: [
    { id: "p1", parentId: null, name: "Paneer Tikka", qty: 2, note: "Less spicy", isAddon: false },
    { id: "p2", parentId: null, name: "Butter Roti", qty: 4, note: null, isAddon: false },
  ],
};

function KotDesignCard({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const role = useRole();
  const mayEdit = role === "owner" || role === "admin" || role === "gm";
  const saved = setup.design ?? KOT_TODAY;
  const [draft, setDraft] = useState<KotDesign>(saved);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<KotDesign>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async () => {
    setBusy(true);
    await run(setKotDesign(hotelId, { ...draft, heading: draft.heading?.trim() || null }), "The KOT's design is saved");
    setBusy(false);
  };
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h3 className="text-md font-semibold text-ink-900">The KOT's design</h3>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            How every KOT at this hotel prints. The KOT beside it is the preview, as it will print.
            {!mayEdit && " Set by the GM, the owner or an Admin."}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]" data-kot-design>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <p className="text-xs text-grey-600">The dishes</p>
                <Segmented value={draft.dishSize} onChange={(v) => mayEdit && set({ dishSize: v })} options={[...SIZE_OPTIONS]} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-grey-600">The KOT number and table</p>
                <Segmented value={draft.numberSize} onChange={(v) => mayEdit && set({ numberSize: v })} options={[...SIZE_OPTIONS]} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-grey-600">The paper</p>
                <Segmented value={String(draft.widthMm) as "58" | "80"} onChange={(v) => mayEdit && set({ widthMm: v === "58" ? 58 : 80 })}
                  options={[{ value: "80", label: "80 mm" }, { value: "58", label: "58 mm" }]} />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-grey-600">What it prints</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(LINE_LABEL) as (keyof KotDesign["show"])[]).map((line) => (
                  <Checkbox key={line} label={LINE_LABEL[line]} checked={draft.show[line]} disabled={!mayEdit}
                    onCheckedChange={(v) => set({ show: { ...draft.show, [line]: v === true } })} />
                ))}
              </div>
            </div>
            <Field label="A heading line, your own words (blank: none)" className="max-w-md">
              {(f) => <Input {...fieldProps(f)} value={draft.heading ?? ""} maxLength={40} disabled={!mayEdit}
                             placeholder="Fidato Kitchen" onChange={(e) => set({ heading: e.target.value })} />}
            </Field>
            {mayEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={busy} disabled={!changed} onClick={() => void save()}>Save the design</Button>
                <Button variant="ghost" disabled={JSON.stringify(draft) === JSON.stringify(KOT_TODAY)}
                  onClick={() => setDraft(KOT_TODAY)}>As it was</Button>
              </div>
            )}
          </div>
          <div className="rounded-md border border-grey-200 bg-grey-50 p-2 overflow-x-auto" aria-label="The KOT, as it will print">
            <DocketSlip d={PREVIEW_KOT} design={draft} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── 2. The KOT kinds ─────────────────────────────────────────────── */
function Kinds({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const [naming, setNaming] = useState<KotKind | "new" | null>(null);
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-md font-semibold text-ink-900">KOT kinds</h3>
            <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
              Each prints at the top of its slip - KITCHEN KOT 14, BAR KOT 14. One Send keeps one number.
            </p>
          </div>
          <Button variant="secondary" className="h-11 shrink-0" onClick={() => setNaming("new")}>
            <Plus className="size-4" /> Add a KOT
          </Button>
        </div>
        <ul className="divide-y divide-grey-100 border-y border-grey-100">
          {setup.kinds.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-base text-ink-900">{k.name}</p>
                <p className="text-sm text-grey-600">
                  {k.station
                    ? `${k.station.name} · ${k.station.online ? "online" : `not seen since ${since(k.station.seenAt)}`}`
                    : "No computer prints it"}
                  {` · ${k.sections} ${k.sections === 1 ? "section" : "sections"}`}
                </p>
              </div>
              {!k.station && k.sections > 0 && <StatusPill tone="danger">Not printing</StatusPill>}
              {k.station && !k.station.online && <StatusPill tone="warning">Offline</StatusPill>}
              <Button variant="secondary" size="sm" className="h-11" onClick={() => setNaming(k)}>
                Rename
              </Button>
              {!k.fixed && (
                <Button variant="secondary" size="sm" className="h-11"
                        onClick={() => void run(kotKindOff(hotelId, k.id), `${k.name} KOT switched off`)}>
                  Switch off
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
      {naming !== null && (
        <KindDialog
          kind={naming === "new" ? null : naming}
          onClose={() => setNaming(null)}
          onSave={async (name) => naming === "new"
            ? run(addKotKind(hotelId, name), `${name} KOT added`)
            : run(renameKotKind(hotelId, naming.id, name), `Renamed ${name}`)}
        />
      )}
    </Card>
  );
}

function KindDialog({ kind, onClose, onSave }: {
  kind: KotKind | null; onClose: () => void; onSave: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(kind?.name ?? "");
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== "" && name.trim().length <= 30;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={kind ? `Rename ${kind.name}` : "Add a KOT"}
        description="Its name heads the slip: TANDOOR KOT 14."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={async () => {
                      setBusy(true);
                      const ok = await onSave(name.trim());
                      setBusy(false);
                      if (ok) onClose();
                    }}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" required hint="Kitchen, Bar, Tandoor, Desserts. The slip adds KOT.">
          {(f) => (
            <Input {...fieldProps(f)} value={name} autoFocus placeholder="Tandoor"
                   onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/* ── 3. The computers ─────────────────────────────────────────────── */
function Computers({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const kindName = new Map(setup.kinds.map((k) => [k.id, k.name]));
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h3 className="text-md font-semibold text-ink-900">Computers that print</h3>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            An offline computer's KOTs wait for it, the same day, and every till screen says so.
          </p>
        </div>
        {setup.stations.length === 0 ? (
          <p className="text-sm text-grey-600 leading-relaxed">
            None yet. On the computer with the printer, open this page and tick what it prints.
          </p>
        ) : (
          <ul className="divide-y divide-grey-100 border-y border-grey-100">
            {setup.stations.map((s) => {
              const prints = [...s.kinds.map((id) => `${kindName.get(id) ?? "?"} KOTs`), ...(s.printsBills ? ["bills"] : [])];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  {s.printsBills ? <Receipt className="size-4 text-grey-500" /> : <Printer className="size-4 text-grey-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-base text-ink-900">
                      {s.name}{s.mine && <span className="text-sm text-grey-600"> (this computer)</span>}
                    </p>
                    <p className="text-sm text-grey-600">
                      {prints.length ? `Prints ${prints.join(", ")}` : "Prints nothing"}
                    </p>
                  </div>
                  <StatusPill tone={s.online ? "success" : "warning"}>
                    {s.online ? "Online" : `Not seen since ${since(s.seenAt)}`}
                  </StatusPill>
                  {prints.length === 0 && (
                    <Button variant="secondary" size="sm" className="h-11"
                            onClick={() => void run(removeKotStation(hotelId, s.id), `${s.name} removed`)}>
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 4. Which section prints where ────────────────────────────────── */
const HEADING: Record<string, string> = {
  restaurant: "Restaurant", bar: "Bar", alcohol: "Alcohol", banquet: "Banquet", other: "Other",
};

function Routing({ hotelId, setup, run }: { hotelId: string; setup: KotSetup; run: Run }) {
  const byRole = (role: "food" | "bar") => setup.kinds.find((k) => k.role === role);
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h3 className="text-md font-semibold text-ink-900">Which section prints where</h3>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Filled in from each section's tax heading: Bar and Alcohol to the {byRole("bar")?.name ?? "Bar"},
            the rest to the {byRole("food")?.name ?? "Kitchen"}. Change the odd one. Add-ons go with their dish.
          </p>
        </div>
        {setup.sections.length === 0 ? (
          <p className="text-sm text-grey-600">No menu sections yet. The Menu screen makes them.</p>
        ) : (
          <ul className="divide-y divide-grey-100 border-y border-grey-100">
            {setup.sections.map((s) => {
              const byHeading = byRole(s.heading === "bar" || s.heading === "alcohol" ? "bar" : "food");
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-base text-ink-900">{s.name}</p>
                    <p className="text-sm text-grey-600">{HEADING[s.heading ?? ""] ?? "No tax heading"}</p>
                  </div>
                  <NativeSelect
                    aria-label={`${s.name} prints on`}
                    className={cn("w-56 max-w-full")}
                    value={s.own ?? ""}
                    onChange={(e) => void run(
                      setSectionKot(hotelId, s.id, e.target.value || null),
                      `${s.name} prints on the ${
                        e.target.value ? setup.kinds.find((k) => k.id === e.target.value)?.name : byHeading?.name} KOT`)}
                  >
                    <option value="">{byHeading?.name ?? "Kitchen"} (by its heading)</option>
                    {setup.kinds.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </NativeSelect>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
