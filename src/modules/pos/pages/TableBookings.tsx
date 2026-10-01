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
  getTableBookings, confirmTableBooking, declineTableBooking, type TableBooking,
} from "@/modules/pos/data/tableBookings";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS (the owner's D27-221, D27-224)

   Hotel guests ask for a table from their own page. Somebody here
   answers each one - no capacity rules, a person decides: Confirm, with
   a table if they like, or Decline with a reason the guest reads.

   Waiting first (whatever night it is for), then today, then upcoming.
   ══════════════════════════════════════════════════════════════════ */

const STATUS: Record<TableBooking["status"], { words: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  requested: { words: "Waiting", tone: "warning" },
  confirmed: { words: "Confirmed", tone: "success" },
  declined: { words: "Declined", tone: "danger" },
  cancelled: { words: "Cancelled by the guest", tone: "neutral" },
};

const dayWords = (date: string, today: string) =>
  date === today ? "Today"
    : new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function TableBookingsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const mayAnswer = mayRingUp(useRole());
  const q = useQuery({
    queryKey: ["table-bookings", hotelId],
    queryFn: () => getTableBookings(hotelId),
    enabled: Boolean(hotelId),
    refetchInterval: 60_000,
  });

  const all = q.data?.bookings ?? [];
  /* "Today" by the hotel's clock, which the server sends. */
  const today = q.data?.today ?? "";
  const waiting = all.filter((b) => b.status === "requested");
  const answered = all.filter((b) => b.status !== "requested");
  const todays = answered.filter((b) => b.date === today);
  const later = answered.filter((b) => b.date !== today);

  return (
    <Page>
      <PageHeader
        title="Table bookings"
        description="Hotel guests ask for a table from their own page. Confirm each one, or decline it with a reason they will read."
      />
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError || !q.data ? (
        <Card><ReadFailed error={q.error} what="the table bookings" onRetry={() => void q.refetch()} /></Card>
      ) : (
        <>
          <List title="Waiting" empty="Nothing is waiting for an answer." rows={waiting}
                today={today} hotelId={hotelId} tables={q.data.tables} mayAnswer={mayAnswer} />
          <List title="Today" empty="No table booked for today." rows={todays}
                today={today} hotelId={hotelId} tables={q.data.tables} mayAnswer={mayAnswer} />
          <List title="Upcoming" empty="Nothing booked after today." rows={later}
                today={today} hotelId={hotelId} tables={q.data.tables} mayAnswer={mayAnswer} />
        </>
      )}
    </Page>
  );
}

function List({ title, empty, rows, today, hotelId, tables, mayAnswer }: {
  title: string; empty: string; rows: TableBooking[]; today: string; hotelId: string;
  tables: { id: string; label: string }[]; mayAnswer: boolean;
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

function BookingCard({ booking: b, today, hotelId, tables, mayAnswer }: {
  booking: TableBooking; today: string; hotelId: string;
  tables: { id: string; label: string }[]; mayAnswer: boolean;
}) {
  const [asking, setAsking] = useState<"confirm" | "decline" | null>(null);
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
            </p>
          </div>
          <StatusPill tone={STATUS[b.status].tone}>{STATUS[b.status].words}</StatusPill>
        </div>
        <p className="text-base text-ink-900 break-words">
          {b.guest} · room {b.room ?? "-"} <span className="text-sm text-grey-500">· {b.reference}</span>
        </p>
        {b.note && <p className="text-sm text-grey-700 break-words">"{b.note}"</p>}
        {b.status === "confirmed" && (
          <p className="text-sm text-grey-600">
            {b.table ? `Table ${b.table.label}` : "No table named"}{b.answeredBy ? ` · by ${b.answeredBy}` : ""}
          </p>
        )}
        {b.status === "declined" && (
          <p className="text-sm text-grey-600 break-words">Told the guest: {b.answer}</p>
        )}
        {b.status === "requested" && mayAnswer && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={() => setAsking("confirm")}>Confirm</Button>
            <Button variant="secondary" onClick={() => setAsking("decline")}>Decline</Button>
          </div>
        )}
      </CardBody>
      {asking && (
        <AnswerDialog booking={b} hotelId={hotelId} tables={tables} confirm={asking === "confirm"}
                      onClose={() => setAsking(null)} />
      )}
    </Card>
  );
}

function AnswerDialog({ booking: b, hotelId, tables, confirm, onClose }: {
  booking: TableBooking; hotelId: string; tables: { id: string; label: string }[];
  confirm: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [table, setTable] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const res = confirm
      ? await confirmTableBooking(hotelId, b.id, table || null)
      : await declineTableBooking(hotelId, b.id, why);
    setBusy(false);
    if (!res.ok) return toast.error("Not answered", res.reason);
    toast.success(confirm ? "Confirmed" : "Declined", "The guest sees it on their page.");
    void qc.invalidateQueries({ queryKey: ["table-bookings", hotelId] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={confirm ? "Confirm this table" : "Decline this table"}
        description={`${b.guest}, ${b.party} ${b.party === 1 ? "person" : "people"}, ${dayWords(b.date, "")} at ${b.time}.`}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void send()}>
              {confirm ? "Confirm" : "Decline"}
            </Button>
          </>
        }
      >
        {confirm ? (
          <Field label="Table" hint="If you know it now. The guest is not shown the table.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={table} onChange={(e) => setTable(e.target.value)}>
                <option value="">Not yet</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </NativeSelect>
            )}
          </Field>
        ) : (
          <Field label="Reason" required hint="The guest reads this on their page.">
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
