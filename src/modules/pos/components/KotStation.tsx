import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useLive } from "@/lib/useLiveOrders";
import { dateTime, timeOnly } from "@/lib/format";
import { Button, toast } from "@/components/ui";
import {
  getKotSetup, pollKotStation, claimKot, getDocket, claimBill, getOrder,
  askKotReprint, claimKotReprint,
  type KotKind, type KotSlipRef, type OrderLine,
} from "@/modules/pos/data/till";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { DEFAULT_SLIP_MM, printRoll } from "@/modules/pos/lib/printRoll";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTING COMPUTERS (D27-159; the KOT section, D27-292)

   The owner's answers of 9 October, on D27-161's station:
   - A computer prints the KOT KINDS ticked on it in Restaurant setup's KOT
     section - Kitchen, Bar, any added - one computer per kind; and it may
     print the bills. Ticked on another computer, a kind moves there.
   - It prints each new slip through the browser's own print while any
     restaurant screen is open on it; Chrome started with --kiosk-printing
     prints to the default printer without a dialog (KOT-STATION-SETUP.md).
     One Send makes one number and a slip per kind - "BAR KOT 14" at the
     bar, "KITCHEN KOT 14" in the kitchen.
   - Missed slips print when it is back, oldest first, from the business
     date only. Its last 20 have Reprint, in the KOT section.
   - Tables, the Till, the Terminal and the Kitchen say, per kind, whether
     it is printing - only for a kind some menu section prints to.
   ══════════════════════════════════════════════════════════════════ */

const DEVICE_KEY = "pms.kot-device";
let unsaved: string | null = null;

/** This browser's own id, made once and kept on the device - the station
    is a computer, not a person. Without storage (a private window) it
    lasts until the page reloads. */
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

export const kotSetupKey = (hotelId: string) => ["kot-setup", hotelId];
const queueKey = (hotelId: string) => ["kot-queue", hotelId];

/** The KOT section as every restaurant screen reads it: the kinds, the
    computers, the bill printer - for the red line, and to know whether this
    computer prints. */
export function useKotSetup(hotelId: string) {
  return useQuery({
    queryKey: kotSetupKey(hotelId),
    queryFn: () => getKotSetup(hotelId, kotDevice()),
    enabled: Boolean(hotelId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

function useStationQueue(hotelId: string) {
  return useQuery({
    queryKey: queueKey(hotelId),
    queryFn: () => pollKotStation(hotelId, kotDevice()),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

/* Only the slip reaches the paper. Off the screen rather than hidden, so it
   has a length to measure: the paper is set to it (printRoll). */
const PRINT_CSS = `
  @media screen { .kot-print { position: fixed; left: -10000px; top: 0; } }
  @media print { body > *:not(.kot-print) { display: none !important; } }`;

/** Prints one slip: drawn, printed, gone. The browser's `print()` holds the
    page until it has the paper (at once with --kiosk-printing); the Fidato
    Printer app answers when the printer has it. Either way the slip is in the
    page for exactly that long. */
export function useSlipPrinter(hotelId: string) {
  const [slip, setSlip] = useState<ReactNode>(null);
  /* This computer's shortest slip (D27-363), else the system's. */
  const setup = useKotSetup(hotelId);
  const minMm = setup.data?.stations.find((s) => s.mine)?.slipMm ?? DEFAULT_SLIP_MM;
  const print = async (paper: ReactNode) => {
    flushSync(() => setSlip(paper));
    try { await printRoll(document.querySelector<HTMLElement>("body > .kot-print"), minMm); } finally { setSlip(null); }
  };
  const node = slip && createPortal(
    <div className="kot-print"><style>{PRINT_CSS}</style>{slip}</div>,
    document.body,
  );
  return { print, node };
}

/** Mounted by PosGate on every restaurant screen. Anywhere but a printing
    computer it draws nothing and asks nothing more than the setup read. */
export function KotStationPrinter({ hotelId }: { hotelId: string }) {
  const setup = useKotSetup(hotelId);
  return setup.data?.me ? <StationPrinter hotelId={hotelId} /> : null;
}

function StationPrinter({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  /* An order moved: ask at once. The 30-second ask is the floor, and this
     computer's "last seen". */
  useLive(hotelId, "orders", [queueKey(hotelId)]);
  const queue = useStationQueue(hotelId);
  const { print, node } = useSlipPrinter(hotelId);
  const busy = useRef(false);
  const mine = queue.data?.station ? queue.data : null;
  const slip = mine?.due[0];
  /* A reprint asked on the pad, the Till or the Terminal (D27-329 (2)). */
  const again = slip ? undefined : mine?.reprints?.[0];
  const bill = slip || again ? undefined : mine?.bills[0];

  /* One at a time - new KOTs, then reprints, then bills, oldest first: the
     paper's content, the claim, the paper, then ask again. Anything else -
     a claim another tab won, a failure - waits for the next ask rather
     than asking at once. */
  useEffect(() => {
    if ((!slip && !again && !bill) || busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        if (slip) {
          const d = await getDocket(hotelId, slip.orderId, slip.kotNo, slip.kindId);
          if (d && await claimKot(hotelId, slip.orderId, slip.kotNo, slip.kindId, kotDevice())) {
            await print(<DocketSlip d={d} />);
            void qc.invalidateQueries({ queryKey: queueKey(hotelId) });
          }
        } else if (again) {
          const d = await getDocket(hotelId, again.orderId, again.kotNo, again.kindId);
          if (d && await claimKotReprint(hotelId, again.id, kotDevice())) {
            await print(<DocketSlip d={{ ...d, reprint: true }} />);
            void qc.invalidateQueries({ queryKey: queueKey(hotelId) });
          }
        } else if (bill) {
          const o = await getOrder(hotelId, bill.orderId);
          if (o && await claimBill(hotelId, bill.id, kotDevice())) {
            await print(<BillSlip order={o} heading={bill.heading} />);
            void qc.invalidateQueries({ queryKey: queueKey(hotelId) });
          }
        }
      } catch {
        /* The next ask tries again. */
      } finally {
        busy.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip?.orderId, slip?.kotNo, slip?.kindId, again?.id, bill?.id, queue.dataUpdatedAt]);

  return node;
}

/* ── What the POS says about it (D27-161, Q6; per kind, D27-292) ────── */

export function since(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toDateString() === new Date().toDateString() ? timeOnly(iso) : dateTime(iso);
}

export function statusOf(k: KotKind): { text: string; printing: boolean } {
  if (!k.station) {
    return { text: `No computer prints ${k.name} KOTs - they are not printing`, printing: false };
  }
  if (k.station.online) return { text: `${k.name} KOTs: ${k.station.name} - online`, printing: true };
  return {
    text: `${k.name} KOTs wait: ${k.station.name} not seen since ${since(k.station.seenAt)}`,
    printing: false,
  };
}

/** May open the KOT section: Restaurant setup's people and the kitchen
    manager (the owner, D27-292). */
export const maySetUpKots = (role: ReturnType<typeof useRole>) =>
  can(role, "edit", "menu") || can(role, "edit", "room_config");

/** One line per kind something prints to, on Tables, the Till, the
    Terminal and the Kitchen. Not printing, it links to the KOT section for
    those who may set it up. */
export function KotStatus({ hotelId, className }: { hotelId: string; className?: string }) {
  const setup = useKotSetup(hotelId);
  const maySet = maySetUpKots(useRole());
  const kinds = (setup.data?.kinds ?? []).filter((k) => k.sections > 0);
  if (kinds.length === 0) return null;
  return (
    <div className={cn("space-y-1", className)}>
      {kinds.map((k) => {
        const s = statusOf(k);
        return (
          <p
            key={k.id}
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
            <span className="flex-1 min-w-0">{s.text}</span>
            {!s.printing && maySet && (
              <Link to={`/pos/${hotelId}/setup#kot`}
                    className="shrink-0 underline underline-offset-2 hover:text-brand-red-800">
                Set up
              </Link>
            )}
          </p>
        );
      })}
    </div>
  );
}

/** An order's KOTs, one per number and kind - "KOT 3 · Bar" is the Bar's
    slip of KOT 3 - each with Reprint, on the order pad, the Till and the
    Terminal (the owner's D27-324 (4), D27-329 (5)). The reprint goes to the
    computer that prints that KOT's kind and prints there marked REPRINT,
    never on this device (D27-329 (2)); the screen says where it went, or
    that the computer is offline and the reprint waits for it. */
export function KotsSent({ hotelId, orderId, lines, className }: {
  hotelId: string; orderId: string; lines: OrderLine[]; className?: string;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const kots = [...new Map(lines.flatMap((l) => l.kotNo == null ? [] : [[
    `${l.kotNo}:${l.kotKind?.id ?? ""}`,
    { no: l.kotNo, kindId: l.kotKind?.id ?? null,
      label: `KOT ${l.kotNo}${l.kotKind ? ` · ${l.kotKind.name}` : ""}` },
  ] as const])).values()];
  if (kots.length === 0) return null;

  const reprint = async (k: (typeof kots)[number]) => {
    setAsking(k.label);
    const res = await askKotReprint(hotelId, orderId, k.no, k.kindId)
      .catch(() => ({ ok: false as const, reason: "The connection is down. Try again when it is back." }))
      .finally(() => setAsking(null));
    if (!res.ok) return void toast.error("Not reprinted", res.reason);
    if (res.station.online) {
      return void toast.success(`${k.label} sent to ${res.station.name}`, "It prints there, marked REPRINT.");
    }
    toast.error(`${res.station.name} is offline`,
      `${k.label} waits there and prints when it is back. Not seen since ${since(res.station.seenAt)}.`);
  };

  return (
    <div className={className}>
      <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1.5">KOTs sent</p>
      <ul aria-label="KOTs sent" className="divide-y divide-grey-100 border-y border-grey-100">
        {kots.map((k) => (
          <li key={`${k.no}:${k.kindId ?? ""}`} className="flex items-center gap-2 py-1.5">
            <span className="flex-1 min-w-0 truncate text-sm text-ink-900 tabular">{k.label}</span>
            <button
              type="button"
              aria-label={`Reprint ${k.label}`}
              disabled={asking === k.label}
              onClick={() => void reprint(k)}
              className="press h-11 px-3.5 rounded-full border border-grey-300 bg-white text-sm font-medium text-ink-900 hover:border-grey-400 hover:bg-grey-50 cursor-pointer shrink-0 disabled:opacity-50"
            >
              Reprint
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One KOT printed again on THIS computer's printer, the paper saying
    REPRINT: the KOT section's last 20, on the computer that prints them.
    A reprint asked anywhere else goes to the station (`KotsSent`). */
export function useKotReprint(hotelId: string) {
  const { print, node } = useSlipPrinter(hotelId);
  const reprint = async (orderId: string, kotNo: number, kindId: string | null, label: string) => {
    const d = await getDocket(hotelId, orderId, kotNo, kindId ?? undefined).catch(() => null);
    if (!d) return toast.error("Not printed", `${label} did not load. Try again.`);
    print(<DocketSlip d={{ ...d, reprint: true }} />);
  };
  return { reprint, node };
}

/** This computer's last 20 slips, newest first, each with Reprint - the
    paper says REPRINT. In the KOT section, on the computer that prints. */
export function Reprints({ hotelId }: { hotelId: string }) {
  const queue = useStationQueue(hotelId);
  const { reprint: again, node } = useKotReprint(hotelId);
  const recent: KotSlipRef[] = queue.data?.station ? queue.data.recent : [];

  const reprint = (r: KotSlipRef) => again(r.orderId, r.kotNo, r.kindId, `${r.kind} KOT ${r.kotNo}`);

  return (
    <div>
      <p className="text-sm font-medium text-ink-900 mb-1.5">This computer's last 20 KOTs</p>
      {recent.length === 0 ? (
        <p className="text-sm text-grey-600">None yet. A KOT appears here once it is sent.</p>
      ) : (
        <ul className="divide-y divide-grey-200 border-y border-grey-200">
          {recent.map((r) => (
            <li key={`${r.orderId}:${r.kotNo}:${r.kindId}`} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 min-w-0 text-sm tabular">
                {r.kind} KOT {r.kotNo}{r.table ? ` · ${r.table}` : ""} · {since(r.sentAt)}
                {r.printedAt ? "" : " · not printed"}
              </span>
              <Button variant="secondary" size="md" onClick={() => void reprint(r)}>
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
