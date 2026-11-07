import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { dateShort, dateTime } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import { useDocumentTitle } from "@/lib/documentTitle";
import {
  Page, PageHeader, Card, CardHeader, Button, Dialog, DialogContent, EmptyState, ErrorState, Field,
  fieldProps, Input, Skeleton, StatusPill, toast,
} from "@/components/ui";
import { getInventory } from "@/modules/inventory";
import { listWaitlist, removeFromWaitlist, type WaitlistEntry } from "@/modules/reservations/data/waitlist";
import { WaitlistDialog } from "@/modules/reservations/flows/WaitlistDialog";

/* ══════════════════════════════════════════════════════════════════
   THE WAITLIST (D27-383 item 8, migration 272)

   Who is waiting, oldest first, with the rooms of their type free NOW on
   every one of their nights - a cancellation, a shorter stay or a released
   allotment shows here by itself. Book opens New booking filled in from the
   entry; nothing is booked or sent by the system (D27-396).
   ══════════════════════════════════════════════════════════════════ */

const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default function WaitlistPage() {
  const params = useParams();
  const hotelId = params["code"] ?? useUi.getState().hotelId;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mayBook = can(useRole(), "create", "reservation");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WaitlistEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useDocumentTitle("Waitlist");

  const list = useQuery({ queryKey: ["waitlist", hotelId], queryFn: () => listWaitlist(hotelId) });
  const inventory = useQuery({ queryKey: ["inventory", hotelId, null], queryFn: () => getInventory(hotelId) });
  const types = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const c of inventory.data?.cells ?? []) seen.set(c.roomTypeId, { id: c.roomTypeId, name: c.roomType });
    return [...seen.values()];
  }, [inventory.data]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const result = await removeFromWaitlist(hotelId, removing.id, reason.trim());
    setBusy(false);
    if (!result.ok) return toast.error("Not removed", result.reason);
    toast.success(`${removing.guestName} is off the waitlist`, "Kept in the record, with who and why.");
    setRemoving(null);
    void qc.invalidateQueries({ queryKey: ["waitlist", hotelId] });
  };

  const entries = list.data?.entries ?? [];
  const free = entries.filter((e) => (e.free ?? 0) > 0);
  const full = entries.filter((e) => e.free === 0);
  const passed = entries.filter((e) => e.free === null);

  const section = (title: string, description: string, rows: WaitlistEntry[], canBook: boolean) => rows.length > 0 && (
    <Card className="mt-4">
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-grey-100">
        {rows.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 min-h-14" data-waiting={e.id}>
            <div className="min-w-48 flex-1">
              <div className="font-medium text-ink-900">
                {e.guestName}{e.phone && <span className="ml-2 text-sm font-normal text-grey-600 tabular">{e.phone}</span>}
              </div>
              <div className="text-sm text-grey-600">
                {e.roomType} · <span className="tabular">{dateShort(e.arrival)} → {dateShort(e.departure)}</span>
                {" "}· {nights(e.arrival, e.departure)} {nights(e.arrival, e.departure) === 1 ? "night" : "nights"}
              </div>
              {e.note && <div className="text-sm text-grey-600">{e.note}</div>}
              <div className="text-xs text-grey-500">Added {dateTime(e.createdAt)}{e.addedBy ? ` by ${e.addedBy}` : ""}</div>
            </div>
            {e.free !== null && (
              <StatusPill tone={e.free > 0 ? "success" : "neutral"}>
                {e.free > 0 ? `${e.free} ${e.free === 1 ? "room" : "rooms"} free now` : "Still full"}
              </StatusPill>
            )}
            {mayBook && (
              <span className="flex gap-2">
                {canBook && (
                  <Button size="sm"
                    onClick={() => navigate(`/h/${hotelId}/book?waitlist=${e.id}`)}>
                    Book
                  </Button>
                )}
                <Button size="sm" onClick={() => { setReason(""); setRemoving(e); }}>Remove</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <Page>
      <PageHeader
        title="Waitlist"
        description="Guests waiting for a room type on nights that were full, oldest first. The desk decides; nobody is booked or told by the system."
        actions={mayBook && (
          <Button variant="primary" leadingIcon={<Plus />} disabled={types.length === 0}
            onClick={() => setAdding(true)}>
            Put a guest on the waitlist
          </Button>
        )}
      />
      {list.isLoading ? <Skeleton className="h-60" />
        : list.isError ? <ErrorState title="The waitlist could not be read." onRetry={() => void list.refetch()} />
        : entries.length === 0 ? (
          <Card><EmptyState title="Nobody is waiting"
            description="When a room type is full for a guest's nights, put them here from New booking or with the button above." /></Card>
        ) : (
          <>
            {section("A room is free now", "Rooms of their type free on every one of their nights. Oldest first.", free, true)}
            {section("Still full", "Shown here as soon as a room frees up.", full, true)}
            {section("Arrival has passed", "Remove them, with a word on what happened.", passed, false)}
          </>
        )}

      <WaitlistDialog hotelId={hotelId} types={types} start={{}} open={adding} onOpenChange={setAdding} />

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <DialogContent
          title="Take off the waitlist"
          description={removing ? `${removing.guestName}, ${removing.roomType}, ${dateShort(removing.arrival)} → ${dateShort(removing.departure)}. Kept in the record.` : ""}
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg" onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="primary" size="lg" loading={busy} onClick={() => void remove()}>Remove</Button>
            </div>
          }
        >
          <Field label="Why (optional)">
            {(f) => <Input {...fieldProps(f)} value={reason} maxLength={200}
              placeholder="Booked elsewhere; no longer coming" onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
