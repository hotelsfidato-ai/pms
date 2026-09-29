import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useLive } from "@/lib/useLiveOrders";
import { dateTime, timeOnly } from "@/lib/format";
import {
  Button, Checkbox, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import {
  getKotStations, pollKotStation, claimKot, getDocket, setKotStation,
  type Docket, type KotStationOutlet,
} from "@/modules/pos/data/till";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";

/* ══════════════════════════════════════════════════════════════════
   THE KOT STATION — one device per outlet prints every KOT (D27-159)

   The owner's answers of 29 September (D27-161, D27-167):
   - "This device prints KOTs" is switched on in the Kitchen screen's KOT
     printer panel, by the kitchen manager, the owner, an administrator or
     the GM, with a typed name ("Kitchen PC"). On elsewhere moves it.
   - The station prints every new KOT through the browser's own print
     while any restaurant screen is open on it. Chrome started with
     --kiosk-printing prints to the default printer without a dialog
     (KOT-STATION-SETUP.md). No other device prints or offers a KOT.
   - Missed KOTs print when it is back, oldest first, from the business
     date only. Its last 20 have Reprint.
   - Tables, the Till, the Terminal and the Kitchen say whether it is
     printing: online is seen in the last 90 seconds.
   ══════════════════════════════════════════════════════════════════ */

const DEVICE_KEY = "pms.kot-device";
let unsaved: string | null = null;

/** This browser's own id, made once and kept on the device - the station
    is a device, not a person. Without storage (a private window) it lasts
    until the page reloads. */
export function kotDevice(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return (unsaved ??= crypto.randomUUID());
  }
}

function useKotStations(hotelId: string) {
  return useQuery({
    queryKey: ["kot-station", hotelId],
    queryFn: () => getKotStations(hotelId, kotDevice()),
    enabled: Boolean(hotelId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

/* Only the slip reaches the paper, at the roll's width. */
const PRINT_CSS = `
  @media screen { .kot-print { display: none; } }
  @media print {
    body > *:not(.kot-print) { display: none !important; }
    @page { margin: 4mm; size: 80mm auto; }
  }`;

/** Prints one slip through the browser: drawn, printed, gone. `print()`
    holds the page until the browser has the paper (at once with
    --kiosk-printing), so the slip is in the page for exactly that long. */
function useSlipPrinter() {
  const [slip, setSlip] = useState<Docket | null>(null);
  const print = (d: Docket) => {
    flushSync(() => setSlip(d));
    try { window.print(); } finally { setSlip(null); }
  };
  const node = slip && createPortal(
    <div className="kot-print"><style>{PRINT_CSS}</style><DocketSlip d={slip} /></div>,
    document.body,
  );
  return { print, node };
}

/** Mounted by PosGate on every restaurant screen. Anywhere but the
    station it draws and asks nothing more than the status read. */
export function KotStationPrinter({ hotelId }: { hotelId: string }) {
  const stations = useKotStations(hotelId);
  const mine = (stations.data ?? []).filter((o) => o.station?.mine);
  return <>{mine.map((o) => <OutletPrinter key={o.code} hotelId={hotelId} outlet={o.code} />)}</>;
}

const queueKey = (hotelId: string, outlet: string) => ["kot-queue", hotelId, outlet];

function useQueue(hotelId: string, outlet: string) {
  return useQuery({
    queryKey: queueKey(hotelId, outlet),
    queryFn: () => pollKotStation(hotelId, outlet, kotDevice()),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

function OutletPrinter({ hotelId, outlet }: { hotelId: string; outlet: string }) {
  const qc = useQueryClient();
  /* An order moved: ask at once. The 30-second ask is the floor, and the
     station's "last seen". */
  useLive(hotelId, "orders", [queueKey(hotelId, outlet)]);
  const queue = useQueue(hotelId, outlet);
  const { print, node } = useSlipPrinter();
  const busy = useRef(false);
  const next = queue.data?.station ? queue.data.due[0] : undefined;

  /* One at a time, oldest first: the docket, the claim, the paper, then
     ask again for the next. Anything else - a claim another tab won, a
     failure - waits for the next ask rather than asking again at once. */
  useEffect(() => {
    if (!next || busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        const d = await getDocket(hotelId, next.orderId, next.kotNo);
        if (d && await claimKot(hotelId, next.orderId, next.kotNo, kotDevice())) {
          print(d);
          void qc.invalidateQueries({ queryKey: queueKey(hotelId, outlet) });
        }
      } catch {
        /* The next ask tries again. */
      } finally {
        busy.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next?.orderId, next?.kotNo, queue.dataUpdatedAt]);

  return node;
}

/* ── What the POS says about it (D27-161, Q6) ───────────────────── */

function since(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toDateString() === new Date().toDateString() ? timeOnly(iso) : dateTime(iso);
}

function statusOf(o: KotStationOutlet): { text: string; printing: boolean } {
  if (!o.station) return { text: `No KOT printer for ${o.name} - KOTs are not printing`, printing: false };
  if (o.station.online) return { text: `KOT printer: ${o.station.name} - online`, printing: true };
  return {
    text: `KOT printer ${o.station.name} not seen since ${since(o.station.seenAt)} - KOTs are not printing`,
    printing: false,
  };
}

/** One line per outlet, on Tables, the Till, the Terminal and the Kitchen. */
export function KotStatus({ hotelId, className }: { hotelId: string; className?: string }) {
  const stations = useKotStations(hotelId);
  if (!stations.data?.length) return null;
  return (
    <div className={cn("space-y-1", className)}>
      {stations.data.map((o) => {
        const s = statusOf(o);
        return (
          <p
            key={o.code}
            role={s.printing ? undefined : "alert"}
            data-kot-status={s.printing ? "printing" : "not-printing"}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
              s.printing
                ? "text-grey-600"
                : "border border-brand-red-100 bg-brand-red-50 text-brand-red-700 font-medium",
            )}
          >
            <Printer className="size-4 shrink-0" />
            {s.text}
          </p>
        );
      })}
    </div>
  );
}

/* ── The Kitchen screen's KOT printer panel ─────────────────────── */

export function KotPrinterPanel({ hotelId }: { hotelId: string }) {
  const [open, setOpen] = useState(false);
  const stations = useKotStations(hotelId);
  /* The menu's four: the owner, an administrator, the GM and the kitchen
     manager (roleGate KOT_SWITCH asks the same). */
  const maySwitch = can(useRole(), "edit", "menu");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-2 h-12 px-4 rounded-full border border-grey-300 bg-white text-base font-medium text-ink-900 hover:bg-grey-50 hover:border-grey-400 cursor-pointer"
      >
        <Printer className="size-4" />
        KOT printer
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="KOT printer"
          description="One device per outlet prints every KOT. No other device prints them."
          size="md"
          footer={
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-6">
            {(stations.data ?? []).map((o) => (
              <OutletPanel key={o.code} hotelId={hotelId} outlet={o} maySwitch={maySwitch} />
            ))}
            {stations.data?.length === 0 && (
              <p className="text-sm text-grey-600">
                No restaurant outlet here yet. Restaurant setup makes one.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OutletPanel({ hotelId, outlet, maySwitch }: {
  hotelId: string; outlet: KotStationOutlet; maySwitch: boolean;
}) {
  const qc = useQueryClient();
  const mine = outlet.station?.mine === true;
  const [name, setName] = useState(mine ? outlet.station!.name : "");
  const [busy, setBusy] = useState(false);

  const change = async (on: boolean) => {
    setBusy(true);
    const res = await setKotStation(hotelId, outlet.code, kotDevice(), on, name.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    void qc.invalidateQueries({ queryKey: ["kot-station", hotelId] });
    toast.success(on ? `This device prints ${outlet.name}'s KOTs` : "This device no longer prints KOTs");
  };

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink-900">{outlet.name}</h3>
      <KotStatusLine outlet={outlet} />
      {maySwitch && (
        <div className="space-y-3">
          {!mine && (
            <Field label="This device's name" required hint="For example Kitchen PC.">
              {(p) => <Input {...fieldProps(p)} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          <Checkbox
            label="This device prints KOTs"
            checked={mine}
            disabled={busy}
            onCheckedChange={(on) => void change(on)}
          />
        </div>
      )}
      {mine && <Reprints hotelId={hotelId} outlet={outlet.code} />}
    </section>
  );
}

function KotStatusLine({ outlet }: { outlet: KotStationOutlet }) {
  const s = statusOf(outlet);
  return (
    <p className={cn("text-sm", s.printing ? "text-grey-600" : "text-brand-red-700 font-medium")}>
      {s.text}
    </p>
  );
}

/** The station's last 20, newest first, each with Reprint. */
function Reprints({ hotelId, outlet }: { hotelId: string; outlet: string }) {
  const queue = useQueue(hotelId, outlet);
  const { print, node } = useSlipPrinter();
  const recent = queue.data?.station ? queue.data.recent : [];

  const reprint = async (orderId: string, kotNo: number) => {
    const d = await getDocket(hotelId, orderId, kotNo).catch(() => null);
    if (!d) return toast.error("Not printed", `KOT ${kotNo} did not load. Try again.`);
    print(d);
  };

  return (
    <div>
      <p className="text-sm font-medium text-ink-900 mb-1.5">Last 20 KOTs</p>
      {recent.length === 0 ? (
        <p className="text-sm text-grey-600">None yet. A KOT appears here once it is sent.</p>
      ) : (
        <ul className="divide-y divide-grey-200 border-y border-grey-200">
          {recent.map((r) => (
            <li key={`${r.orderId}:${r.kotNo}`} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 min-w-0 text-sm tabular">
                KOT {r.kotNo}{r.table ? ` · ${r.table}` : ""} · {since(r.sentAt)}
                {r.printedAt ? "" : " · not printed"}
              </span>
              <Button variant="secondary" size="md" onClick={() => void reprint(r.orderId, r.kotNo)}>
                Reprint
              </Button>
            </li>
          ))}
        </ul>
      )}
      {node}
    </div>
  );
}
