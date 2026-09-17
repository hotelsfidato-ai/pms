import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { CalendarDays, Plus, Settings2, Users, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, timeOnly } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea,
  NativeSelect, StatusPill,
} from "@/components/ui";
import { getBanquetDiary, getBanquetSetup, registerBanquetEvent, type BanquetEventSummary } from "@/modules/banquet/data/banquet";
import { ReadFailed, ReadStale, readError } from "@/modules/banquet/components/ReadProblem";
import { queryKeys } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE BANQUET DIARY

   One question, asked of this screen more than any other: IS THE HALL
   FREE ON THE FOURTEENTH. So the hall is the row and the functions sit
   inside it, rather than a flat list of bookings somebody has to sort
   in their head.

   AN EMPTY HALL IS AN ANSWER. It is drawn as "Nothing booked", not
   omitted — a hall missing from the list reads as a hall that does not
   exist, and the GM is looking for exactly the empty one.

   AN ENQUIRY IS NOT A BOOKING and the two never share a colour. Only
   a confirmed function holds the hall; an enquiry over a confirmed one
   is allowed and flagged, because two families asking about the same
   Saturday is normal business.

   UNPRICED IS A DASH. Never ₹0 — a wedding shown as free is worse than
   a wedding shown as unpriced.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  enquiry:   { label: "Enquiry",   tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

/** "14 Nov 2026, 6:00 PM → 11:00 PM", or "14 Nov 2026, 6:00 PM →
    16 Nov 2026, 11:00 PM" when it runs across days. A three-day wedding
    and a single evening are the same kind of thing here, and the label
    is what tells them apart. Through `format.ts`, as every screen prints
    dates (BQ-5). */
function whenLabel(startsAt: string, endsAt: string): string {
  return dateShort(startsAt) === dateShort(endsAt)
    ? `${dateShort(startsAt)}, ${timeOnly(startsAt)} → ${timeOnly(endsAt)}`
    : `${dateShort(startsAt)}, ${timeOnly(startsAt)} → ${dateShort(endsAt)}, ${timeOnly(endsAt)}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BanquetPage() {
  const hotelId = useHotel();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [registering, setRegistering] = useState(false);
  const [window, setWindow] = useState<{ from: string; to: string } | null>(null);

  const diary = useQuery({
    queryKey: queryKeys.banquetDiary(hotelId, window?.from ?? "", window?.to ?? ""),
    queryFn: () => getBanquetDiary(hotelId, window?.from, window?.to),
  });

  /* The heading is the menu's word (D17-22, BQ-2): the menu says Diary. */
  if (diary.isLoading) {
    return (
      <Page>
        <PageHeader title="Diary" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  /* Nothing to show, because the read did not succeed (BQ-3). A property
     with banquet switched off lands here too — as the server's own
     refusal, "This property has no banquet hall. Turn it on in the
     property's settings…", shown as it is. A fault or a lost connection
     says so instead, with Try again. */
  if (!diary.data) {
    return (
      <Page>
        <PageHeader title="Diary" />
        <ReadFailed error={readError(diary)} what="the diary"
                    onRetry={() => void diary.refetch()} />
      </Page>
    );
  }

  const { from, to, venues, businessDate } = diary.data;
  const shift = (days: number) =>
    setWindow({ from: addDays(from, days), to: addDays(to, days) });

  const booked = venues.reduce(
    (n, v) => n + v.events.filter((e) => e.status === "confirmed").length, 0);

  return (
    <Page>
      <PageHeader
        title="Diary"
        description={
          booked === 0
            ? `Nothing confirmed between ${dateShort(from)} and ${dateShort(to)}.`
            : `${booked} ${booked === 1 ? "function" : "functions"} confirmed `
              + `between ${dateShort(from)} and ${dateShort(to)}.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="h-11"
                    onClick={() => navigate(`/h/${hotelId}/banquet/setup`)}>
              <Settings2 className="size-4" /> Halls and packages
            </Button>
            <Button variant="primary" className="h-11" onClick={() => setRegistering(true)}>
              <Plus className="size-4" /> Register a function
            </Button>
          </div>
        }
      />

      <ReadStale error={readError(diary)} loadedAt={diary.dataUpdatedAt}
                 onRetry={() => void diary.refetch()} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="h-11" onClick={() => shift(-30)}>
          ← Earlier
        </Button>
        <Button variant="secondary" className="h-11"
                onClick={() => setWindow({ from: businessDate, to: addDays(businessDate, 30) })}>
          <CalendarDays className="size-4" /> From today
        </Button>
        <Button variant="secondary" className="h-11" onClick={() => shift(30)}>
          Later →
        </Button>
      </div>

      {venues.length === 0 ? (
        <EmptyState
          title="No halls yet"
          description={
            "A property with a banquet hall has somebody enter it, the same "
            + "way rooms are entered. Nothing is created for you."
          }
          action={
            <Button onClick={() => navigate(`/h/${hotelId}/banquet/setup`)}>
              Add a hall
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {venues.map((v) => (
            <Card key={v.id}>
              <CardBody className="space-y-3">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-base font-medium">{v.name}</span>
                  <span className="text-sm text-grey-500">
                    {v.events.length === 0
                      ? "nothing booked"
                      : `${v.events.length} in this window`}
                  </span>
                </p>

                {/* An EMPTY hall is drawn, not omitted. It is usually the
                    answer somebody came to this screen for. */}
                {v.events.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-grey-200
                                px-3 py-6 text-center text-sm text-grey-500">
                    Free for the whole window.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {v.events.map((e) => (
                      <EventRow key={e.id} event={e} hotelId={hotelId} />
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {registering && (
        <RegisterDialog
          hotelId={hotelId}
          onClose={() => setRegistering(false)}
          onDone={(id) => {
            setRegistering(false);
            void qc.invalidateQueries({ queryKey: ["banquet-diary"] });
            navigate(`/h/${hotelId}/banquet/${id}`);
          }}
        />
      )}
    </Page>
  );
}

function EventRow({ event, hotelId }: { event: BanquetEventSummary; hotelId: string }) {
  const navigate = useNavigate();
  const s = STATUS[event.status] ?? STATUS["enquiry"]!;

  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/h/${hotelId}/banquet/${event.id}`)}
        className={cn(
          "w-full rounded-lg border border-grey-200 px-3 py-2.5 text-left",
          "hover:border-brand-orange-300 hover:bg-brand-orange-50/40",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-brand-orange-500 cursor-pointer",
          "transition-colors min-h-11",
          event.status === "enquiry" && "border-dashed",
        )}
      >
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{event.title}</span>
          <StatusPill tone={s.tone}>{s.label}</StatusPill>
          <span className="text-sm text-grey-500">{event.reference}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1
                      text-sm text-grey-600">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5 shrink-0" />
            {whenLabel(event.startsAt, event.endsAt)}
          </span>
          <span>{event.hostName}</span>
          {event.pax !== null && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5 shrink-0" />{event.pax}
            </span>
          )}
          {/* A DASH, never ₹0. Nobody has priced this yet, and a zero
              would read as a hall given away. */}
          <span className={cn("tabular-nums",
                              event.agreedAmount === null && "text-grey-500")}>
            {event.agreedAmount === null ? "—" : money(event.agreedAmount)}
          </span>
        </p>
        {event.registeredBy && (
          <p className="mt-0.5 text-sm text-grey-500">
            Registered by {event.registeredBy}
          </p>
        )}
      </button>
    </li>
  );
}

function RegisterDialog({
  hotelId, onClose, onDone,
}: {
  hotelId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const setup = useQuery({
    queryKey: queryKeys.banquetSetup(hotelId),
    queryFn: () => getBanquetSetup(hotelId),
  });

  const [venueId, setVenueId] = useState("");
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [hostPhone, setHostPhone] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pax, setPax] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const venues = (setup.data?.venues ?? []).filter((v) => v.isActive);
  const chosen = venues.find((v) => v.id === venueId);

  const submit = async () => {
    setBusy(true);
    const res = await registerBanquetEvent(hotelId, {
      venueId, title, hostName,
      hostPhone: hostPhone || undefined,
      startsAt, endsAt,
      pax: pax === "" ? null : Number(pax),
      /* Only what was typed. Leaving it blank means UNPRICED — the
         venue's default is OFFERED below and never assumed. */
      agreedAmount: amount === "" ? null : Number(amount),
      notes: notes || undefined,
    });
    setBusy(false);

    if (!res.ok) return toast.error("Not registered", res.reason);
    if (res.warning) toast.warning("Registered as an enquiry", res.warning);
    else toast.success("Registered", `${res.reference} — an enquiry until it is confirmed.`);
    onDone(res.id);
  };

  const ready = venueId && title.trim() && hostName.trim() && startsAt && endsAt;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Register a function"
        description="This holds nothing yet. Confirming it takes the hall."
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" className="h-11">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Registering…" : "Register"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Hall" required>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={venueId}
                            onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Choose a hall…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.seated !== null ? ` · seats ${v.seated}` : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field label="What is the function?" required>
            {(f) => (
              <Input {...fieldProps(f)} value={title} placeholder="Sharma sangeet"
                     onChange={(e) => setTitle(e.target.value)} />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" required>
              {(f) => (
                <Input {...fieldProps(f)} type="datetime-local" value={startsAt}
                       onChange={(e) => setStartsAt(e.target.value)} />
              )}
            </Field>
            {/* The question the whole module exists to make somebody
                answer. The hint says why rather than just marking it. */}
            <Field label="Until" required
                   hint="A hall booked with no end is a hall nobody else can be sold.">
              {(f) => (
                <Input {...fieldProps(f)} type="datetime-local" value={endsAt}
                       min={startsAt || undefined}
                       onChange={(e) => setEndsAt(e.target.value)} />
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Host" required>
              {(f) => (
                <Input {...fieldProps(f)} value={hostName} placeholder="Mr Sharma"
                       onChange={(e) => setHostName(e.target.value)} />
              )}
            </Field>
            <Field label="Telephone">
              {(f) => (
                <Input {...fieldProps(f)} value={hostPhone} inputMode="tel"
                       onChange={(e) => setHostPhone(e.target.value)} />
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expected guests">
              {(f) => (
                <Input {...fieldProps(f)} value={pax} inputMode="numeric"
                       onChange={(e) => setPax(e.target.value)} />
              )}
            </Field>
            <Field
              label="Agreed amount"
              hint={
                chosen?.defaultRate != null
                  ? `This hall's usual is ${money(chosen.defaultRate)}. Leave blank if not yet agreed.`
                  : "Leave blank if it is not agreed yet. It stays unpriced, not free."
              }
            >
              {(f) => (
                <div className="flex gap-2">
                  <Input {...fieldProps(f)} value={amount} inputMode="decimal"
                         placeholder="—"
                         onChange={(e) => setAmount(e.target.value)} />
                  {/* OFFERED, never applied on its own. The number that
                      gets billed is the one somebody put here. */}
                  {chosen?.defaultRate != null && (
                    <Button type="button" variant="secondary" className="h-11 shrink-0"
                            onClick={() => setAmount(String(chosen.defaultRate))}>
                      Use usual
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>

          <Field label="Notes">
            {(f) => (
              <Textarea {...fieldProps(f)} value={notes} rows={2}
                        onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </div>

      </DialogContent>
    </Dialog>
  );
}
