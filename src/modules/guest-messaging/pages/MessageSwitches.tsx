import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Input, Page, PageHeader, ReadFailed, Switch, toast } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { getMessageSwitches, setMessageSwitch, type MessageSwitch } from "../data/settings";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES → GUEST MESSAGES ON/OFF (D27-261, Q1 and Q2)

   One row per message the guest gets by itself: its switch, when it goes,
   and - for the reminder - its days and start time. The check-in code and
   the desk's check-in link have no switch: the first is how a guest gets
   in, the second a button a clerk presses. A switch changes only this
   hotel. Nothing here sends anything; sending itself still needs the
   server's connection settings.
   ══════════════════════════════════════════════════════════════════ */

export default function MessageSwitches() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["message-switches", hotel], queryFn: () => getMessageSwitches(hotel), enabled: !!hotel });
  const save = useMutation({
    mutationFn: ({ kind, ...body }: { kind: string; isOn: boolean; daysBefore?: number; sendFrom?: string }) =>
      setMessageSwitch(hotel, kind, body),
    onSuccess: () => { toast.success("Saved"); void qc.invalidateQueries({ queryKey: ["message-switches", hotel] }); },
    onError: (e) => toast.error("Not saved", e instanceof Error ? e.message : undefined),
  });

  return (
    <Page>
      <PageHeader title="Guest messages on/off"
        description="Which messages this hotel's guests get by themselves, and when. The wording stays in the sending workflow." />
      {q.isError && <ReadFailed error={q.error} what="the guest messages' switches" onRetry={() => void q.refetch()} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-grey-100">
            {q.data.messages.map((m) => (
              <Row key={m.kind} m={m} busy={save.isPending}
                onSave={(v) => save.mutate({ kind: m.kind, ...v })} />
            ))}
          </ul>
          <p className="px-4 py-3 text-sm text-grey-600 border-t border-grey-100">
            A booking made before sending was first switched on is confirmed
            only from {q.data.catchUp.from} to {q.data.catchUp.until}, the hotel's time (fixed).
          </p>
        </Card>
      )}
    </Page>
  );
}

function Row({ m, busy, onSave }: {
  m: MessageSwitch; busy: boolean;
  onSave: (v: { isOn: boolean; daysBefore?: number; sendFrom?: string }) => void;
}) {
  const [days, setDays] = useState(String(m.daysBefore ?? 1));
  const [from, setFrom] = useState(m.sendFrom ?? "10:00");
  const reminder = m.kind === "arrival-reminder";
  const daysOk = /^[1-7]$/.test(days);
  return (
    <li className="px-4 py-3.5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">{m.label}</p>
          <p className="text-sm text-grey-600 mt-0.5">{m.when}</p>
          {m.kind === "invoice" && m.isOn && m.switchedOnAt && (
            <p className="text-sm text-grey-600 mt-0.5">On since {new Date(m.switchedOnAt).toLocaleString("en-IN")}.</p>
          )}
          {m.changedBy && <p className="text-xs text-grey-500 mt-0.5">Last changed by {m.changedBy}</p>}
        </div>
        <Switch checked={m.isOn} disabled={busy} label={<span className="sr-only">{m.label}</span>}
          onCheckedChange={(isOn) => onSave({ isOn })} />
      </div>
      {reminder && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-grey-700">
            Days before arrival (1 to 7)
            <Input className="mt-1 w-24" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="text-sm text-grey-700">
            From (hotel's time)
            <Input className="mt-1 w-28" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <Button variant="secondary" disabled={busy || !daysOk || !from}
            onClick={() => onSave({ isOn: m.isOn, daysBefore: Number(days), sendFrom: from })}>
            Save timing
          </Button>
          <p className="basis-full text-sm text-grey-600">
            For example 1 and 10:00: a guest arriving on the 5th gets it on the 4th, from 10 in the morning.
          </p>
        </div>
      )}
    </li>
  );
}
