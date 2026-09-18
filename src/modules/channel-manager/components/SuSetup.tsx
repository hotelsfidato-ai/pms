import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Send } from "lucide-react";
import {
  Button, Card, CardBody, Checkbox, Field, fieldProps, Input, NativeSelect, Textarea,
  StatusPill, ReadFailed, Skeleton, toast,
} from "@/components/ui";
import { money, dateTime, dateShort } from "@/lib/format";
import {
  getSuStatus, checkSuLogin, getSuContent, saveSuHotel, saveSuRoomType,
  saveSuRatePlan, sendSuContent, getSuAvailability, sendSuAvailability,
  getChannelBookings, markChannelBookingDone,
  type SuContent, type ContentRoomType, type ContentMealPlan, type SendResult,
  type ChannelBooking,
} from "../data/su";

/* ══════════════════════════════════════════════════════════════════
   THE SU CONNECTION, FOR THE OWNER AND AN ADMINISTRATOR (D17-66, D17-85)

   In the order they are needed:
     1. Is SU set up on the server, and does its login work?
     2. This hotel on SU: its SU id, and what SU requires that the hotel
        record does not hold.
     3. Its room types and meal plans, each with the id SU will know it by
        and whether it goes to SU.
     4. Send it to SU. The main action, and it says first what is still
        missing.
     5. Rooms left, prices and closures: a year, or only what changed.
     6. The bookings SU has pushed, and what became of each.

   NOTHING IS SUGGESTED. No SU id is filled in from a code, no SU room
   type from a name, no SU meal plan from "Continental": each is a choice
   the booking sites will show a guest, and it is the owner's. An empty
   field stays empty and the server names it.

   Saving sends nothing. Sending is its own press, and nothing reaches
   SU's live account for a hotel that is not switched on.
   ══════════════════════════════════════════════════════════════════ */

export function SuSetup({ code }: { code: string }) {
  const content = useQuery({ queryKey: ["su-content", code], queryFn: () => getSuContent(code) });

  if (content.isLoading) return <Skeleton className="h-64" />;
  if (content.isError || !content.data) {
    return <ReadFailed error={content.error} what="the SU setup" onRetry={() => void content.refetch()} />;
  }
  return (
    <div className="space-y-4">
      <SuLogin />
      <HotelOnSu code={code} data={content.data} />
      <RoomTypesOnSu code={code} data={content.data} />
      <MealPlansOnSu code={code} data={content.data} />
      <SendToSu code={code} data={content.data} />
      <RoomsAndPrices code={code} data={content.data} />
      <ChannelBookings code={code} />
    </div>
  );
}

/* ── 1. The login ─────────────────────────────────────────────────── */

function SuLogin() {
  const status = useQuery({ queryKey: ["su-status"], queryFn: getSuStatus });
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const r = await checkSuLogin();
      if (r.ok) toast.success("SU accepted the login.");
      else toast.error("SU login did not work", r.reason);
    } finally {
      setChecking(false);
      void status.refetch();
    }
  };

  const s = status.data;
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-md font-semibold text-ink-900">SU login</h2>
          {s?.configured
            ? <StatusPill tone="neutral">{s.environment === "live" ? "Live account" : "Test account"}</StatusPill>
            : s ? <StatusPill tone="warning">Not set up</StatusPill> : null}
        </div>
        {status.isError && <ReadFailed compact error={status.error} what="the SU login" onRetry={() => void status.refetch()} />}
        {s && !s.configured && <p className="text-base text-grey-600">{s.reason}</p>}
        {s?.lastLogin && (
          <p className="text-sm text-grey-600">
            Last checked {dateTime(s.lastLogin.at)}:{" "}
            {s.lastLogin.ok ? "SU accepted the login." : s.lastLogin.reason}
          </p>
        )}
        {s?.configured && (
          <p className="text-sm text-grey-500">
            Logins used this hour: {s.loginsThisHour ?? "-"} of {s.loginsPerHour}.
          </p>
        )}
        <div>
          <Button variant="secondary" onClick={check} disabled={!s?.configured || checking}>
            {checking ? "Checking" : "Check the login"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── 2. This hotel on SU ──────────────────────────────────────────── */

function HotelOnSu({ code, data }: { code: string; data: SuContent }) {
  const qc = useQueryClient();
  const initial = () => ({
    suHotelId: data.channel?.suHotelId ?? "",
    postalCode: data.channel?.postalCode ?? "",
    countryCode: data.channel?.countryCode ?? "",
    latitude: data.channel?.latitude ?? "",
    longitude: data.channel?.longitude ?? "",
    contactFirstName: data.channel?.contactFirstName ?? "",
    contactLastName: data.channel?.contactLastName ?? "",
    description: data.channel?.description ?? "",
  });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(initial()); }, [data.channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof typeof form) =>
    (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveSuHotel(code, form);
      if (r.ok) toast.success("Saved. Nothing has been sent to SU.");
      else toast.error("Not saved", r.reason);
      await qc.invalidateQueries({ queryKey: ["su-content", code] });
    } finally { setSaving(false); }
  };

  const shown = (value: string | null) => value && value.trim() ? value : "-";

  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="text-md font-semibold text-ink-900">This hotel on SU</h2>
          <p className="text-sm text-grey-500">
            From the hotel record, set on the Properties screen: {shown(data.hotel.addressLine)},{" "}
            {data.hotel.city} · phone {shown(data.hotel.phone)} · email {shown(data.hotel.email)}.
          </p>
        </div>
        <div className="grid gap-3 @2xl:grid-cols-2">
          <Field label="SU hotel id" hint="Up to 20 letters, digits and hyphens. It cannot change once SU has it." required>
            {(p) => <Input {...fieldProps(p)} value={form.suHotelId} onChange={set("suHotelId")} maxLength={20} />}
          </Field>
          <Field label="Postcode">
            {(p) => <Input {...fieldProps(p)} value={form.postalCode} onChange={set("postalCode")} maxLength={10} />}
          </Field>
          <Field label="Country" hint="Its two-letter code.">
            {(p) => <Input {...fieldProps(p)} value={form.countryCode} onChange={set("countryCode")} maxLength={2} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={form.latitude} onChange={set("latitude")} />}
            </Field>
            <Field label="Longitude">
              {(p) => <Input {...fieldProps(p)} inputMode="decimal" value={form.longitude} onChange={set("longitude")} />}
            </Field>
          </div>
          <Field label="Contact's first name">
            {(p) => <Input {...fieldProps(p)} value={form.contactFirstName} onChange={set("contactFirstName")} />}
          </Field>
          <Field label="Contact's last name">
            {(p) => <Input {...fieldProps(p)} value={form.contactLastName} onChange={set("contactLastName")} />}
          </Field>
        </div>
        <Field label="Description" hint="What SU shows about the hotel, up to 2,000 characters.">
          {(p) => <Textarea {...fieldProps(p)} rows={3} value={form.description} onChange={set("description")} maxLength={2000} />}
        </Field>
        <div>
          <Button variant="secondary" onClick={save} disabled={saving || !form.suHotelId.trim()}>
            {saving ? "Saving" : "Save hotel details"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── 3. Room types and meal plans ─────────────────────────────────── */

function LastSend({ record }: { record: { sentAt: string | null; sentOk: boolean | null; sentResult: string | null } | null }) {
  if (!record?.sentAt) return <span className="text-sm text-grey-500">Not sent yet</span>;
  return (
    <span className={record.sentOk ? "text-sm text-grey-600" : "text-sm text-brand-red"}>
      {dateTime(record.sentAt)}: {record.sentResult}
    </span>
  );
}

function RoomTypesOnSu({ code, data }: { code: string; data: SuContent }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="text-md font-semibold text-ink-900">Room types</h2>
          <p className="text-sm text-grey-500">
            Each one goes to SU under the id you give it, with its rack rate and its rooms.
            A room type with no rack rate cannot be listed.
          </p>
        </div>
        <ul className="divide-y divide-grey-100">
          {data.roomTypes.map((t) => (
            <RoomTypeRow key={t.id} code={code} type={t} suRoomTypes={data.suRoomTypes} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function RoomTypeRow({ code, type, suRoomTypes }: {
  code: string; type: ContentRoomType; suRoomTypes: SuContent["suRoomTypes"];
}) {
  const qc = useQueryClient();
  const m = type.mapping;
  const [suRoomId, setSuRoomId] = useState(m?.suRoomId ?? "");
  const [suRoomType, setSuRoomType] = useState(m ? String(m.suRoomType) : "");
  const [maxChildren, setMaxChildren] = useState(m ? String(m.maxChildren) : "");
  const [isConnected, setIsConnected] = useState(m?.isConnected ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveSuRoomType(code, type.id, {
        suRoomId, suRoomType: Number(suRoomType), maxChildren: Number(maxChildren), isConnected,
      });
      if (r.ok) toast.success(`${type.name} saved. Nothing has been sent to SU.`);
      else toast.error(`${type.name} not saved`, r.reason);
      await qc.invalidateQueries({ queryKey: ["su-content", code] });
    } finally { setSaving(false); }
  };

  const ready = suRoomId.trim() !== "" && suRoomType !== "" && maxChildren.trim() !== "";
  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-base font-medium text-ink-900">{type.name}</span>
        <span className="text-sm text-grey-500">
          sleeps {type.maxOccupancy} · {type.rooms} rooms · rack rate{" "}
          {type.rackRate === null ? "-" : money(Number(type.rackRate))}
        </span>
        {m?.onSu && <StatusPill tone="neutral">{m.onSu === "active" ? "On SU" : "Taken off SU"}</StatusPill>}
      </div>
      <div className="grid gap-3 @2xl:grid-cols-4 items-end">
        <Field label="SU room id">
          {(p) => <Input {...fieldProps(p)} value={suRoomId} onChange={(e) => setSuRoomId(e.target.value)} maxLength={20} />}
        </Field>
        <Field label="SU room type">
          {(p) => (
            <NativeSelect {...fieldProps(p)} value={suRoomType} onChange={(e) => setSuRoomType(e.target.value)}>
              <option value="">Pick one</option>
              {suRoomTypes.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Children, at most" hint={`Fewer than ${type.maxOccupancy}.`}>
          {(p) => <Input {...fieldProps(p)} inputMode="numeric" value={maxChildren} onChange={(e) => setMaxChildren(e.target.value)} />}
        </Field>
        <Checkbox checked={isConnected} onCheckedChange={setIsConnected} label="Send to SU" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={save} disabled={saving || !ready}>
          {saving ? "Saving" : `Save ${type.name}`}
        </Button>
        <LastSend record={m} />
      </div>
    </li>
  );
}

function MealPlansOnSu({ code, data }: { code: string; data: SuContent }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="text-md font-semibold text-ink-900">Meal plans</h2>
          <p className="text-sm text-grey-500">
            Each meal plan sold online is a rate plan on SU. Pick what SU should call it:
            it is what the booking sites show a guest.
          </p>
        </div>
        <ul className="divide-y divide-grey-100">
          {data.mealPlans.map((p) => (
            <MealPlanRow key={p.code} code={code} plan={p} suMealPlans={data.suMealPlans} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function MealPlanRow({ code, plan, suMealPlans }: {
  code: string; plan: ContentMealPlan; suMealPlans: SuContent["suMealPlans"];
}) {
  const qc = useQueryClient();
  const m = plan.mapping;
  const [suRatePlanId, setSuRatePlanId] = useState(m?.suRatePlanId ?? "");
  const [suMealPlan, setSuMealPlan] = useState(m ? String(m.suMealPlan) : "");
  const [isConnected, setIsConnected] = useState(m?.isConnected ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveSuRatePlan(code, plan.code, { suRatePlanId, suMealPlan: Number(suMealPlan), isConnected });
      if (r.ok) toast.success(`${plan.name} saved. Nothing has been sent to SU.`);
      else toast.error(`${plan.name} not saved`, r.reason);
      await qc.invalidateQueries({ queryKey: ["su-content", code] });
    } finally { setSaving(false); }
  };

  const ready = suRatePlanId.trim() !== "" && suMealPlan !== "";
  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-base font-medium text-ink-900">{plan.name}</span>
        <span className="text-sm text-grey-500">{plan.includes}</span>
        {m?.onSu && <StatusPill tone="neutral">{m.onSu === "active" ? "On SU" : "Taken off SU"}</StatusPill>}
      </div>
      <div className="grid gap-3 @2xl:grid-cols-3 items-end">
        <Field label="SU rate plan id">
          {(p) => <Input {...fieldProps(p)} value={suRatePlanId} onChange={(e) => setSuRatePlanId(e.target.value)} maxLength={20} />}
        </Field>
        <Field label="SU meal plan">
          {(p) => (
            <NativeSelect {...fieldProps(p)} value={suMealPlan} onChange={(e) => setSuMealPlan(e.target.value)}>
              <option value="">Pick one</option>
              {suMealPlans.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Checkbox checked={isConnected} onCheckedChange={setIsConnected} label="Send to SU" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={save} disabled={saving || !ready}>
          {saving ? "Saving" : `Save ${plan.name}`}
        </Button>
        <LastSend record={m} />
      </div>
    </li>
  );
}

/* ── 6. Bookings SU has pushed ────────────────────────────────────── */

const OUTCOME: Record<ChannelBooking["outcome"], { words: string; tone: "neutral" | "warning" | "danger" | "success" }> = {
  received: { words: "Just arrived", tone: "neutral" },
  created: { words: "Booked", tone: "success" },
  changed: { words: "Changed", tone: "success" },
  cancelled: { words: "Cancelled", tone: "neutral" },
  refused_no_room: { words: "Refused: no room free", tone: "danger" },
  needs_attention: { words: "Needs somebody", tone: "warning" },
  ignored: { words: "Nothing to do", tone: "neutral" },
};

function ChannelBookings({ code }: { code: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["channel-bookings", code], queryFn: () => getChannelBookings(code) });
  const [marking, setMarking] = useState<string | null>(null);

  const done = async (id: string) => {
    setMarking(id);
    try {
      const r = await markChannelBookingDone(code, id);
      if (!r.ok) toast.error("Not marked", r.reason);
      await qc.invalidateQueries({ queryKey: ["channel-bookings", code] });
    } finally { setMarking(null); }
  };

  const bookings = list.data?.bookings ?? [];
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="text-md font-semibold text-ink-900">Bookings from the booking sites</h2>
          <p className="text-sm text-grey-500">
            Every booking SU has sent, as it arrived. A booking for a room that was no longer
            free is refused and the site is told there is nothing left; somebody then settles
            it with the site and the guest. Card details are never kept.
          </p>
        </div>
        {list.isError && (
          <ReadFailed compact error={list.error} what="the bookings from SU"
                      onRetry={() => void list.refetch()} />
        )}
        {list.data && bookings.length === 0 && (
          <p className="text-base text-grey-600">SU has not sent a booking yet.</p>
        )}
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li key={b.id} className="rounded-md border border-grey-200 p-3 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-base font-medium text-ink-900">{b.guestName ?? "-"}</span>
                <span className="text-sm text-grey-500">
                  {b.channel ?? "-"} · {b.arrival ?? "-"} to {b.departure ?? "-"} ·{" "}
                  {b.rooms} room{b.rooms === 1 ? "" : "s"} ·{" "}
                  {b.total === null ? "-" : money(Number(b.total))}
                </span>
                <StatusPill tone={OUTCOME[b.outcome].tone}>{OUTCOME[b.outcome].words}</StatusPill>
                {b.handled && <StatusPill tone="neutral">Dealt with</StatusPill>}
              </div>
              {b.reason && <p className="text-sm text-grey-600">{b.reason}</p>}
              <p className="text-sm text-grey-500">
                {dateTime(b.receivedAt)} · SU reference {b.suBookingId}
                {b.acknowledged ? " · SU told we have it" : " · SU not yet told"}
                {b.cardFieldsRemoved > 0 && " · card details were not kept"}
              </p>
              {!b.handled && b.outcome !== "created" && (
                <Button variant="secondary" size="sm" onClick={() => done(b.id)}
                        disabled={marking === b.id}>
                  {marking === b.id ? "Marking" : "I have dealt with this"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/* ── 5. Rooms left, prices and closures ───────────────────────────── */

function RoomsAndPrices({ code, data }: { code: string; data: SuContent }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["su-availability", code], queryFn: () => getSuAvailability(code) });
  const [sending, setSending] = useState<"all" | "changes" | null>(null);

  const anyRoomOnSu = data.roomTypes.some((t) => t.mapping?.onSu === "active");
  const blocked = !data.su.configured || !data.channel?.onSu || !anyRoomOnSu
    || (data.su.environment === "live" && !data.switchedOn);

  const send = async (kind: "all" | "changes") => {
    setSending(kind);
    try {
      const r = await sendSuAvailability(code, kind);
      if (r.ok) toast.success(r.reason);
      else toast.error("Not everything reached SU", r.reason);
      await qc.invalidateQueries({ queryKey: ["su-availability", code] });
    } finally { setSending(null); }
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="text-md font-semibold text-ink-900">Rooms left, prices and closures</h2>
          <p className="text-sm text-grey-500">
            A year at a time. Send a year when a hotel first goes on SU; after that only what
            changed is sent, on its own every minute once the hotel is switched on. Where a meal
            plan has no price of its own, the room type's rack rate goes, so the room keeps
            selling; where there is no price at all, the date goes to SU closed, so no booking
            site sells it at an old price.
          </p>
        </div>
        {blocked && (
          <p className="text-base text-grey-600">
            Send the hotel, its room types and its meal plans to SU first.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send("all")} disabled={blocked || sending !== null}>
            {sending === "all" ? "Sending a year" : "Send a year"}
          </Button>
          <Button variant="secondary" onClick={() => send("changes")} disabled={blocked || sending !== null}>
            {sending === "changes" ? "Sending changes" : "Send what changed"}
          </Button>
        </div>
        {state.isError && (
          <ReadFailed compact error={state.error} what="what was sent to SU"
                      onRetry={() => void state.refetch()} />
        )}
        {/* D17-92. A night SU is holding at the room type's own rate sells at a
            figure nobody typed for that meal plan, so it is said in words, with
            the first such night, rather than left in a count nobody reads. */}
        {state.data && state.data.atRackRate.nights > 0 && (
          <p className="text-base text-ink-900">
            {state.data.atRackRate.nights} night
            {state.data.atRackRate.nights === 1 ? " is" : "s are"} selling at the rack rate
            {state.data.atRackRate.firstDate
              ? `, from ${dateShort(state.data.atRackRate.firstDate)}` : ""}
            {" "}— no price set for that meal plan.
          </p>
        )}
        {state.data && state.data.pushes.length > 0 && (
          <ul className="space-y-1">
            {state.data.pushes.map((p) => (
              <li key={p.at} className={p.ok ? "text-sm text-grey-600" : "text-sm text-brand-red"}>
                {dateTime(p.at)} · {p.kind === "all" ? "a year" : "what changed"} · {p.dates} dates
                {" "}in {p.requests} request{p.requests === 1 ? "" : "s"} · {p.result}
                {p.unpricedDates > 0 && ` · ${p.unpricedDates} closed for want of a price`}
                {p.rackDates > 0 && ` · ${p.rackDates} at the rack rate, no price set for the plan`}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 4. Send ──────────────────────────────────────────────────────── */

function SendToSu({ code, data }: { code: string; data: SuContent }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);

  const liveButOff = data.su.environment === "live" && !data.switchedOn;
  const blocked = !data.su.configured || liveButOff || data.problems.length > 0;

  const send = async () => {
    setSending(true);
    setResults(null);
    setProblems(null);
    try {
      const r = await sendSuContent(code);
      if (r.ok) {
        setResults(r.results);
        toast.success("SU accepted everything that was sent.");
      } else {
        const failed = r as { reason: string; problems?: string[]; results?: SendResult[] };
        if (failed.results) setResults(failed.results);
        if (failed.problems) setProblems(failed.problems);
        toast.error("Not everything went to SU", failed.reason);
      }
      await qc.invalidateQueries({ queryKey: ["su-content", code] });
    } finally { setSending(false); }
  };

  const listed = problems ?? data.problems;
  return (
    <Card>
      <CardBody className="space-y-3">
        <h2 className="text-md font-semibold text-ink-900">Send to SU</h2>
        {!data.su.configured && (
          <p className="text-base text-grey-600">SU is not set up on this server yet, so nothing can be sent.</p>
        )}
        {liveButOff && (
          <p className="text-base text-grey-600">
            This server uses SU's live account, and this hotel is not switched on for the
            channel manager. Nothing is sent to the live account for it.
          </p>
        )}
        {listed.length > 0 ? (
          <div className="space-y-1">
            <p className="text-base text-ink-900">SU needs these first:</p>
            <ul className="space-y-1">
              {listed.map((p) => (
                <li key={p} className="flex gap-2 text-sm text-grey-700">
                  <AlertTriangle className="size-4 shrink-0 text-brand-tangerine-700 mt-0.5" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          data.su.configured && !liveButOff && (
            <p className="text-base text-grey-600">
              Ready. Sending gives SU this hotel, its room types marked "Send to SU" and its
              meal plans marked "Send to SU". It sends no prices by date and no rooms left.
            </p>
          )
        )}
        <div>
          <Button variant="primary" onClick={send} disabled={blocked || sending}>
            <Send className="size-4" />
            {sending ? "Sending" : "Send to SU"}
          </Button>
        </div>
        {results && (
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.name}-${i}`} className="flex gap-2 text-sm">
                {r.ok
                  ? <CheckCircle2 className="size-4 shrink-0 text-grey-500 mt-0.5" />
                  : <AlertTriangle className="size-4 shrink-0 text-brand-red mt-0.5" />}
                <span className={r.ok ? "text-grey-700" : "text-brand-red"}>
                  {r.name} ({r.kind}), {r.action}: {r.ok ? "SU accepted it." : r.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
