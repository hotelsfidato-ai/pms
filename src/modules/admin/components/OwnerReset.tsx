import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { dateShort, number } from "@/lib/format";
import { TypedConfirm } from "@/modules/admin/components/TestHotelControls";
import {
  ownerReset, ownerResetCount, type OwnerResetCount, type OwnerResetDone,
} from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   CLEAR THIS HOTEL AND START TODAY (the owner's D27-342, D27-365 (3))

   On each real hotel's card on Properties, drawn only for the one account
   the server's settings name - and the server asks again on every call, so
   the drawing is not the guard. The button first asks the server what would
   go (the database's own dry run, the figures reset-property.ts prints);
   then the hotel's code is typed; then the server takes a backup, clears
   the hotel in one go and puts it on today, and this says what it did and
   the backup's name. A refusal - a guest still checked in, a backup that
   failed - is the server's own sentence, and nothing is cleared.
   ══════════════════════════════════════════════════════════════════ */

/* The tables a person would recognise, in plain words; the rest are summed. */
const NAMED: [table: string, one: string, many: string][] = [
  ["reservations", "booking", "bookings"],
  ["folios", "bill", "bills"],
  ["invoices", "invoice", "invoices"],
  ["payments", "payment", "payments"],
  ["pos_orders", "restaurant order", "restaurant orders"],
  ["banquet_events", "function", "functions"],
  ["night_audit_runs", "night audit", "night audits"],
  ["cashier_shifts", "cash shift", "cash shifts"],
  ["stock_movements", "stock movement", "stock movements"],
];
const count = (n: number, one: string, many: string) => `${number(n)} ${n === 1 ? one : many}`;

/* What Drive did with the guests' ID photos, after the clear (D27-379). */
const photos = ({ deleted, notDeleted }: OwnerResetDone["idPhotos"]) =>
  (deleted ? ` ${count(deleted, "ID photo", "ID photos")} deleted from Google Drive.` : "")
  + (notDeleted ? ` ${count(notDeleted, "ID photo", "ID photos")} could not be deleted from Google Drive `
    + "now: written down, and tried again every hour until Drive deletes them." : "");

function WhatGoes({ c }: { c: OwnerResetCount }) {
  const named = NAMED.filter(([t]) => c.tables[t]).map(([t, one, many]) => count(c.tables[t]!, one, many));
  if (c.guests) named.splice(1, 0, count(c.guests, "guest", "guests"));
  const others = Object.entries(c.tables)
    .filter(([t]) => !NAMED.some(([n]) => n === t))
    .reduce((sum, [, n]) => sum + n, 0);
  if (others) named.push(`${count(others, "other record", "other records")}`);
  return (
    <>
      <p>
        <span className="font-medium text-ink-900">Deleted:</span>{" "}
        {named.length ? `${named.join(", ")}.` : "nothing - there are no bookings, bills or orders."}
      </p>
      {c.idPhotos > 0 && (
        <p><span className="font-medium text-ink-900">Also deleted, for good:</span>{" "}
          {count(c.idPhotos, "ID photo", "ID photos")} of guests, from Google Drive. The backup keeps
          the records, not the photos.</p>
      )}
      <p><span className="font-medium text-ink-900">Kept:</span> the hotel, its rooms, rates,
        menu, tables, staff, sign-ins and settings. Invoice numbers carry on.</p>
      <p>A backup of the whole system is taken first. The business date becomes today
        (it is {dateShort(c.businessDate)} now).</p>
    </>
  );
}

export function OwnerReset({ hotel, onChanged }: {
  hotel: { code: string; name: string };
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState<OwnerResetCount | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const res = await ownerResetCount(hotel.code);
    setBusy(false);
    if (!res.ok) return setRefused(res.reason);
    if (res.refusal) return setRefused(res.refusal);
    setAsking(res);
  };

  return (
    <div data-owner-reset={hotel.code} className="mt-3 pt-3 border-t border-grey-100">
      <p className="flex items-center gap-1.5 text-xs font-medium text-grey-500">
        <RotateCcw className="size-3.5" aria-hidden />
        Start afresh
      </p>
      <p className="text-sm text-grey-600 mt-1.5 leading-relaxed">
        Deletes every booking, bill and order here, after a backup. The setup stays.
      </p>
      <Button variant="secondary" className="mt-2" loading={busy} onClick={() => void open()}>
        Clear this hotel and start today
      </Button>
      {refused && <p role="alert" className="text-sm text-brand-red-700 mt-1.5">{refused}</p>}

      {asking && (
        <TypedConfirm<OwnerResetDone>
          title={`Clear ${hotel.name} and start today`}
          word={hotel.code}
          action="Clear and start today"
          what={<WhatGoes c={asking} />}
          run={(confirm) => ownerReset(hotel.code, confirm)}
          done={(r) => `Removed ${count(r.removed, "record", "records")}. The backup is ${r.backup.file}, `
            + `${r.backup.copiedOff ? "copied off the server" : "on the server only"}. `
            + `The business date is now ${dateShort(r.businessDate)}.${photos(r.idPhotos)}`}
          onClose={() => setAsking(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
