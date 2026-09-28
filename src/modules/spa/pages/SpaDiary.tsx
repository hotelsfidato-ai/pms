import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { CalendarDays, Flower2, Plus, Settings2 } from "lucide-react";
import { money } from "@/lib/format";
import { useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, StatusPill,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast,
  ReadFailed, ReadStale, readError,
} from "@/components/ui";
import { listStays } from "@/modules/front-desk";
import {
  getSpaDiary, getTherapists, getTreatments, bookTreatment, cancelAppointment,
  closeAppointment,
  clockDate, clockTime, shiftDay, TAKES_A_BOOKING, SETS_THE_LIST,
  type SpaAppointment, type SpaDiaryTherapist,
} from "@/modules/spa/data/spa";

/* ══════════════════════════════════════════════════════════════════
   THE SPA DIARY

   One question, asked of this screen more than any other: WHO IS FREE
   AT FOUR. So the therapist is the row and the treatments sit inside
   it, the way the banquet diary puts functions inside a hall.

   AN EMPTY THERAPIST IS AN ANSWER, drawn as "Free all day" and never
   omitted — a therapist missing from the list reads as somebody who has
   left, and the free one is exactly who the desk is looking for.

   ONE THERAPIST IS NOT IN TWO PLACES AT ONCE, and that guard is in the
   database, not here. When it refuses, it NAMES the therapist, the
   guest, the treatment and the hour standing in the way; this screen
   shows that sentence and never replaces it with one of its own.

   UNPRICED IS A DASH. Never ₹0 — a treatment shown as free is worse
   than a treatment shown as unpriced, and an unpriced one cannot be
   closed for money at all.

   A TIME BELONGS TO THE PROPERTY (113). Every time on this screen is
   the string `app.hotel_clock` wrote, sliced; nothing here builds a
   Date, because a laptop in another zone would otherwise move the whole
   day (`data/spa.ts` has the long version).
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

/** A figure nobody has typed reads "-" (the owner's oldest rule). */
const rupees = (value: number | null) => (value === null ? "-" : money(value));

/** How it was closed (D18-6), or nothing at all while it is still to
    happen. There is no third state: the schema makes closed and settled
    the same fact. */
const SETTLEMENT: Record<string, { label: string; tone: "success" | "info" }> = {
  room: { label: "On the room", tone: "info" },
  spa:  { label: "Paid at the spa", tone: "success" },
};

export default function SpaDiaryPage() {
  const code = useHotel();
  const role = useRole();
  const navigate = useNavigate();
  const [day, setDay] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [cancelling, setCancelling] = useState<SpaAppointment | null>(null);
  const [closing, setClosing] = useState<SpaAppointment | null>(null);

  const mayBook = TAKES_A_BOOKING.includes(role);

  /* `day` is null until somebody moves: the FIRST read asks for no date
     at all, so the diary opens on the PROPERTY's business date, which
     the server knows and this browser does not. */
  const diary = useQuery({
    queryKey: ["spa", "diary", code, day ?? ""],
    queryFn: () => getSpaDiary(code, day ?? undefined, day ?? undefined),
    enabled: !!code,
  });

  if (diary.isLoading) {
    return (
      <Page>
        <PageHeader title="Spa diary" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  /* NOTHING TO SHOW BECAUSE THE READ DID NOT SUCCEED — never "nothing
     booked". A property with the spa switched off lands here too, as the
     server's own refusal ("This property has no spa. Turn it on in the
     property's settings…"), shown as it is. */
  if (!diary.data) {
    return (
      <Page>
        <PageHeader title="Spa diary" />
        <ReadFailed error={readError(diary)} what="the spa diary"
                    onRetry={() => void diary.refetch()} />
      </Page>
    );
  }

  const { from, businessDate, therapists } = diary.data;
  const booked = therapists.reduce((n, t) => n + t.appointments.length, 0);

  return (
    <Page>
      <PageHeader
        title="Spa diary"
        description={
          booked === 0
            ? `Nothing booked on ${clockDate(from)}.`
            : `${booked} ${booked === 1 ? "treatment" : "treatments"} on ${clockDate(from)}.`
        }
        actions={
          <>
            {SETS_THE_LIST.includes(role) && (
              <Button variant="secondary"
                      onClick={() => void navigate(`/h/${code}/spa/setup`)}>
                <Settings2 className="size-4" /> Treatments and therapists
              </Button>
            )}
            {mayBook && (
              <Button variant="primary" onClick={() => setBooking(true)}>
                <Plus className="size-4" /> Book a treatment
              </Button>
            )}
          </>
        }
      />

      <ReadStale className="mb-5" error={readError(diary)} loadedAt={diary.dataUpdatedAt}
                 onRetry={() => void diary.refetch()} />

      {/* RULE 6: somebody who may only look is told so, rather than left
          hunting for a button that is not there. D18-21: housekeeping
          sees the diary and reception books. */}
      {!mayBook && (
        <Card className="mb-5">
          <CardBody className="text-sm text-grey-600">
            Your role sees the diary and does not book. Taking or cancelling a
            treatment is reception's, the manager's, an administrator's or the
            owner's — ask one of them.
          </CardBody>
        </Card>
      )}

      {/* One chart card, the Calendar's way (fidato-design § 4, a time
          grid): its own toolbar moves the day; each therapist is a row on
          the grey-50 of the Calendar's group rows, the treatments list
          rows under them, a hairline between. */}
      <Card className="overflow-hidden">
        {/* The day, one at a time. "Today" is the PROPERTY's operating day,
            which the server sent — not this laptop's date. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-grey-200">
          <Button variant="secondary"
                  onClick={() => setDay(shiftDay(from, -1))}>
            ← Day before
          </Button>
          <Button variant="secondary" onClick={() => setDay(businessDate)}>
            <CalendarDays className="size-4" /> Today
          </Button>
          <Button variant="secondary"
                  onClick={() => setDay(shiftDay(from, 1))}>
            Day after →
          </Button>
        </div>

        {therapists.length === 0 ? (
          <EmptyState
            compact
            icon={<Flower2 />}
            title="No therapists yet"
            description={
              "A booking is against a person, not a room, so the diary has "
              + "nothing to draw until somebody enters who gives the treatments. "
              + "Nothing is created for you."
            }
            action={SETS_THE_LIST.includes(role)
              ? <Button onClick={() => void navigate(`/h/${code}/spa/setup`)}>
                  Add a therapist
                </Button>
              : undefined}
          />
        ) : (
          therapists.map((t) => (
            <TherapistDay
              key={t.id} therapist={t} mayBook={mayBook}
              onCancel={(a) => setCancelling(a)}
              onClose={(a) => setClosing(a)}
            />
          ))
        )}
      </Card>

      {booking && (
        <BookDialog code={code} day={from} onClose={() => setBooking(false)} />
      )}
      {cancelling && (
        <CancelDialog
          code={code} appointment={cancelling}
          onClose={() => setCancelling(null)}
        />
      )}
      {closing && (
        <CloseDialog
          code={code} appointment={closing}
          onClose={() => setClosing(null)}
        />
      )}
    </Page>
  );
}

function TherapistDay({
  therapist, mayBook, onCancel, onClose,
}: {
  therapist: SpaDiaryTherapist;
  mayBook: boolean;
  onCancel: (appointment: SpaAppointment) => void;
  onClose: (appointment: SpaAppointment) => void;
}) {
  const free = therapist.appointments.length === 0;
  return (
    <section className="border-b border-grey-200 last:border-b-0">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5
                    bg-grey-50 border-b border-grey-200">
        <span className="text-sm font-semibold text-ink-900">{therapist.name}</span>
        <span className="text-xs text-grey-500">
          {free
            ? "nothing booked"
            : `${therapist.appointments.length} today`}
        </span>
      </p>

      {free ? (
        <p className="flex items-center px-4 py-3 min-h-14 text-sm text-grey-500">
          Free all day.
        </p>
      ) : (
        <ul className="divide-y divide-grey-100">
          {therapist.appointments.map((a) => (
            <li key={a.id} className="px-4 py-3 min-h-14">
              {/* The hour first and the amount level at the right, the
                  way a diary is read down the day. */}
              <div className="flex items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-ink-900 tabular">
                  {clockTime(a.startsAt)} → {clockTime(a.endsAt)}
                </span>
                <span className={a.amount === null
                  ? "text-sm text-grey-500"
                  : "text-sm font-medium text-ink-900 tabular"}>
                  {rupees(a.amount)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-ink-900">
                {a.treatment ?? "-"}
              </p>
              <p className="mt-0.5 text-sm text-grey-500">
                {a.guestName ?? "-"}
                {/* The room comes from the stay, and a guest with no room
                    assigned yet is a dash — never a blank that reads as
                    "no room needed". */}
                {a.room ? ` · Room ${a.room}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                {a.settlement && SETTLEMENT[a.settlement] && (
                  <StatusPill tone={SETTLEMENT[a.settlement]!.tone}>
                    {SETTLEMENT[a.settlement]!.label}
                  </StatusPill>
                )}
                {a.amount === null && (
                  <span className="text-xs text-grey-500">
                    Unpriced — it cannot be closed for money until the
                    treatment has a price.
                  </span>
                )}
                {mayBook && a.status === "booked" && (
                  <span className="ml-auto flex gap-2">
                    <Button variant="secondary" size="sm"
                            onClick={() => onCancel(a)}>
                      Cancel
                    </Button>
                    {/* The treatment was given: it goes on the room bill
                        (D18-22). Not offered while it is unpriced — the
                        line above already says why, and a button that is
                        refused is worse than no button. */}
                    {a.amount !== null && (
                      <Button variant="secondary" size="sm"
                              onClick={() => onClose(a)}>
                        Charge to room
                      </Button>
                    )}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAKING A BOOKING

   The desk, from a telephone call (D18-6). Four answers: which guest,
   which treatment, which therapist, what time — and NOT how long, which
   comes from the treatment so that nobody can book ninety minutes into
   a thirty-minute slot.

   AGAINST A STAY, ALWAYS. A walk-in who is not staying is a bill with
   nothing behind it and is not in this version, so the guest is chosen
   from who is in the house rather than typed.

   THE TIME IS TYPED ON THE PROPERTY'S CLOCK and sent as the person
   typed it — `2026-09-19T16:00`, no offset. `app.hotel_moment` reads it
   at the hotel. A browser-made ISO string here is BQ-8 all over again.
   ══════════════════════════════════════════════════════════════════ */

function BookDialog({
  code, day, onClose,
}: {
  code: string; day: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [stayId, setStayId] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [therapistId, setTherapistId] = useState("");
  const [at, setAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* WHO IS HERE OR COMING. The front desk's own list, through its front
     door — a second query for "which guests" is how two screens come to
     disagree about who has checked in.

     ⚠ NOT "in house". The server refuses a booking against a CANCELLED
     or a CHECKED-OUT stay and accepts everything else, so a list of
     only the guests already in their rooms would be this screen
     inventing a rule the service does not have — and the telephone call
     that books a massage for tomorrow's arrival is the ordinary case,
     not the exception. Opened on the demo property, where nobody is
     checked in and the list was empty. */
  const stays = useQuery({
    queryKey: ["spa", "stays", code],
    queryFn: () => listStays(code, { status: ["due-in", "in-house", "due-out"] }),
  });
  const treatments = useQuery({
    queryKey: ["spa", "treatments", code],
    queryFn: () => getTreatments(code),
  });
  const therapists = useQuery({
    queryKey: ["spa", "therapists", code],
    queryFn: () => getTherapists(code),
  });

  /* Retired ones are not offered. The server refuses them by name
     anyway ("… is not taking appointments"), which is the enforcement. */
  const onOffer = (treatments.data ?? []).filter((t) => t.isActive);
  const available = (therapists.data ?? []).filter((t) => t.isActive);
  const chosen = onOffer.find((t) => t.id === treatmentId);

  const submit = async () => {
    setProblem(null);
    if (!stayId) { setProblem("Which guest is this for?"); return; }
    if (!treatmentId) { setProblem("Which treatment?"); return; }
    if (!therapistId) { setProblem("Which therapist?"); return; }
    if (!at) { setProblem("What time?"); return; }

    setSaving(true);
    const out = await bookTreatment(code, {
      stayId, treatmentId, therapistId,
      /* The day being looked at, and the time as typed. Both read on the
         property's clock by the server. */
      startsAt: `${day}T${at}`,
    });
    setSaving(false);

    /* THE SERVER'S OWN SENTENCE. When a therapist is already busy it
       names them, the guest, the treatment and the hour; when the
       property has set no spa GST rule it names where GST is set (D18-21).
       Either is what the person needs; "could not book" is not. */
    if (!out.ok) { setProblem(out.reason); return; }

    void qc.invalidateQueries({ queryKey: ["spa", "diary", code] });
    onClose();
    toast.success("The treatment is in the diary.");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Book a treatment"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Book it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-grey-500">
            On {clockDate(day)}, at this property's own clock.
          </p>

          {stays.data?.length === 0 && (
            <p className="text-sm text-ink-700">
              No guest is here or expected, and every treatment is against a
              stay. Take the booking for the room first.
            </p>
          )}

          <Field label="Which guest">
            {(p) => (
              <NativeSelect {...fieldProps(p)} value={stayId}
                            onChange={(e) => setStayId(e.target.value)}>
                <option value="">Pick a guest</option>
                {(stays.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.roomNumber ? `Room ${s.roomNumber} · ` : ""}{s.guest}
                    {/* A booking still to arrive says WHEN, because the
                        desk is choosing between two Sharmas by the day
                        they come, not by a room they have not got. */}
                    {s.status === "due-in" ? ` · arriving ${clockDate(s.arrival)}` : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field
            label="Which treatment"
            hint="Its length is what places it in the day, so nothing here asks when it ends."
          >
            {(p) => (
              <NativeSelect {...fieldProps(p)} value={treatmentId}
                            onChange={(e) => setTreatmentId(e.target.value)}>
                <option value="">Pick a treatment</option>
                {onOffer.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.minutes} min ·{" "}
                    {t.price === null ? "unpriced" : money(t.price)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          {/* SAID BEFORE IT IS BOOKED, not discovered at the till. An
              unpriced treatment may be taken — the guest asked for it —
              but it cannot be closed for money, so somebody has to know. */}
          {chosen?.price === null && (
            <p className="text-sm text-ink-700">
              {chosen.name} has no price. The booking can be taken, and it
              cannot be closed for money until somebody prices it on
              Treatments and therapists.
            </p>
          )}

          <Field label="Which therapist">
            {(p) => (
              <NativeSelect {...fieldProps(p)} value={therapistId}
                            onChange={(e) => setTherapistId(e.target.value)}>
                <option value="">Pick a therapist</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field label="What time">
            {(p) => (
              <Input {...fieldProps(p)} type="time" value={at}
                     onChange={(e) => setAt(e.target.value)} />
            )}
          </Field>

          {problem && (
            <p role="alert" className="text-sm text-brand-red-700">{problem}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A cancellation says why. The reason is the thing somebody asks about
    a month later, and the server refuses an empty one. */
function CancelDialog({
  code, appointment, onClose,
}: {
  code: string; appointment: SpaAppointment; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    setSaving(true);
    const out = await cancelAppointment(code, appointment.id, reason.trim());
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["spa", "diary", code] });
    onClose();
    toast.success("The hour is free again.");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Cancel this treatment"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Keep it</Button>
            <Button variant="danger" loading={saving} onClick={() => void submit()}>
              Cancel the treatment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-700">
            {appointment.treatment ?? "The treatment"} for{" "}
            {appointment.guestName ?? "the guest"} at {clockTime(appointment.startsAt)}.
            The therapist's hour goes back into the diary.
          </p>

          <Field
            label="Why"
            hint="Whoever asks about this in a month reads this line."
          >
            {(p) => (
              <Input {...fieldProps(p)} value={reason}
                     onChange={(e) => setReason(e.target.value)}
                     placeholder="The guest cancelled by telephone" />
            )}
          </Field>

          {problem && (
            <p role="alert" className="text-sm text-brand-red-700">{problem}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   THE TREATMENT WAS GIVEN, AND IT GOES ON THE ROOM BILL (D18-22)

   The owner, 19 September: a treatment goes on the room bill, the spa
   needs no connection of its own for money, and "settled at the spa" is
   set aside for later. So there is nothing to choose here — this says
   exactly what is about to happen and to whose bill, because once it is
   posted the only way back is a reversal on the folio.

   Every refusal is the SERVER'S OWN SENTENCE, shown as it comes: no spa
   tax rule set at this property (D18-21, and it names where GST is set),
   a bill that is already closed, a treatment somebody else closed a
   moment ago. None of them is rewritten here.
   ══════════════════════════════════════════════════════════════════ */
function CloseDialog({
  code, appointment, onClose,
}: {
  code: string; appointment: SpaAppointment; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    setSaving(true);
    const out = await closeAppointment(code, appointment.id);
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["spa", "diary", code] });
    onClose();
    toast.success(appointment.room
      ? `Charged to room ${appointment.room}.`
      : "Charged to the guest's bill.");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        title="Charge this treatment to the room"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Not yet</Button>
            {/* The act of this dialog, so it is its one primary. */}
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Charge to room
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-700">
            {appointment.treatment ?? "The treatment"} for{" "}
            {appointment.guestName ?? "the guest"} at {clockTime(appointment.startsAt)}
            {appointment.room ? `, room ${appointment.room}` : ""}.
          </p>
          <p className="text-sm text-ink-700">
            <span className="font-medium tabular-nums">{rupees(appointment.amount)}</span>{" "}
            goes on their bill as its own line, taxed at this property's spa rate.
            To undo it later, reverse the line on the bill.
          </p>

          {problem && (
            <p role="alert" className="text-sm text-brand-red-700">{problem}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
