import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { IndianRupee, Plus, Shirt, Trash2 } from "lucide-react";
import { money, dateShort } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, DataTable,
  Segmented, StatusPill, toast, type Column, type Tone,
} from "@/components/ui";
import {
  getDockets, getPriceList, getStaysToChargeTo, createDocket,
  SERVICE_WORDS, type Docket, type DocketStatus, type PriceItem,
} from "@/modules/laundry/data/laundry";

/* ══════════════════════════════════════════════════════════════════
   THE DOCKETS — a guest's bag and the hotel's own linen, one list

   EVERY DOCKET SAYS WHOSE IT IS (D18-5). It is a column on the table,
   not a tag somebody may forget: a guest's docket names the stay and
   cannot exist without one; the hotel's own names none and can never
   carry a charge. So it is the second column here, beside the number,
   and it is the FIRST question the new-docket dialog asks - with no
   answer filled in, because a default would be a guess about money.

   OPEN FIRST. What is still out is what somebody is standing at the
   desk asking about; a returned docket is a record. The server sends
   them newest-first and this orders them by what is still to happen.

   NOT IN THIS VERSION, and said here rather than found missing: linen
   par levels per room type, an outside laundry's bills, express
   surcharges, and a guest sending a bag from their own page.
   ══════════════════════════════════════════════════════════════════ */

const STATUS_WORDS: Record<DocketStatus, string> = {
  open: "Out",
  returned: "Back",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<DocketStatus, Tone> = {
  open: "info",
  returned: "success",
  cancelled: "danger",
};

/** Open first: it is the only one anybody can still act on. */
const RANK: Record<DocketStatus, number> = { open: 0, returned: 1, cancelled: 2 };

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

/** A total nobody can work out is a dash. Never a part of itself. */
const rupees = (value: number | null) => (value === null ? "-" : money(value));

/** D18-5 in one line of words, for a table cell and for a heading. */
export function whoseWords(d: Pick<Docket, "belongsTo" | "guestName" | "roomNumber">) {
  if (d.belongsTo === "hotel") return "The hotel's own linen";
  const room = d.roomNumber ? `Room ${d.roomNumber}` : "No room yet";
  return d.guestName ? `${d.guestName} · ${room}` : room;
}

export default function LaundryDocketsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [whose, setWhose] = useState<"all" | "guest" | "hotel">("all");
  const [collecting, setCollecting] = useState(false);

  const q = useQuery({
    queryKey: ["laundry", "dockets", code, whose],
    queryFn: () => getDockets(code, whose === "all" ? {} : { whose }),
    enabled: !!code,
  });

  const dockets = [...(q.data?.dockets ?? [])].sort(
    (a, b) => RANK[a.status] - RANK[b.status]);
  const stillOut = dockets.filter((d) => d.status === "open").length;

  const columns: Column<Docket>[] = [
    {
      key: "number",
      header: "Docket",
      cell: (d) => <span className="font-medium text-ink-900">{d.number}</span>,
    },
    {
      /* D18-5, IN THE LIST. Not a filter somebody has to apply to find
         out - whose bag it is is on every row of every view. */
      key: "whose",
      header: "Whose",
      cell: (d) => (
        <span className={d.belongsTo === "hotel" ? "text-grey-600" : "text-ink-900"}>
          {whoseWords(d)}
        </span>
      ),
    },
    {
      key: "status",
      header: "State",
      cell: (d) => <StatusPill tone={STATUS_TONE[d.status]}>{STATUS_WORDS[d.status]}</StatusPill>,
    },
    {
      key: "pieces",
      header: "Pieces",
      cell: (d) => String(d.pieces),
      numeric: true,
      hideBelow: "sm",
    },
    {
      key: "stillOut",
      header: "Still out",
      cell: (d) => String(d.stillOut),
      numeric: true,
    },
    {
      key: "total",
      header: "Total",
      /* A bag with anything unpriced in it has NO total, and a dash is
         the honest answer. The column is still here for the hotel's own
         linen, which is counted and never priced - it reads a dash for
         the same reason and means the same thing. */
      cell: (d) => (
        <span className={d.total === null ? "text-grey-500" : undefined}>
          {rupees(d.total)}
        </span>
      ),
      numeric: true,
    },
    {
      key: "collected",
      header: "Collected",
      cell: (d) => dateShort(d.collectedAt ?? d.businessDate),
      hideBelow: "md",
    },
  ];

  const body = (() => {
    if (q.data === undefined) {
      /* FOUR STATES, NOT ONE. A read that failed must never draw
         "nothing has gone to the laundry" - somebody would collect the
         same bag twice on the strength of it. */
      /* Each state in the list's own frame, where the list would be. */
      if (q.isPaused) {
        return (
          <Card>
            <ErrorState
              title="No connection"
              description="This device is offline, so the dockets cannot load. They load by themselves as soon as the connection is back."
            />
          </Card>
        );
      }
      if (q.isError) {
        return (
          <Card>
            <ErrorState
              title="The dockets did not load"
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

    if (dockets.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={<Shirt />}
            title="Nothing has gone to the laundry yet"
            description={
              "A docket is one bag: whose it is, what is in it, and what has "
              + "come back. A guest's charges to their room; the hotel's own "
              + "linen is counted out and counted back, and never charged to "
              + "anybody."
            }
            action={
              <Button variant="primary" onClick={() => setCollecting(true)}>
                Collect a bag
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <DataTable
        columns={columns}
        rows={dockets}
        rowKey={(d) => d.id}
        onRowClick={(d) => void navigate(`/h/${code}/laundry/${d.id}`)}
      />
    );
  })();

  return (
    <Page>
      <PageHeader
        title="Laundry"
        description="Every bag that has gone out - a guest's and the hotel's own - and what has come back."
        actions={
          <>
            <Button asChild variant="secondary" leadingIcon={<IndianRupee />}>
              <Link to={`/h/${code}/laundry/price-list`}>Price list</Link>
            </Button>
            <Button variant="primary" leadingIcon={<Plus />} onClick={() => setCollecting(true)}>
              Collect a bag
            </Button>
          </>
        }
      />

      {/* The filter row, 20px above the list. On a phone the switch is
          full width (as on Groups) and scrolls inside itself rather than
          push the page sideways. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          value={whose}
          onChange={setWhose}
          className="max-w-full overflow-x-auto scrollbar-quiet max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
          options={[
            { value: "all", label: "Everything" },
            { value: "guest", label: "Guests' bags" },
            { value: "hotel", label: "The hotel's linen" },
          ]}
        />
        {q.data && (
          <p className="text-sm text-grey-600">
            {stillOut === 0
              ? "Nothing is still out."
              : stillOut === 1 ? "One bag is still out."
              : `${stillOut} bags are still out.`}
          </p>
        )}
      </div>

      {body}

      {collecting && (
        <CollectDialog
          code={code}
          onClose={() => setCollecting(false)}
          onCollected={(id) => void navigate(`/h/${code}/laundry/${id}`)}
        />
      )}
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════════════
   COLLECTING A BAG

   THE FIRST QUESTION IS WHOSE IT IS, AND IT STARTS UNANSWERED. D18-5
   is a NOT NULL column, so a default here would be this screen guessing
   at something the table refuses to guess at - and the wrong guess puts
   a hotel's bedsheets on a guest's bill. The rest of the form does not
   appear until it is answered, because what it asks for depends on it:
   a guest's docket names the stay, and the hotel's own cannot.

   WHAT IS IN THE BAG COMES OFF THE PRICE LIST, including the hotel's
   linen. One catalogue, and an item with no price is exactly how linen
   belongs on it - it is counted, never charged. Nothing is typed in
   free-hand here, so nothing arrives on a bill under a name that is
   not on any list.
   ══════════════════════════════════════════════════════════════════ */

interface Draft { priceItemId: string; quantity: string }

const EMPTY: Draft = { priceItemId: "", quantity: "" };

function CollectDialog({
  code, onClose, onCollected,
}: {
  code: string; onClose: () => void; onCollected: (id: string) => void;
}) {
  const qc = useQueryClient();
  /* "" is not a third kind of docket - it is the question unanswered. */
  const [belongsTo, setBelongsTo] = useState<"" | "guest" | "hotel">("");
  const [stayId, setStayId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const priceList = useQuery({
    queryKey: ["laundry", "price-list", code],
    queryFn: () => getPriceList(code),
    enabled: !!code,
  });
  /* Only asked for once a guest's bag is what this is. The hotel's own
     linen does not belong to a stay, and the server refuses one. */
  const stays = useQuery({
    queryKey: ["laundry", "stays", code],
    queryFn: () => getStaysToChargeTo(code),
    enabled: !!code && belongsTo === "guest",
  });

  const items = (priceList.data?.items ?? []).filter((i) => i.isActive);

  const set = (i: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => l.priceItemId !== "" && l.quantity.trim() !== "");
  const duplicated = new Set(filled.map((l) => l.priceItemId)).size !== filled.length;

  const submit = async () => {
    setProblem(null);
    if (belongsTo === "") {
      setProblem("Say whose this is: a guest's, or the hotel's own linen.");
      return;
    }
    if (belongsTo === "guest" && !stayId) {
      setProblem("A guest's docket names the stay it belongs to.");
      return;
    }
    if (filled.length === 0) { setProblem("What is in the bag?"); return; }
    if (duplicated) {
      setProblem("The same thing is on this docket twice. Put it on one line.");
      return;
    }
    if (filled.some((l) => !Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1)) {
      setProblem("A count is a whole number, one or more.");
      return;
    }

    setSaving(true);
    const out = await createDocket(code, {
      belongsTo,
      ...(belongsTo === "guest" ? { stayId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      lines: filled.map((l) => ({
        priceItemId: l.priceItemId,
        quantity: Number(l.quantity),
      })),
    });
    setSaving(false);

    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["laundry", "dockets", code] });
    onClose();
    toast.success(`${out.data.number} is collected.`);
    /* The end of the act is the docket itself, which is what the person
       hands over or pins to the bag (MEMORY 291). */
    onCollected(out.data.id);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Collect a bag"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Collect it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Whose is this"
            required
            hint="A guest's bag charges to their room. The hotel's own linen is counted out and counted back, and is never charged to anybody."
          >
            {(p) => (
              <NativeSelect
                {...fieldProps(p)}
                value={belongsTo}
                onChange={(e) => {
                  setBelongsTo(e.target.value as "" | "guest" | "hotel");
                  setStayId("");
                }}
              >
                {/* NO DEFAULT. D18-5 is a column, and a guess here is a
                    guess about whose bill something lands on. */}
                <option value="">Say whose this is</option>
                <option value="guest">A guest's bag</option>
                <option value="hotel">The hotel's own linen</option>
              </NativeSelect>
            )}
          </Field>

          {belongsTo === "guest" && (
            <Field
              label="Which stay"
              required
              hint="Only guests in the house are listed. A booking still to arrive, cancelled or checked out is refused by the server as well."
            >
              {(p) => (
                <NativeSelect
                  {...fieldProps(p)}
                  value={stayId}
                  onChange={(e) => setStayId(e.target.value)}
                >
                  <option value="">Pick the stay</option>
                  {(stays.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.roomNumber ? `Room ${s.roomNumber} · ` : ""}{s.guest} · {s.reference}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}

          {belongsTo === "guest" && stays.data?.length === 0 && (
            <p className="text-sm text-grey-600">
              Nobody is in house to charge a bag to. The hotel's own linen does
              not need a stay.
            </p>
          )}

          {belongsTo !== "" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink-900">What is in the bag</p>

              {items.length === 0 ? (
                <p className="text-sm text-grey-600">
                  Nothing is on this property's price list yet, so there is
                  nothing to put in a bag. Add what it launders on the{" "}
                  {/* A link is orange, so it reads as one (D27-54). */}
                  <Link className="font-medium text-brand-orange-700 hover:underline underline-offset-4"
                        to={`/h/${code}/laundry/price-list`}>
                    price list
                  </Link>{" "}
                  first - an item with no price is fine, and is how linen
                  belongs on it.
                </p>
              ) : (
                <>
                  {lines.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[180px] flex-1">
                        <NativeSelect
                          aria-label={`What is on line ${i + 1}`}
                          value={l.priceItemId}
                          onChange={(e) => set(i, { priceItemId: e.target.value })}
                        >
                          <option value="">Pick what it is</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>{itemWords(it)}</option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="w-[100px]">
                        <Input
                          aria-label={`How many on line ${i + 1}`}
                          inputMode="numeric"
                          value={l.quantity}
                          onChange={(e) => set(i, { quantity: e.target.value })}
                          placeholder="How many"
                        />
                      </div>
                      {lines.length > 1 && (
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label={`Take line ${i + 1} off`}
                          onClick={() => setLines((all) => all.filter((_, n) => n !== i))}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    onClick={() => setLines((all) => [...all, { ...EMPTY }])}
                  >
                    Add another thing
                  </Button>
                  <p className="text-sm text-grey-500">
                    The description and the price are copied onto the docket as
                    they are now, so re-pricing next month does not rewrite a
                    bag somebody was handed. Anything marked "not priced" leaves
                    this docket with no total until it is priced.
                  </p>
                </>
              )}
            </div>
          )}

          {belongsTo !== "" && (
            <Field label="Anything to note" hint="Optional - a stain, a missing button, who brought it down.">
              {(p) => (
                <Input
                  {...fieldProps(p)}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ink on the left cuff"
                />
              )}
            </Field>
          )}

          {problem && <p role="alert" className="text-sm text-brand-red-700">{problem}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** An unpriced item says so in the list somebody picks from, so the
    docket's missing total is not a surprise at the bottom of it. */
function itemWords(item: PriceItem): string {
  const price = item.price === null ? "not priced" : money(item.price);
  return `${item.name} · ${SERVICE_WORDS[item.service]} · ${price}`;
}
