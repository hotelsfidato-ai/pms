import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Ban, IndianRupee, PackageCheck, Printer } from "lucide-react";
import { money, dateTime, dateShort } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState,
  Dialog, DialogContent, Input, StatusPill, toast, InfoButton,
  DocMasthead, DocFacts, DOC_TH, DOC_TD,
} from "@/components/ui";
import { useGroupSettings } from "@/modules/admin";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";
import {
  getDocket, returnDocket, cancelDocket, chargeDocket,
  SERVICE_WORDS, type DocketLine,
} from "@/modules/laundry/data/laundry";
import { whoseWords } from "@/modules/laundry/pages/Dockets";

/* ══════════════════════════════════════════════════════════════════
   ONE DOCKET — what is in the bag, what has come back, whose bill

   Three acts, and each one's condition is the SERVER'S, read off the
   docket rather than worked out again here:

     record what came back   while the docket is not cancelled and
                             something is still out. Counts only - more
                             cannot come back than ever went out, and
                             the docket becomes "back" when nothing is
                             still out. Worked out, never typed.
     cancel                  before anything is on a bill. A charge is
                             reversed on the folio, not by cancelling
                             the docket underneath it.
     charge to the room      D18-7. ONLY a guest's bag, only once, only
                             while it is not cancelled, and only when
                             the bag HAS a total - which it does not
                             while anything in it is unpriced.

   THE HOTEL'S OWN LINEN IS NEVER CHARGED TO ANYBODY (D18-5), so the
   button is not there to be pressed. That is not this screen being
   polite: `laundry_dockets_hotel_is_never_charged` refuses the row, and
   the route refuses before it. The screen agrees with them rather than
   offering a control that would answer with a refusal.

   AND THE CHARGE IS NOT WRITTEN HERE. It goes through the service's own
   route, which goes through finance's front door. Whatever that route
   answers is what this screen says - it does not translate a refusal
   into a friendlier one it made up.
   ══════════════════════════════════════════════════════════════════ */

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

/** Nobody has priced it, so there is nothing to show but a dash. */
const rupees = (value: number | null) => (value === null ? "-" : money(value));

export default function LaundryDocketPage() {
  const { code = "", id = "" } = useParams<{ code: string; id: string }>();
  const qc = useQueryClient();
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [charging, setCharging] = useState(false);
  /* The server's own sentence, kept on the screen rather than flashed
     in a toast: a refusal about money is something somebody acts on. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["laundry", "docket", code, id],
    queryFn: () => getDocket(code, id),
    enabled: !!code && !!id,
  });

  const d = q.data;
  const lines = d?.lines ?? [];

  /* The masthead (D27-53, the owner's 28 September order): the group's
     logo, the hotel's name, "by <group>". The hotel's name is the one the
     session already holds for this address's code - no new read - and the
     code itself where it has none, because the code is still true. */
  const group = useGroupSettings(code);
  const hotelName = useSession((s) => s.hotels.find((h) => h.code === code)?.name) ?? code;
  /* A test hotel's docket (the owner's D27-296 (8)): TEST · NOT VALID across its head. */
  const test = useIsTestHotel(code);

  const state = d && (
    <StatusPill tone={d.status === "open" ? "info" : d.status === "returned" ? "success" : "danger"}>
      {d.status === "open" ? "Out" : d.status === "returned" ? "Back" : "Cancelled"}
    </StatusPill>
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["laundry", "docket", code, id] });
    void qc.invalidateQueries({ queryKey: ["laundry", "dockets", code] });
  };

  /* ⚠ THE BUTTON AND THE SERVER MUST AGREE. Every condition below is
     one the route makes too - not a copy of a rule, but the same facts
     the route reads, sent down on the docket. */
  const mayReturn = !!d && d.status !== "cancelled" && d.stillOut > 0;
  const mayCancel = !!d && d.status !== "cancelled" && !d.charged;
  const mayCharge = !!d
    && d.belongsTo === "guest"
    && d.status !== "cancelled"
    && !d.charged
    && d.total !== null;

  const charge = async () => {
    setCharging(true);
    setRefusal(null);
    const out = await chargeDocket(code, id);
    setCharging(false);
    if (!out.ok) { setRefusal(out.reason); return; }
    refresh();
    toast.success(`${d?.number} is on the room's bill as its own line.`);
  };

  const body = (() => {
    if (d === undefined) {
      if (q.isPaused) {
        return (
          <Card>
            <ErrorState
              title="No connection"
              description="This device is offline, so this docket cannot load. It loads by itself as soon as the connection is back."
            />
          </Card>
        );
      }
      if (q.isError) {
        return (
          <Card>
            <ErrorState
              title="This docket did not load"
              error={q.error}
              description={unreachable(q.error)
                ? "Could not reach the server, and there is nothing from earlier to show in its place. Check the connection, then try again."
                : undefined}
              onRetry={() => void q.refetch()}
            />
          </Card>
        );
      }
      return <Skeleton className="h-64 rounded-lg" />;
    }

    const dash = (v: string) => (v === "-" ? <span className="text-grey-500">-</span> : v);

    return (
      <div className="space-y-3">
        {/* THE DOCKET, in the document's look (D27-52, the CRS voucher's
            parts): the masthead, its facts in the washed strip, the lines
            over a 2px ink rule on hairlines. It is what prints: on paper
            the sheet loses its frame and everything around it goes. */}
        <section className="bg-white text-ink-700 border border-grey-200 rounded-lg px-4 py-3.5 sm:p-6
                            print:border-0 print:rounded-none print:p-0">
          {test && <TestDocumentMark />}
          <DocMasthead
            logo={group.logo}
            name={hotelName}
            group={group.name}
            title="Docket"
            number={d.number}
          >
            {/* The state, on paper only: the screen shows it beside the
                title, which does not print. */}
            <div className="hidden print:block mt-1">{state}</div>
          </DocMasthead>

          {/* D18-5 FIRST, because it is the first fact about a docket
              and it decides everything else on this screen. */}
          <DocFacts
            items={[
              { label: "Whose it is", value: whoseWords(d) },
              {
                label: "Stay",
                value: d.belongsTo === "hotel" ? "None - the hotel's own" : dash(d.stayReference ?? "-"),
              },
              { label: "Collected", value: d.collectedAt ? dateTime(d.collectedAt) : dateShort(d.businessDate) },
              { label: "Came back", value: dash(d.returnedAt ? dateTime(d.returnedAt) : "-") },
            ]}
          />
          <DocFacts
            className="mt-2"
            items={[
              { label: "Pieces", value: String(d.pieces) },
              { label: "Still out", value: String(d.stillOut) },
              { label: "Total", value: dash(rupees(d.total)), strong: true },
              { label: "On a bill", value: d.charged ? "Yes" : "No" },
            ]}
          />

          {d.notes && <p className="mt-4 text-sm text-ink-900">{d.notes}</p>}

          {/* Five columns scroll inside the sheet on a phone rather than
              squeeze a figure (the Breathing Room Rule). */}
          <div className="mt-5 overflow-x-auto scrollbar-quiet">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr>
                  <th className={cn(DOC_TH, "text-left pr-2")}>What it is</th>
                  <th className={cn(DOC_TH, "text-right px-2 w-16")}>Went</th>
                  <th className={cn(DOC_TH, "text-right px-2 w-16")}>Back</th>
                  <th className={cn(DOC_TH, "text-right px-2 w-24")}>Each</th>
                  <th className={cn(DOC_TH, "text-right pl-2 w-28")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className={cn(DOC_TD, "pr-2")}>
                      <span className="font-semibold text-ink-900">{l.description}</span>
                      <span className="text-grey-500"> · {SERVICE_WORDS[l.service]}</span>
                    </td>
                    <td className={cn(DOC_TD, "px-2 text-right tabular")}>{l.quantity}</td>
                    <td className={cn(DOC_TD, "px-2 text-right tabular")}>{l.returnedQuantity}</td>
                    {/* Unpriced at collection stays unpriced here. It is
                        not 0 and it is not left blank - a blank column
                        reads as "nothing to pay". */}
                    <td className={cn(DOC_TD, "px-2 text-right tabular", l.unitPrice === null && "text-grey-500")}>
                      {rupees(l.unitPrice)}
                    </td>
                    <td className={cn(DOC_TD, "pl-2 text-right tabular font-semibold", l.unitPrice === null && "font-normal text-grey-500")}>
                      {l.unitPrice === null ? "-" : money(l.unitPrice * l.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* WHY THERE IS NO CHARGE BUTTON, said where somebody looks for
            one. A control that is simply absent is a question nobody can
            answer; these are the four reasons it can be. Screen only: the
            paper has no buttons to explain. */}
        {d.belongsTo === "hotel" && (
          <Card className="no-print">
            <CardBody className="text-sm text-grey-600">
              <p className="font-medium text-ink-900">The hotel's own linen</p>
              <p className="mt-0.5">
                It is counted out and counted back and it is never charged to
                anybody (D18-5). The table refuses a charge on it, so there is
                no button here that would ask.
              </p>
            </CardBody>
          </Card>
        )}
        {d.belongsTo === "guest" && d.unpricedLines > 0 && d.status !== "cancelled" && (
          <Card className="no-print">
            <CardBody className="text-sm text-grey-600">
              {d.unpricedLines === 1
                ? "One thing in this bag has no price yet. "
                : `${d.unpricedLines} things in this bag have no price yet. `}
              It reads "-", never 0, so the bag has no total at all rather than
              a part of one - and it cannot go on the room's bill until it is
              priced on the price list.
            </CardBody>
          </Card>
        )}
        {d.charged && (
          <Card className="no-print">
            <CardBody className="text-sm text-grey-600">
              <p className="font-medium text-ink-900">Already on the bill</p>
              <p className="mt-0.5">
                It is its own line on the room's folio (D18-7). A charge is
                reversed on the folio, never by cancelling the docket under it.
              </p>
            </CardBody>
          </Card>
        )}

        {/* The server's refusal, in its own words. */}
        {refusal && (
          <Card className="no-print">
            <CardBody role="alert" className="text-sm text-brand-red-700">{refusal}</CardBody>
          </Card>
        )}
      </div>
    );
  })();

  return (
    <Page className="print:p-0 print:max-w-none">
      {/* Screen furniture: none of the head reaches the paper, as the
          tax invoice's toolbar does not. */}
      <PageHeader
        className="no-print"
        title={d?.number ?? "Docket"}
        description={d ? whoseWords(d) : undefined}
        badge={d
          ? (
            <>
              {state}
              {/* The note that stood under the docket, behind an (i) with
                  the same words (D27-45, D27-82). */}
              <InfoButton>
                {"Not in this version: linen par levels per room type, an outside laundry's bills, express surcharges, and a guest sending a bag from their own page."}
              </InfoButton>
            </>
          )
          : undefined}
        breadcrumbs={[
          { label: "Dockets", to: `/h/${code}/laundry` },
          { label: d?.number ?? "Docket" },
        ]}
        actions={d && (
          <>
            {mayReturn && (
              <Button
                variant="primary"
                leadingIcon={<PackageCheck />}
                onClick={() => setReturning(true)}
              >
                Record what came back
              </Button>
            )}
            {mayCharge && (
              <Button
                variant="secondary"
                leadingIcon={<IndianRupee />}
                loading={charging}
                onClick={() => void charge()}
              >
                Charge to the room
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
            {mayCancel && (
              <Button variant="danger" leadingIcon={<Ban />} onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </>
        )}
      />

      {body}

      {returning && d && (
        <ReturnDialog
          code={code} id={id} lines={lines}
          onClose={() => setReturning(false)}
          onDone={refresh}
        />
      )}
      {cancelling && d && (
        <Dialog open onOpenChange={(open) => { if (!open) setCancelling(false); }}>
          <DialogContent
            title={`Cancel ${d.number}?`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setCancelling(false)}>
                  Leave it
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void (async () => {
                    const out = await cancelDocket(code, id);
                    if (!out.ok) { setRefusal(out.reason); setCancelling(false); return; }
                    setCancelling(false);
                    refresh();
                    toast.success(`${d.number} is cancelled.`);
                  })()}
                >
                  Cancel the docket
                </Button>
              </>
            }
          >
            <p className="text-sm text-ink-700">
              The docket stays on the record as cancelled - nothing is deleted.
              It cannot be cancelled once it is on a bill.
            </p>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}

/* ── What came back ─────────────────────────────────────────────────
   Counts, against what went out. It STARTS from what has already come
   back rather than from what went out, so somebody recording the second
   half of a bag does not have to remember the first.

   The docket finishing is not a box anybody ticks: the server marks it
   back when nothing is still out.
   ═══════════════════════════════════════════════════════════════════ */
function ReturnDialog({
  code, id, lines, onClose, onDone,
}: {
  code: string; id: string; lines: DocketLine[];
  onClose: () => void; onDone: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.id, String(l.returnedQuantity)])));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    const returned = lines
      .map((l) => ({ lineId: l.id, quantity: Number(counts[l.id] ?? l.returnedQuantity) }))
      .filter((r) => Number.isInteger(r.quantity));

    if (returned.length !== lines.length) {
      setProblem("A count is a whole number.");
      return;
    }
    /* The table refuses more back than went out; saying so here saves a
       round trip, and the server still refuses it if this misses one. */
    const over = lines.find((l) => Number(counts[l.id] ?? 0) > l.quantity);
    if (over) {
      setProblem(`Only ${over.quantity} ${over.description.toLowerCase()} went out.`);
      return;
    }

    setSaving(true);
    const out = await returnDocket(code, id, returned);
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }

    onClose();
    onDone();
    toast.success(out.data.stillOut === 0
      ? "Everything is back."
      : `${out.data.stillOut} still out.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Record what came back"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Record it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-600">
            How many of each have come back in total - not how many arrived
            this time. The docket closes itself when nothing is still out.
          </p>

          {lines.map((l) => (
            <div key={l.id} className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-[160px] flex-1">
                <p className="text-sm font-medium text-ink-900">{l.description}</p>
                <p className="text-sm text-grey-500">
                  {SERVICE_WORDS[l.service]} · {l.quantity} went out
                </p>
              </div>
              <div className="w-[100px]">
                <Input
                  aria-label={`How many ${l.description} have come back`}
                  inputMode="numeric"
                  className="text-right"
                  value={counts[l.id] ?? ""}
                  onChange={(e) =>
                    setCounts((all) => ({ ...all, [l.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}

          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
