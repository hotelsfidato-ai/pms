import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Page, PageHeader, ReadFailed, Switch, toast } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { getMessageSwitches, setMessageSwitch, type MessageSwitch } from "../data/settings";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES → GUEST MESSAGES ON/OFF (D27-261, D27-264)

   One row per message the guest gets by itself: its switch and when it
   goes - the voucher (the confirmation, both ways), the tax invoice, the
   review request. No reminder (D27-264). The check-in code and the desk's
   "Send check-in link" (which resends the voucher) have no switch: the first
   is how a guest gets in, the second a button a clerk presses. A switch
   changes only this hotel. Nothing here sends anything; sending itself still needs the
   server's connection settings.
   ══════════════════════════════════════════════════════════════════ */

export default function MessageSwitches() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["message-switches", hotel], queryFn: () => getMessageSwitches(hotel), enabled: !!hotel });
  const save = useMutation({
    mutationFn: ({ kind, ...body }: { kind: string; isOn: boolean }) =>
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
                onSave={(isOn) => save.mutate({ kind: m.kind, isOn })} />
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

function Row({ m, busy, onSave }: { m: MessageSwitch; busy: boolean; onSave: (isOn: boolean) => void }) {
  return (
    <li className="px-4 py-3.5">
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
          onCheckedChange={onSave} />
      </div>
    </li>
  );
}
