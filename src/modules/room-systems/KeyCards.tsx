import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, NativeSelect, toast } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";
import { cutCards, getKeys, keysKey, type KeyAct } from "@/modules/room-systems/data/keys";

/* ══════════════════════════════════════════════════════════════════
   KEY CARDS ON A STAY (D27-178)

   In the stay's drawer for a guest in the house: the cards that open the
   door now, cutting them, a lost card, and every act with the lock
   system's own answer. Nothing at all where no lock system is connected
   and none was ever cut: the desk's screen is unchanged until one is.

   Cancelling is not a button: front desk's check-out, move and exchange
   do it, and a lock that refused shows here as "not done".
   ══════════════════════════════════════════════════════════════════ */

const cardsWord = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

function what(a: KeyAct): string {
  if (a.act === "cancel") {
    return a.why === "check_out" ? "Cancelled at check-out"
      : a.why === "move" ? "Cancelled - the guest changed rooms"
      : "Cancelled - a card was lost";
  }
  const n = cardsWord(a.cards ?? 0);
  return a.why === "reissue" ? `${n} cut, replacing the earlier ones`
    : a.why === "lost" ? `${n} cut for a lost card`
    : `${n} cut`;
}

export function KeyCards({ hotelId, stay }: { hotelId: string; stay: Stay }) {
  const qc = useQueryClient();
  /* Whoever may check a guest in (the recommendation to the owner, Q3). */
  const mayCut = can(useRole(), "edit", "reservation");
  const keys = useQuery({
    queryKey: keysKey(hotelId, stay.id),
    queryFn: () => getKeys(hotelId, stay.id),
  });
  const [cards, setCards] = useState<number | null>(null);
  const [losing, setLosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const k = keys.data;
  if (keys.isError) {
    return <p className="text-sm text-danger">The key cards could not be read. Try again in a moment.</p>;
  }
  if (!k || (!k.connected && k.acts.length === 0)) return null;

  /* Starts at one per adult (Q4's recommendation), never above the cap. */
  const count = cards ?? Math.min(Math.max(stay.adults, 1), k.maxCards);
  const endsEarly = k.live !== null && new Date(k.live.validUntil) < new Date(k.stayEnds);

  const cut = async (lost: boolean) => {
    setBusy(true);
    const done = await cutCards(hotelId, stay.id, { cards: count, lost });
    setBusy(false);
    setLosing(false);
    void qc.invalidateQueries({ queryKey: keysKey(hotelId, stay.id) });
    if (!done.ok) return toast.error("No cards cut", done.reason);
    toast.success("Cards cut", done.answer);
  };

  return (
    <section className="space-y-3 border-t border-grey-200 pt-4">
      <h3 className="text-sm font-semibold text-ink-900">Key cards</h3>

      {k.live
        ? <p className="text-sm text-ink-900">
            {cardsWord(k.live.cards)} for room {k.live.room}, until {dateTime(k.live.validUntil)}
          </p>
        : <p className="text-sm text-grey-600">No cards open a door for this stay.</p>}
      {endsEarly && (
        <p className="text-sm text-warning-dark">
          They stop before the stay ends ({dateTime(k.stayEnds)}). Cut new cards.
        </p>
      )}
      {!k.connected && (
        <p className="text-sm text-grey-600">No lock system is connected at this property.</p>
      )}

      {mayCut && k.connected && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="How many cards" value={count}
            onChange={(e) => setCards(Number(e.target.value))} className="w-28">
            {Array.from({ length: k.maxCards }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{cardsWord(n)}</option>
            ))}
          </NativeSelect>
          <Button variant="secondary" loading={busy && !losing} onClick={() => void cut(false)}>
            {k.live ? "Cut new cards" : "Cut cards"}
          </Button>
          {k.live && (
            <Button variant="secondary" onClick={() => setLosing(true)}>Lost card</Button>
          )}
        </div>
      )}

      {k.acts.length > 0 && (
        <ul className="space-y-2">
          {k.acts.map((a, i) => (
            <li key={i} className="text-sm">
              <span className={a.outcome === "failed" ? "text-danger" : "text-ink-900"}>
                {a.outcome === "failed" ? "Not done: " : ""}{what(a)}
              </span>
              <span className="text-grey-600"> · room {a.room} · {a.by ?? "-"} · {dateTime(a.at)}</span>
              {a.outcome === "failed" && a.answer && (
                <span className="block text-grey-600">The lock system said: {a.answer}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={losing} onOpenChange={setLosing}>
        <DialogContent
          title="Lost card"
          description={`Room ${k.live?.room ?? "-"}: the cards cut before are cancelled and ${cardsWord(count)} cut.`}
          size="sm"
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" onClick={() => setLosing(false)}>Keep them</Button>
              <Button variant="danger" loading={busy} onClick={() => void cut(true)}>
                Cancel and cut
              </Button>
            </div>
          }
        >
          <p className="text-sm text-grey-600 leading-relaxed">
            Check the guest's ID before cutting a card. On a lock that is not
            online, the lost card still opens the door until the new card is
            first used there.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
