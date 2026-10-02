import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateShort } from "@/lib/format";
import { Button, Card, CardBody, Field, Input, NativeSelect, fieldProps } from "@/components/ui";
import { askWakeUp, getWakeUps } from "@/modules/online-checkin/data/guestWays";
import { H2, SECTION, messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";
import { cn } from "@/lib/cn";

/* ══════════════════════════════════════════════════════════════════
   A WAKE-UP CALL, ASKED FOR FROM THE GUEST'S PAGE (D27-241)

   A section behind the code (online-checkin rule 8): its own door route
   (api/src/routes/guestWakeUp.ts), this tab's unlock on every call. The
   guest picks a morning of the stay and a time on the hotel's clock; it
   waits for the desk to confirm. Placed with ONE line in `Behind`
   (pages/GuestPage.tsx) - the master adds it at merge:
   <WakeUpSection token={token} checkIn={…} checkOut={…} onUnlockGone={onUnlockGone} />
   ══════════════════════════════════════════════════════════════════ */

const STATUS: Record<string, string> = {
  asked: "Waiting for the desk", set: "Set", done: "Done", cancelled: "Cancelled",
};

/** Every day from the arrival to the departure, as YYYY-MM-DD. */
function daysOf(checkIn: string, checkOut: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${checkIn}T00:00:00Z`); d <= new Date(`${checkOut}T00:00:00Z`) && days.length < 31;
       d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function WakeUpSection({ token, checkIn, checkOut, onUnlockGone }: {
  token: string; checkIn: string; checkOut: string; onUnlockGone: () => void;
}) {
  const qc = useQueryClient();
  const days = daysOf(checkIn, checkOut);
  const [day, setDay] = useState(days[1] ?? days[0] ?? "");
  const [time, setTime] = useState("");
  const key = ["guest-behind", token, "wake-up"];
  const list = useQuery({
    queryKey: key,
    queryFn: () => getWakeUps(token),
    retry: false,
  });
  const ask = useMutation({
    mutationFn: () => askWakeUp(token, day, time),
    onSuccess: async () => { setTime(""); await qc.invalidateQueries({ queryKey: key }); },
  });
  useUnlockGone(list.error ?? ask.error, onUnlockGone);

  return (
    <section className={SECTION}>
      <h2 className={cn(H2, "mb-3")}>A wake-up call</h2>
      <Card><CardBody>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Which morning">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={day} onChange={(e) => setDay(e.target.value)}>
                  {days.map((d) => <option key={d} value={d}>{dateShort(d)}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="What time">
              {(f) => <Input {...fieldProps(f)} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={ask.isPending || !day || !time}>
            {ask.isPending ? "Sending…" : "Ask for a wake-up call"}
          </Button>
          {ask.error && !unlockGone(ask.error) && (
            <p className="text-sm text-brand-red-700">{messageFrom(ask.error)}</p>
          )}
        </form>
        {(list.data?.calls.length ?? 0) > 0 && (
          <ul className="mt-3.5 border-t border-grey-100 divide-y divide-grey-100 -mb-3.5">
            {list.data!.calls.map((w) => (
              <li key={w.callAt + w.status} className="py-3 text-sm">
                <span className="text-ink-900 tabular-nums">{dateShort(w.callAt.slice(0, 10))}, {w.callAt.slice(11, 16)}</span>
                <span className="text-grey-600"> · {STATUS[w.status] ?? w.status}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </section>
  );
}
