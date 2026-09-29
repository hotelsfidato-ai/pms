import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Network, Plus, Trash2 } from "lucide-react";
import { dateShort, dateTime } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Skeleton, EmptyState, ErrorState,
  DataTable, StatusPill, Button, Field, Input, NativeSelect, Switch, fieldProps, toast,
  type Column, type Tone,
} from "@/components/ui";
import {
  getCrsBookings, getCrsSetup, markCrsNoteDone, saveCrsSetup,
  type CrsBooking, type CrsBookings, type CrsSetup,
} from "@/modules/crs/data/crs";

/* ══════════════════════════════════════════════════════════════════
   CRS BOOKINGS (D27-168, D27-171)

   Every booking the CRS sold for this hotel that the reader acted on:
   the waiting booking it became, or why it did not become one. A change
   made in the CRS afterwards stands here as a note for the desk, with
   Done; nothing is applied by itself. What the CRS's register was told
   (confirmed, refused, full) is shown once it was.

   The owner and an administrator also see the mapping: the property's
   CRS id, the source its bookings are filed under, each CRS room type's
   match here, and the switch.
   ══════════════════════════════════════════════════════════════════ */

const OUTCOME: Record<string, { words: string; tone: Tone }> = {
  booked: { words: "Booked here", tone: "info" },
  full: { words: "Hotel full - not booked", tone: "danger" },
  needs_attention: { words: "Needs attention", tone: "warning" },
};

const ANSWER: Record<string, string> = {
  confirmed: "Told: confirmed",
  refused: "Told: refused",
  full: "Told: hotel full",
};

const STAY_WORDS: Record<string, string> = {
  tentative: "Waiting for the hotel",
  confirmed: "Confirmed",
  checked_in: "In house",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  void: "Void",
  no_show: "No show",
};

function Connection({ c }: { c: CrsBookings["connection"] }) {
  const why = !c.settingsPresent
    ? "The CRS login is not in the server's settings yet, so nothing is read."
    : !c.mapped ? "This hotel is not connected to the CRS yet."
    : !c.on ? "Reading from the CRS is switched off for this hotel."
    : null;
  if (!why && !c.lastError) {
    return c.lastReadAt
      ? <p className="mb-5 text-sm text-grey-600">Last read from the CRS {dateTime(c.lastReadAt)}.</p>
      : null;
  }
  return (
    <Card className="mb-5 border-brand-yellow-100 bg-brand-yellow-50">
      <CardBody>
        <p className="text-sm text-ink-900 leading-relaxed">
          {why ?? `The last read from the CRS failed: ${c.lastError}`}
        </p>
      </CardBody>
    </Card>
  );
}

function Setup({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["crs-setup", code], queryFn: () => getCrsSetup(code) });
  const [form, setForm] = useState<{
    crsHotelId: string; bookingSourceId: string; isOn: boolean;
    roomTypes: Array<{ crsRoomTypeId: string; roomTypeId: string }>;
  } | null>(null);

  useEffect(() => {
    if (q.data && form === null) {
      setForm({
        crsHotelId: q.data.crsHotelId ?? "",
        bookingSourceId: q.data.bookingSourceId ?? "",
        isOn: q.data.isOn,
        roomTypes: q.data.roomTypes,
      });
    }
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: () => saveCrsSetup(code, form!),
    onSuccess: () => {
      toast.success("Saved. The CRS is read every five minutes.");
      void qc.invalidateQueries({ queryKey: ["crs-setup", code] });
      void qc.invalidateQueries({ queryKey: ["crs-bookings", code] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Not saved."),
  });

  if (q.isError) {
    return <Card className="mb-5"><ErrorState title="The CRS connection did not load" error={q.error}
      onRetry={() => void q.refetch()} /></Card>;
  }
  const data: CrsSetup | undefined = q.data;
  if (!data || !form) return <Skeleton className="h-48 mb-5" />;

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const setRow = (i: number, patch: Partial<(typeof form.roomTypes)[number]>) =>
    set({ roomTypes: form.roomTypes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <Card className="mb-5">
      <CardHeader
        title="Connection to the CRS"
        description={"The ids come from the CRS: open the property or the room type there, and "
          + "the last part of the address is its id. A CRS room type with no match here is "
          + "not booked by itself."}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="The property's id in the CRS" required>
            {(p) => <Input {...fieldProps(p)} value={form.crsHotelId}
              onChange={(e) => set({ crsHotelId: e.target.value })} />}
          </Field>
          <Field label="File CRS bookings under" required>
            {(p) => (
              <NativeSelect {...fieldProps(p)} value={form.bookingSourceId}
                onChange={(e) => set({ bookingSourceId: e.target.value })}>
                <option value="">Pick a source</option>
                {data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-grey-700">Room types</p>
          {form.roomTypes.length === 0 && (
            <p className="text-sm text-grey-500">No CRS room type is matched yet.</p>
          )}
          {form.roomTypes.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
              <Field label={i === 0 ? "CRS room type id" : undefined}>
                {(p) => <Input {...fieldProps(p)} aria-label="CRS room type id" value={r.crsRoomTypeId}
                  onChange={(e) => setRow(i, { crsRoomTypeId: e.target.value })} />}
              </Field>
              <Field label={i === 0 ? "Is this room type here" : undefined}>
                {(p) => (
                  <NativeSelect {...fieldProps(p)} aria-label="Room type here" value={r.roomTypeId}
                    onChange={(e) => setRow(i, { roomTypeId: e.target.value })}>
                    <option value="">Pick a room type</option>
                    {data.hotelRoomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Button variant="ghost" size="icon" aria-label="Remove this room type"
                onClick={() => set({ roomTypes: form.roomTypes.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm"
              onClick={() => set({ roomTypes: [...form.roomTypes, { crsRoomTypeId: "", roomTypeId: "" }] })}>
              <Plus className="size-4" /> Add a CRS room type
            </Button>
          </div>
        </div>

        <Switch checked={form.isOn} onCheckedChange={(isOn) => set({ isOn })}
          label="Read bookings from the CRS"
          description={"Bookings the CRS makes from the moment this is switched on arrive as "
            + "waiting bookings. One made while it was off is typed in by hand."} />

        <p className="text-sm text-grey-600">
          {data.readsAs
            ? `Reads as ${data.readsAs}.`
            : "No service account to read as yet: it is set up at go-live, and nothing is read until it is."}
        </p>

        <div>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save the connection
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default function CrsBookingsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const role = useRole();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["crs-bookings", code],
    queryFn: () => getCrsBookings(code),
    enabled: !!code,
  });

  const done = useMutation({
    mutationFn: (crsId: string) => markCrsNoteDone(code, crsId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["crs-bookings", code] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Not marked done."),
  });

  const columns: Column<CrsBooking>[] = [
    {
      key: "crs", header: "CRS booking",
      cell: (b) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink-900 tabular">{b.crsReference}</span>
          <span className="text-xs text-grey-600">{b.guestName ?? "-"}</span>
        </span>
      ),
    },
    {
      key: "stay", header: "Stay",
      cell: (b) => `${dateShort(b.checkIn)} to ${dateShort(b.checkOut)}`,
      hideBelow: "sm",
    },
    {
      key: "sold", header: "Sold by",
      cell: (b) => (
        <span className="flex flex-col">
          <span className="text-ink-900">{b.salesperson ?? "-"}</span>
          <span className="text-xs text-grey-600">{b.company ?? "-"}</span>
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "here", header: "Here",
      cell: (b) => (
        <span className="flex flex-col gap-1">
          <StatusPill tone={OUTCOME[b.outcome]?.tone ?? "neutral"}>
            {OUTCOME[b.outcome]?.words ?? b.outcome}
          </StatusPill>
          {b.bookings.map((s) => (
            <span key={s.id} className="text-xs text-grey-600 tabular">
              {s.reference} · {STAY_WORDS[s.status] ?? s.status}
            </span>
          ))}
          {b.reason && <span className="text-xs text-grey-600">{b.reason}</span>}
        </span>
      ),
    },
    {
      key: "told", header: "The CRS register",
      cell: (b) => b.answer ? ANSWER[b.answer] ?? b.answer
        : b.answerError ? <span className="text-brand-red">Not told: {b.answerError}</span>
        : "-",
      hideBelow: "lg",
    },
    {
      key: "note", header: "Changed in the CRS",
      cell: (b) => !b.changeNote ? "-" : (
        <span className="flex flex-col gap-1.5">
          <span className={b.changeDone ? "text-grey-500" : "text-ink-900"}>{b.changeNote}</span>
          {b.changeDone
            ? <span className="text-xs text-grey-500">Done</span>
            : (
              <span>
                <Button size="sm" variant="secondary" disabled={done.isPending}
                  onClick={() => done.mutate(b.crsId)}>
                  Done
                </Button>
              </span>
            )}
        </span>
      ),
    },
  ];

  const body = (() => {
    if (q.data === undefined) {
      if (q.isError) {
        return <Card><ErrorState title="CRS bookings did not load" error={q.error}
          onRetry={() => void q.refetch()} /></Card>;
      }
      return <Skeleton className="h-64" />;
    }
    if (q.data.bookings.length === 0) {
      return (
        <Card><EmptyState
          icon={<Network />}
          title="No CRS booking has arrived yet"
          description={"A booking a salesperson makes in the CRS for this hotel arrives here within "
            + "five minutes as a waiting booking, with the room held, for the hotel to confirm."}
        /></Card>
      );
    }
    return <DataTable rows={q.data.bookings} columns={columns} rowKey={(b) => b.crsId} />;
  })();

  return (
    <Page>
      <PageHeader title="CRS bookings"
        description="Bookings the CRS sold for this hotel, and what became of each" />
      {(role === "owner" || role === "admin") && <Setup code={code} />}
      {q.data && <Connection c={q.data.connection} />}
      {body}
    </Page>
  );
}
