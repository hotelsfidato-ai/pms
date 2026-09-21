import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/lib/session";
import { Checkbox, StatusPill, toast } from "@/components/ui";
import { stayedWords } from "@/modules/guests";
import { seesGuest360, guest360Path } from "@/modules/crm";
import { getGuestMarks, setWhatsappAgreed } from "@/modules/front-desk/data/stayExtras";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE CRM ADDS TO A STAY (docs/briefs/crm.md)

     "Stayed with the group 3 times"  a mark and a count, and nothing more
                                      at the desk: no hotels, no dates, no
                                      amounts (D21-13). Only when they have
                                      stayed before - a first visit carries
                                      no mark.
     Agreed to WhatsApp                the tick (D21-72). The desk may change
                                      it here at any time (the owner, 21
                                      September); the audit log keeps who.
     Guest 360                        for the owner, an administrator and the
                                      GM only (D21-4), the guest's whole
                                      history across the group.
   ══════════════════════════════════════════════════════════════════ */

export function GuestMarks({ hotelId, stay }: { hotelId: string; stay: Stay }) {
  const role = useRole();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const marks = useQuery({
    queryKey: ["guest-marks", hotelId, stay.id],
    queryFn: () => getGuestMarks(hotelId, stay.id),
  });
  const m = marks.data;

  const tick = async (agreed: boolean) => {
    setBusy(true);
    const done = await setWhatsappAgreed(hotelId, stay.id, agreed);
    setBusy(false);
    if (!done.ok) return toast.error("Not changed", done.reason);
    void qc.invalidateQueries({ queryKey: ["guest-marks", hotelId, stay.id] });
  };

  return (
    <>
      {m && m.stayedBefore > 0 && (
        <StatusPill tone="info">{stayedWords(m.stayedBefore)}</StatusPill>
      )}
      {m && (
        <Checkbox checked={m.whatsappAgreed} disabled={busy}
          onCheckedChange={(v) => void tick(v)} label="Agreed to WhatsApp" />
      )}
      {stay.guestId && seesGuest360(role) && (
        <Link to={guest360Path(stay.guestId)}
          className="min-h-8 px-1 text-sm font-medium text-grey-600 hover:text-ink-900
                     underline underline-offset-4 rounded-sm
                     focus-visible:outline-2 focus-visible:outline-brand-orange">
          Guest 360
        </Link>
      )}
    </>
  );
}
