import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { Button, Card, CardBody, Field, fieldProps, Input, NativeSelect, StatusPill } from "@/components/ui";
import { at, withUnlock } from "@/modules/online-checkin/data/guestPage";
import { H2, LEAD, SECTION, messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   A TABLE AT THE RESTAURANT (the owner's D27-221, D27-224)

   Any night of the stay, the slots the restaurant offers, how many of
   you, a note if you like. Somebody at the restaurant confirms it or
   says why not; the guest sees the time and the party, never the table.
   Cancel while nobody has answered. The section hides itself when there
   is nothing to offer and nothing booked (rule 8).
   ══════════════════════════════════════════════════════════════════ */

interface Offer { outlet: string; name: string; night: string; slots: string[] }
interface Booking {
  id: string; restaurant: string; night: string; time: string; party: number;
  note: string | null; status: "requested" | "confirmed" | "declined" | "cancelled"; answer: string | null;
}

const getTables = (token: string) =>
  api<{ offer: Offer[]; bookings: Booking[] }>(at(token, "/tables"), withUnlock(token));
const askTable = (token: string, b: { outlet: string; night: string; time: string; party: number; note: string }) =>
  api<{ sent: true }>(at(token, "/tables"), withUnlock(token, { method: "POST", body: JSON.stringify(b) }));
const cancelTable = (token: string, id: string) =>
  api<{ cancelled: true }>(at(token, `/tables/${id}/cancel`), withUnlock(token, { method: "POST" }));

/** "20:00" as a guest reads it: "8:00 pm". */
export const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const nightOf = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const STATUS: Record<Booking["status"], { words: string; tone: "neutral" | "success" | "danger" }> = {
  requested: { words: "Waiting for the restaurant", tone: "neutral" },
  confirmed: { words: "Confirmed", tone: "success" },
  declined: { words: "Not possible", tone: "danger" },
  cancelled: { words: "Cancelled", tone: "neutral" },
};

export function TableBookingSection({ token, onUnlockGone }: { token: string; onUnlockGone: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["guest-behind", token, "tables"], queryFn: () => getTables(token), retry: false });
  const offer = q.data?.offer ?? [];
  const restaurants = [...new Map(offer.map((o) => [o.outlet, o.name])).entries()];
  const [outlet, setOutlet] = useState("");
  const [night, setNight] = useState("");
  const [time, setTime] = useState("");
  const [party, setParty] = useState("2");
  const [note, setNote] = useState("");

  const here = outlet || restaurants[0]?.[0] || "";
  const nights = offer.filter((o) => o.outlet === here);
  const thisNight = nights.find((o) => o.night === night) ?? nights[0];
  const slots = thisNight?.slots ?? [];
  const chosenTime = slots.includes(time) ? time : "";

  const refresh = () => qc.invalidateQueries({ queryKey: ["guest-behind", token, "tables"] });
  const ask = useMutation({
    mutationFn: () => askTable(token, { outlet: here, night: thisNight!.night, time: chosenTime, party: Number(party), note }),
    onSuccess: async () => { setTime(""); setNote(""); await refresh(); },
  });
  const cancel = useMutation({ mutationFn: (id: string) => cancelTable(token, id), onSuccess: refresh });
  useUnlockGone(q.error ?? ask.error ?? cancel.error, onUnlockGone);

  const bookings = (q.data?.bookings ?? []).filter((b) => b.status !== "cancelled");
  if (!q.data || (offer.length === 0 && bookings.length === 0)) return null;

  return (
    <section className={SECTION}>
      <h2 className={H2}>A table at the restaurant</h2>
      <p className={cn(LEAD, "mb-3")}>Ask for a table for any night of your stay. The restaurant confirms it here.</p>
      <Card><CardBody>
        {offer.length > 0 && (
          <form onSubmit={(e) => { e.preventDefault(); if (chosenTime) ask.mutate(); }} className="flex flex-col gap-3">
            {restaurants.length > 1 && (
              <Field label="Restaurant">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={here} onChange={(e) => { setOutlet(e.target.value); setTime(""); }}>
                    {restaurants.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </NativeSelect>
                )}
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Night">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={thisNight?.night ?? ""} onChange={(e) => { setNight(e.target.value); setTime(""); }}>
                    {nights.map((n) => <option key={n.night} value={n.night}>{nightOf(n.night)}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="How many">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={party} onChange={(e) => setParty(e.target.value)}>
                    {Array.from({ length: 20 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </div>
            <div role="group" aria-label="Time" className="grid grid-cols-3 gap-2">
              {slots.map((s) => (
                <button key={s} type="button" onClick={() => setTime(s)} aria-pressed={chosenTime === s}
                  className={cn("min-h-11 rounded-lg text-sm font-medium ring-1 ring-inset",
                    chosenTime === s ? "bg-ink-900 ring-ink-900 text-white" : "bg-white ring-grey-200 text-ink-900")}>
                  {clock(s)}
                </button>
              ))}
            </div>
            <Field label="A note for the restaurant (optional)">
              {(f) => <Input {...fieldProps(f)} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <Button type="submit" variant="secondary" disabled={!chosenTime || ask.isPending}>
              {ask.isPending ? "Asking…" : chosenTime ? `Ask for ${clock(chosenTime)}` : "Pick a time"}
            </Button>
            {ask.error && !unlockGone(ask.error) && (
              <p className="text-sm text-brand-red-700">{messageFrom(ask.error)}</p>
            )}
          </form>
        )}

        {bookings.length > 0 && (
          <ul className={cn("divide-y divide-grey-100", offer.length > 0 && "mt-3.5 border-t border-grey-100 -mb-3.5")}>
            {bookings.map((b) => (
              <li key={b.id} className="py-3 text-sm">
                <p className="text-ink-900">
                  {nightOf(b.night)} · {clock(b.time)} · {b.party} {b.party === 1 ? "person" : "people"}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-grey-600">
                  {b.restaurant}
                  <StatusPill tone={STATUS[b.status].tone}>{STATUS[b.status].words}</StatusPill>
                </p>
                {b.status === "declined" && b.answer && <p className="mt-1 text-grey-700 break-words">{b.answer}</p>}
                {b.status === "requested" && (
                  <Button variant="ghost" className="mt-1 -ml-3" disabled={cancel.isPending}
                          onClick={() => cancel.mutate(b.id)}>Cancel this request</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </section>
  );
}
