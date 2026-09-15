import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wrench, RotateCcw } from "lucide-react";
import { dateLong } from "@/lib/format";
import {
  Button, Dialog, DialogContent, Field, Input, Textarea,
  NativeSelect, StatusPill, toast,
} from "@/components/ui";
import {
  blockRoom, unblockRoom, BLOCK_REASONS, BUSINESS_DATE,
  type RoomBlock,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   TAKING A ROOM OUT, AND PUTTING IT BACK

   A housekeeper finds a broken shower in 204. Until now there was
   nothing they could do about it in this system: room_blocks had been
   modelled since migration 022 and the tape chart drew from it, but no
   screen had ever written a row. Every block in the database came from
   the demo loader.

   WHY A DATE AND NOT A SWITCH

   "Out of order" is not a state a room is in, it is a period a room is
   out for. A switch cannot say the room is out from Thursday for the
   plumber, which is the ordinary case — and it cannot answer what was
   sellable last Tuesday, which is what occupancy divides by.

   The end date is OPTIONAL and empty by default. A room out for
   refurbishment has no known return date, and inventing one puts it
   back on sale on a day nobody chose.
   ══════════════════════════════════════════════════════════════════ */

export function OutOfOrderFlow({
  hotelId, roomNumber, blocks, occupied, trigger,
}: {
  hotelId: string;
  roomNumber: string;
  blocks: RoomBlock[];
  occupied?: boolean;
  trigger?: (open: () => void) => ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(BLOCK_REASONS[0].value);
  const [from, setFrom] = useState(BUSINESS_DATE);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await qc.invalidateQueries();
    setOpen(false);
  };

  const take = async () => {
    setBusy(true);
    const res = await blockRoom(hotelId, roomNumber, {
      reason, from, to: to || null, note: note.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Room not taken out", res.reason);
    toast.success(
      `Room ${roomNumber} is out`,
      to ? `Back on sale ${dateLong(to)}.` : "No return date set.",
    );
    setNote("");
    await done();
  };

  const put = async (block: RoomBlock) => {
    setBusy(true);
    const res = await unblockRoom(hotelId, roomNumber, block.id);
    setBusy(false);
    if (!res.ok) return toast.error("Room not put back", res.reason);
    /* Said out loud, because it is a surprise otherwise: the room comes
       back DIRTY, never clean. A fortnight of refurbishment needs
       looking at before somebody sleeps in it. */
    toast.success(`Room ${roomNumber} is back`, "It returns as dirty.");
    await done();
  };

  const label = (value: string | null) =>
    BLOCK_REASONS.find((r) => r.value === value)?.label.split(" — ")[0]
      ?? value ?? "Out";

  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Take room ${roomNumber} out of service`}
        >
          <Wrench className="size-4" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Room ${roomNumber}`}
          description="Out of service, and for how long."
        >
          <div className="space-y-4">
            {/* What is already on this room. Without it a supervisor
                cannot tell whether the plumber has been, and there was
                no way back at all from a block nobody could see. */}
            {blocks.length > 0 && (
              <div className="rounded-md border border-grey-200 bg-grey-50 p-3">
                <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">
                  Already out
                </p>
                <ul className="space-y-2">
                  {blocks.map((b) => (
                    <li key={b.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base text-ink-900">
                          {label(b.reason)}
                        </p>
                        <p className="text-sm text-grey-500 tabular">
                          {dateLong(b.from)}
                          {b.to ? ` – ${dateLong(b.to)}` : " – no end date"}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void put(b)}
                      >
                        <RotateCcw className="size-4" />
                        Put back
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {occupied ? (
              /* Refused here as well as at the server. The server is
                 what actually enforces it; this is so a clerk is not
                 made to fill in a form in order to be told no. */
              <div className="rounded-md border border-brand-red-100 bg-red-50 p-3">
                <p className="text-base text-ink-900">
                  Somebody is in this room.
                </p>
                <p className="text-sm text-grey-600 mt-0.5">
                  Move them out before taking it off sale.
                </p>
              </div>
            ) : (
              <>
                <Field label="Why is it coming out?" required>
                  {({ id }) => (
                    <NativeSelect
                      id={id}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    >
                      {BLOCK_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" required>
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Until" hint="Leave empty if unknown">
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        value={to}
                        min={from}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <Field label="Note" hint="What is actually wrong">
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Shower mixer leaking"
                    />
                  )}
                </Field>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <StatusPill tone="neutral">
                    {to ? `${dateLong(from)} – ${dateLong(to)}` : "No end date"}
                  </StatusPill>
                  <Button variant="primary"
                    onClick={() => void take()}
                    disabled={busy || !from || (!!to && to < from)}
                  >
                    <Wrench className="size-4" />
                    Take out of service
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
