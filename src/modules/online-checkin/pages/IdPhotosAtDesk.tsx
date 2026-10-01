import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { dateTime } from "@/lib/format";
import {
  Button, Card, Dialog, DialogContent, EmptyState, Field, fieldProps, NativeSelect, Textarea, toast,
} from "@/components/ui";
import {
  getIdPhotoAtDesk, getKeptIdPhotos, removeIdPhoto,
  type KeptPhoto, type RemoveReason, type WaitingDetails,
} from "@/modules/online-checkin/data/desk";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S ID PHOTO, AT THE DESK (D27-207 to D27-212)

   · WHILE THE DETAILS WAIT, the clerk confirming them opens the photo
     beside what the guest typed, and removes one that is not masked, not
     readable or not an ID - the guest is then asked for another.
   · ONCE KEPT (confirmed, set aside, or added at the desk), only the
     owner, an administrator and the GM see it, in "ID photos kept"; they
     alone delete one, with a reason.

   The image is fetched from the server only when somebody presses Show -
   the server writes that view down - and is held in this screen's memory
   alone: never in the query cache, never on the device. Hide drops it.
   ══════════════════════════════════════════════════════════════════ */

const REASONS: { value: RemoveReason; label: string }[] = [
  { value: "not_masked", label: "Aadhaar not masked" },
  { value: "not_readable", label: "Cannot be read" },
  { value: "not_an_id", label: "Not an ID" },
];
const sidesSaid = (sides: string[]) => (sides.includes("back") ? "front and back" : "front");

/** The photo itself, once asked for. */
function Shown({ code, id }: { code: string; id: string }) {
  const shown = useMutation({ mutationFn: () => getIdPhotoAtDesk(code, id) });
  if (!shown.data) {
    return (
      <>
        <Button variant="secondary" disabled={shown.isPending} onClick={() => shown.mutate()}>
          {shown.isPending ? "Fetching the photo…" : "Show the photo"}
        </Button>
        {shown.error && <p className="text-sm text-brand-red-700 w-full">{(shown.error as Error).message}</p>}
      </>
    );
  }
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {shown.data.photos.map((p) => (
          <figure key={p.side} className="min-w-0">
            <img src={p.image} alt={`The ${p.side} of the guest's ID`}
              className="max-h-72 max-w-full rounded-md border border-grey-200" />
            <figcaption className="text-sm text-grey-600 mt-1 capitalize">{p.side}</figcaption>
          </figure>
        ))}
      </div>
      <div><Button variant="ghost" onClick={() => shown.reset()}>Hide the photo</Button></div>
    </div>
  );
}

/** Beside a waiting submission: the photo, and the desk's way to remove it. */
export function WaitingPhoto(
  { code, details, onChanged }: { code: string; details: WaitingDetails; onChanged: () => void },
) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<RemoveReason>("not_masked");
  const remove = useMutation({
    mutationFn: () => removeIdPhoto(code, details.photo!.id, reason),
    onSuccess: () => { setAsking(false); toast.success("Photo removed", details.guest); onChanged(); },
  });
  if (!details.photo) {
    return <p className="mt-3 text-sm text-grey-500">No ID photo was sent with these.</p>;
  }

  return (
    <div className="mt-3 border-t border-grey-100 pt-2.5" data-waiting-photo>
      <p className="text-sm text-grey-600">
        ID photo: {sidesSaid(details.photo.sides)}, sent {dateTime(details.photo.at)}.
        An Aadhaar must have its first 8 digits hidden.
      </p>
      <div className="mt-2.5 flex flex-wrap items-start gap-2">
        <Shown code={code} id={details.photo.id} />
        <Button variant="ghost" onClick={() => setAsking(true)}>Remove the photo</Button>
      </div>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent
          title="Remove this ID photo?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Remove the photo
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-base text-grey-600">
              It is deleted, and {details.guest}'s own page says why and asks for another.
              The typed details stay.
            </p>
            <Field label="Why">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={reason}
                  onChange={(e) => setReason(e.target.value as RemoveReason)}>
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </NativeSelect>
              )}
            </Field>
            {remove.error && <p className="text-sm text-brand-red-700">{(remove.error as Error).message}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "ID photos kept": for the owner, an administrator and the GM. */
export function KeptPhotos({ code }: { code: string }) {
  const kept = useQuery({ queryKey: ["online-checkin-kept-photos", code], queryFn: () => getKeptIdPhotos(code) });
  const [deleting, setDeleting] = useState<KeptPhoto | null>(null);
  const [why, setWhy] = useState("");
  const remove = useMutation({
    mutationFn: (v: { photo: KeptPhoto; reason: string }) => removeIdPhoto(code, v.photo.id, v.reason),
    onSuccess: (r, v) => {
      setDeleting(null);
      setWhy("");
      if (r.deletedFromDrive) toast.success("Photo deleted", v.photo.guest);
      void kept.refetch();
    },
  });
  const rows = kept.data?.photos ?? [];

  return (
    <section data-kept-photos>
      <h2 className="text-md font-semibold text-ink-900 mb-3">ID photos kept</h2>
      {kept.error ? (
        <p className="text-sm text-brand-red-700">{(kept.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState compact title="None kept"
            description="Once the desk has checked a guest's details, or added a photo at check-in, the photo is kept here for the owner, an administrator and the general manager." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-grey-100">
            {rows.map((p) => (
              <li key={p.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-medium text-ink-900">{p.guest}</p>
                  <p className="text-sm text-grey-600 tabular">
                    {p.reference} · {sidesSaid(p.sides)} · {dateTime(p.at)} · {p.addedBy ? `added by ${p.addedBy}` : "sent by the guest"}
                  </p>
                </div>
                {p.notYetDeleted ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-brand-red-700">
                      Removed here, but not yet deleted from Drive.
                    </p>
                    <Button variant="secondary" disabled={remove.isPending}
                      onClick={() => remove.mutate({ photo: p, reason: "" })}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-2">
                    <Shown code={code} id={p.id} />
                    <Button variant="ghost" onClick={() => setDeleting(p)}>Delete the photo</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {remove.error && !deleting && (
        <p className="text-sm text-brand-red-700 mt-3">{(remove.error as Error).message}</p>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent
          title="Delete this ID photo?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" disabled={remove.isPending || why.trim().length < 3}
                onClick={() => remove.mutate({ photo: deleting!, reason: why.trim() })}>
                Delete the photo
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-base text-grey-600">
              {deleting?.guest}'s ID photo is deleted for good. Who deleted it, when and why is kept.
            </p>
            <Field label="Why">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={2} maxLength={200} value={why}
                  onChange={(e) => setWhy(e.target.value)} />
              )}
            </Field>
            {remove.error && <p className="text-sm text-brand-red-700">{(remove.error as Error).message}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
