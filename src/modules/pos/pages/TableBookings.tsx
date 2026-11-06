import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Page, PageHeader, Section, Card, CardBody, Button, Skeleton, StatusPill, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, ReadFailed,
} from "@/components/ui";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { mayRingUp } from "@/modules/pos/nav";
import {
  getTableBookings, confirmTableBooking, declineTableBooking, bookOutsideDiner,
  markArrived, seatBooking, markNoShow, cancelBooking, type TableBooking, type TableBookingList,
} from "@/modules/pos/data/tableBookings";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS (the owner's D27-221, D27-224; outside diners, D27-383
   item 9)

   Hotel guests ask for a table from their own page. Somebody here
   answers each one - no capacity rules, a person decides: Confirm, with
   a table if they like, or Decline with a reason the guest reads.

   Somebody not staying is booked here (New booking): confirmed as it is
   taken. On the night every confirmed booking is marked Arrived, Seated at
   a table - which opens that table's bill, as Tables does - a No-show once
   its time has come, or Cancelled.

   Waiting first (whatever night it is for), then the chosen day (today
   unless another is picked), then what comes after it.
   ══════════════════════════════════════════════════════════════════ */

const STATUS: Record<TableBooking["status"], { words: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  requested: { words: "Waiting", tone: "warning" },
  confirmed: { words: "Confirmed", tone: "success" },
  declined: { words: "Declined", tone: "danger" },
  cancelled: { words: "Cancelled", tone: "neutral" },
  arrived: { words: "Arrived", tone: "warning" },
  seated: { words: "Seated", tone: "success" },
  no_show: { words: "No-show", tone: "danger" },
};

const dayWords = (date: string, today: string) =>
  date === today ? "Today"
    : new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

type Tables = TableBookingList["tables"];
type Sections = NonNullable<TableBookingList["sections"]>;

export default function TableBookingsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const mayAnswer = mayRingUp(useRole());
  /* "" is the hotel's today, as the server reckons it. */
  const [day, setDay] = useState("");
  const [booking, setBooking] = useState(false);
  const q = useQuery({
    queryKey: ["table-bookings", hotelId, day],
    queryFn: () => getTableBookings(hotelId, day || undefined),
    enabled: Boolean(hotelId),
    refetchInterval: 60_000,
  });

  const all = q.data?.bookings ?? [];
  /* "Today" by the hotel's clock, which the server sends. */
  const today = q.data?.today ?? "";
  const shown = day || today;
  const waiting = all.filter((b) => b.status === "requested");
  const answered = all.filter((b) => b.status !== "requested");
  const todays = answered.filter((b) => b.date === shown);
  const later = answered.filter((b) => b.date !== shown);
  const tables = q.data?.tables ?? [];
  const sections = q.data?.sections ?? [];

  return (
    <Page>
      <PageHeader
        title="Table bookings"
        description="Hotel guests ask for a table from their own page: confirm each one, or decline it with a reason they will read. Book anybody else here, and mark each booking on the night."
        actions={mayAnswer ? <Button variant="primary" onClick={() => setBooking(true)}>New booking</Button> : undefined}
      />
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <Field label="Day">
          {(f) => (
            <Input {...fieldProps(f)} type="date" value={shown} className="w-44"
                   onChange={(e) => setDay(e.target.value === today ? "" : e.target.value)} />
          )}
        </Field>
        {day && <Button variant="ghost" onClick={() => setDay("")}>Back to today</Button>}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError || !q.data ? (
        <Card><ReadFailed error={q.error} what="the table bookings" onRetry={() => void q.refetch()} /></Card>
      ) : (
        <>
          <List title="Waiting" empty="Nothing is waiting for an answer." rows={waiting}
                today={today} hotelId={hotelId} tables={tables} mayAnswer={mayAnswer} />
          <List title={shown === today ? "Today" : dayWords(shown, today)}
                empty={shown === today ? "No table booked for today." : "No table booked for that day."}
                rows={todays} today={today} hotelId={hotelId} tables={tables} mayAnswer={mayAnswer} />
          <List title="Upcoming" empty="Nothing booked after that." rows={later}
                today={today} hotelId={hotelId} tables={tables} mayAnswer={mayAnswer} />
        </>
      )}
      {booking && (
        <NewBooking hotelId={hotelId} today={today} tables={tables} sections={sections}
                    onClose={() => setBooking(false)} />
      )}
    </Page>
  );
}

function List({ title, empty, rows, today, hotelId, tables, mayAnswer }: {
  title: string; empty: string; rows: TableBooking[]; today: string; hotelId: string;
  tables: Tables; mayAnswer: boolean;
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="text-base text-grey-500">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <BookingCard key={b.id} booking={b} today={today} hotelId={hotelId}
                         tables={tables} mayAnswer={mayAnswer} />
          ))}
        </div>
      )}
    </Section>
  );
}

type Asking = "confirm" | "decline" | "seat" | "cancel";

function BookingCard({ booking: b, today, hotelId, tables, mayAnswer }: {
  booking: TableBooking; today: string; hotelId: string; tables: Tables; mayAnswer: boolean;
}) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const onNight = b.status === "confirmed" || b.status === "arrived";

  const mark = async (act: "arrived" | "no-show") => {
    setBusy(true);
    const res = act === "arrived" ? await markArrived(hotelId, b.id) : await markNoShow(hotelId, b.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not marked", res.reason);
    toast.success(act === "arrived" ? `${b.guest} has arrived` : `${b.guest}: a no-show`);
    void qc.invalidateQueries({ queryKey: ["table-bookings", hotelId] });
  };

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-md font-semibold text-ink-900">
              {dayWords(b.date, today)} · {b.time}
            </p>
            <p className="text-sm text-grey-600">
              {b.party} {b.party === 1 ? "person" : "people"} · {b.outlet}
              {b.section ? ` · ${b.section.name}` : ""}
            </p>
          </div>
          <StatusPill tone={STATUS[b.status].tone}>{STATUS[b.status].words}</StatusPill>
        </div>
        {b.outside ? (
          <p className="text-base text-ink-900 break-words">
            {b.guest} · {b.phone ?? "-"} <span className="text-sm text-grey-500">· not staying</span>
          </p>
        ) : (
          <p className="text-base text-ink-900 break-words">
            {b.guest} · room {b.room ?? "-"} <span className="text-sm text-grey-500">· {b.reference}</span>
          </p>
        )}
        {b.note && <p className="text-sm text-grey-700 break-words">"{b.note}"</p>}
        {(b.status === "confirmed" || b.status === "arrived") && (
          <p className="text-sm text-grey-600">
            {b.table ? `Table ${b.table.label}` : "No table named"}{b.answeredBy ? ` · by ${b.answeredBy}` : ""}
            {b.status === "arrived" && b.arrivedAt ? ` · arrived ${b.arrivedAt}` : ""}
          </p>
        )}
        {b.status === "seated" && (
          <p className="text-sm text-grey-600">
            At table {b.table?.label ?? "-"}{b.order ? ` · bill ${b.order.orderNo} is open on Tables` : ""}
          </p>
        )}
        {b.status === "declined" && (
          <p className="text-sm text-grey-600 break-words">Told the guest: {b.answer}</p>
        )}
        {b.status === "cancelled" && b.answer && (
          <p className="text-sm text-grey-600 break-words">Why: {b.answer}</p>
        )}
        {b.status === "requested" && mayAnswer && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={() => setAsking("confirm")}>Confirm</Button>
            <Button variant="secondary" onClick={() => setAsking("decline")}>Decline</Button>
          </div>
        )}
        {onNight && mayAnswer && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={() => setAsking("seat")}>Seat</Button>
            {b.status === "confirmed" && (
              <Button variant="secondary" loading={busy} onClick={() => void mark("arrived")}>Arrived</Button>
            )}
            {b.status === "confirmed" && (
              <Button variant="secondary" loading={busy} onClick={() => void mark("no-show")}>No-show</Button>
            )}
            <Button variant="ghost" onClick={() => setAsking("cancel")}>Cancel booking</Button>
          </div>
        )}
      </CardBody>
      {asking && (
        <AnswerDialog booking={b} hotelId={hotelId} tables={tables} act={asking}
                      onClose={() => setAsking(null)} />
      )}
    </Card>
  );
}

const ACT: Record<Asking, { title: string; button: string; done: string }> = {
  confirm: { title: "Confirm this table", button: "Confirm", done: "Confirmed" },
  decline: { title: "Decline this table", button: "Decline", done: "Declined" },
  seat: { title: "Seat them", button: "Seat", done: "Seated" },
  cancel: { title: "Cancel this booking", button: "Cancel booking", done: "Cancelled" },
};

function AnswerDialog({ booking: b, hotelId, tables, act, onClose }: {
  booking: TableBooking; hotelId: string; tables: Tables; act: Asking; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [table, setTable] = useState(act === "seat" ? b.table?.id ?? "" : "");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const res = act === "confirm" ? await confirmTableBooking(hotelId, b.id, table || null)
      : act === "decline" ? await declineTableBooking(hotelId, b.id, why)
        : act === "seat" ? await seatBooking(hotelId, b.id, table)
          : await cancelBooking(hotelId, b.id, why);
    setBusy(false);
    if (!res.ok) return toast.error("Not done", res.reason);
    const label = tables.find((t) => t.id === table)?.label;
    toast.success(ACT[act].done,
      act === "seat" ? `At table ${label ?? ""}: its bill is open on Tables.`
        : act === "cancel" ? undefined : "The guest sees it on their page.");
    void qc.invalidateQueries({ queryKey: ["table-bookings", hotelId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={ACT[act].title}
        description={`${b.guest}, ${b.party} ${b.party === 1 ? "person" : "people"}, ${dayWords(b.date, "")} at ${b.time}.`}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Back</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={act === "seat" && !table}
                    onClick={() => void send()}>
              {ACT[act].button}
            </Button>
          </>
        }
      >
        {act === "confirm" || act === "seat" ? (
          <Field label="Table" required={act === "seat"}
                 hint={act === "seat" ? "A free table: its bill opens with the party as its covers."
                   : "If you know it now. The guest is not shown the table."}>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={table} onChange={(e) => setTable(e.target.value)}>
                <option value="">{act === "seat" ? "Choose a table" : "Not yet"}</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.section ? `${t.label} · ${t.section}` : t.label}</option>)}
              </NativeSelect>
            )}
          </Field>
        ) : (
          <Field label="Reason" required={act === "decline"}
                 hint={act === "decline" ? "The guest reads this on their page." : "If they gave one."}>
            {(f) => (
              <Input {...fieldProps(f)} value={why} autoFocus maxLength={200}
                     onChange={(e) => setWhy(e.target.value)} />
            )}
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* A table for somebody not staying (263): the person taking it types it,
   and it is confirmed as it is made. Every refusal is the server's sentence. */
function NewBooking({ hotelId, today, tables, sections, onClose }: {
  hotelId: string; today: string; tables: Tables; sections: Sections; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: "", phone: "", party: "", date: today, time: "", tableId: "", sectionId: "", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const send = async () => {
    setBusy(true);
    const res = await bookOutsideDiner(hotelId, {
      name: v.name, phone: v.phone, party: Number(v.party), date: v.date, time: v.time,
      tableId: v.tableId || null, sectionId: v.tableId ? null : v.sectionId || null, note: v.note,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not booked", res.reason);
    toast.success("Booked", `${v.name}, ${v.party} at ${v.time}.`);
    void qc.invalidateQueries({ queryKey: ["table-bookings", hotelId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="A table for somebody not staying"
        description="Confirmed as you take it. A hotel guest books from their own page."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Back</Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void send()}>Book the table</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>{(f) => <Input {...fieldProps(f)} value={v.name} maxLength={60} autoFocus onChange={set("name")} />}</Field>
          <Field label="Phone" required>{(f) => <Input {...fieldProps(f)} value={v.phone} inputMode="tel" onChange={set("phone")} />}</Field>
          <Field label="People" required>{(f) => <Input {...fieldProps(f)} value={v.party} inputMode="numeric" onChange={set("party")} />}</Field>
          <Field label="Day" required>{(f) => <Input {...fieldProps(f)} type="date" value={v.date} min={today} onChange={set("date")} />}</Field>
          <Field label="Time" required>{(f) => <Input {...fieldProps(f)} type="time" value={v.time} onChange={set("time")} />}</Field>
          <Field label="Table" hint="If you know it now.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={v.tableId} onChange={set("tableId")}>
                <option value="">Not yet</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.section ? `${t.label} · ${t.section}` : t.label}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Area" hint="Where they would like to sit, with no table yet.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={v.sectionId} disabled={Boolean(v.tableId)} onChange={set("sectionId")}>
                <option value="">Anywhere</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Note">{(f) => <Input {...fieldProps(f)} value={v.note} maxLength={200} onChange={set("note")} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
