import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRole } from "@/lib/session";
import { Button } from "@/components/ui";
import { addIdPhotoAtDesk, getDesk } from "@/modules/online-checkin/data/desk";
import { IdPhotoInputs, type ChosenPhotos } from "@/modules/online-checkin/IdPhotoInputs";
import { AADHAAR_MASKED } from "@/modules/online-checkin/idPhotoNotice";
import { DESK_ROLES } from "@/modules/online-checkin/nav";
import { shrinkPhoto } from "@/modules/online-checkin/shrinkPhoto";

/* ══════════════════════════════════════════════════════════════════
   THE DESK ADDS THE ID PHOTO AT CHECK-IN (D27-210)

   For a guest who did not send one from their own page, so there is a
   copy for every guest. The clerk photographs the ID in their hand; the
   guest's yes is the clerk's tick, and the server records the clerk's
   name with it. The same rule as online: an Aadhaar only with its first
   8 digits hidden.

   The photo is shown FROM THIS DEVICE before it goes, and never fetched
   back: once added it is kept for the owner, an administrator and the GM
   (Online check-in, "ID photos kept"), encrypted, not on this server.

   Only the desk's roles are shown it. Where the hotel cannot keep ID
   photos (no password on the server) it says so, in the server's words.
   Drawn by the check-in and the stay panel; it draws nothing of its own
   around itself.
   ══════════════════════════════════════════════════════════════════ */
export default function AddIdPhotoAtDesk({ stayId }: { stayId: string }) {
  const code = useParams().code ?? "";
  const desk = DESK_ROLES.includes(useRole());
  const q = useQuery({
    queryKey: ["online-checkin-desk", code],
    queryFn: () => getDesk(code),
    enabled: desk && !!code,
  });
  const [chosen, setChosen] = useState<ChosenPhotos>({ front: null, back: null });
  const [agreed, setAgreed] = useState(false);
  const [round, setRound] = useState(0);
  const add = useMutation({
    mutationFn: async () => addIdPhotoAtDesk(code, stayId, {
      front: await shrinkPhoto(chosen.front!),
      back: chosen.back ? await shrinkPhoto(chosen.back) : null,
    }),
    onSuccess: () => { setChosen({ front: null, back: null }); setAgreed(false); },
  });

  if (!desk || !q.data) return null;
  const { on, off } = q.data.idPhotos;

  return (
    <div className="flex flex-col gap-3" data-add-id-photo>
      <p className="text-base font-medium text-ink-900">A photo of the ID</p>
      {!on ? (
        <p className="text-sm text-grey-600">{off}</p>
      ) : add.isSuccess ? (
        <>
          <p className="text-sm text-grey-600">
            Added. It is kept, encrypted, for the owner, an administrator and the general manager.
          </p>
          <div>
            <Button type="button" variant="ghost" onClick={() => { add.reset(); setRound((n) => n + 1); }}>
              Replace the photo
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-grey-600">{AADHAAR_MASKED}</p>
          {/* A new key empties the file buttons after a send or a replace. */}
          <IdPhotoInputs key={round} value={chosen} onChange={setChosen} camera disabled={add.isPending} />
          <label className="flex items-start gap-2.5 text-sm text-ink-900 pointer-coarse:min-h-11 cursor-pointer">
            <input
              type="checkbox" className="mt-0.5 size-4 accent-brand-orange cursor-pointer"
              checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            />
            The guest agreed to the hotel keeping this photo
          </label>
          <div>
            <Button type="button" variant="secondary" disabled={add.isPending || !chosen.front || !agreed}
              onClick={() => add.mutate()}>
              {add.isPending ? "Adding…" : "Add the photo"}
            </Button>
          </div>
          {add.error && <p className="text-sm text-brand-red-700">{(add.error as Error).message}</p>}
        </>
      )}
    </div>
  );
}
