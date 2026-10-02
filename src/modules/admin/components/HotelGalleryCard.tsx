import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Input, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { shrinkPhoto } from "@/modules/online-checkin";
import {
  addPhoto, captionPhoto, listPhotos, orderPhotos, photoSrc, removePhoto, GALLERY_KEY, type HotelPhoto,
} from "@/modules/admin/data/gallery";
import { SettingHeader } from "@/modules/admin/pages/Admin";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S PHOTOS (the owner's D27-243, D27-244)

   Shown to guests on their in-stay page, under the code. Added, captioned,
   put in order and deleted by the owner, an administrator or the GM (the
   logo's three: `room_config` edit, which the server asks too); everybody
   else who opens Settings sees them.

   Each picked photo is redrawn at 1600 px as a JPEG before it is sent
   (online-checkin's shrinkPhoto), which also leaves the camera's location
   behind; the server refuses anything else. Shown only as an <img>.
   ══════════════════════════════════════════════════════════════════ */

const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(",") + 1)); };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export function HotelGalleryCard({ hotelCode }: { hotelCode: string }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: GALLERY_KEY(hotelCode), queryFn: () => listPhotos(hotelCode), enabled: Boolean(hotelCode) });
  const photos = q.data?.photos ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: GALLERY_KEY(hotelCode) });

  const add = async (files: File[]) => {
    setAdding(true);
    let added = 0;
    for (const file of files) {
      const res = await addPhoto(hotelCode, await read(await shrinkPhoto(file)));
      if (!res.ok) { toast.error(`${file.name} not added`, res.reason); break; }
      added += 1;
    }
    setAdding(false);
    if (added) toast.success(added === 1 ? "Photo added" : `${added} photos added`, "Guests see it on their page from now on.");
    refresh();
  };

  const move = async (from: number, to: number) => {
    const ids = photos.map((p) => p.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    const res = await orderPhotos(hotelCode, ids);
    if (!res.ok) toast.error("Not moved", res.reason);
    refresh();
  };

  return (
    <Card>
      <SettingHeader
        title="Photos"
        line="Shown to guests on their page during the stay. Never a guest in one."
        info="Each photo is made 1600 px on its long side and its location taken out as it is sent. Up to 20."
        actions={mayEdit && (
          <>
            <input
              ref={picker} type="file" accept="image/*" multiple className="hidden"
              aria-label="Choose photos to add"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void add(files);
              }}
            />
            <Button variant="secondary" loading={adding} disabled={photos.length >= (q.data?.most ?? 20)}
              onClick={() => picker.current?.click()}>
              Add photos
            </Button>
          </>
        )}
      />
      <CardBody>
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : photos.length === 0 ? (
          <p className="text-base text-grey-500">No photos yet. Guests' pages show none until one is added.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {photos.map((p, i) => (
                <PhotoTile key={p.id} hotelCode={hotelCode} photo={p} n={i + 1} last={i === photos.length - 1}
                  mayEdit={mayEdit} onMove={(by) => void move(i, i + by)} onChanged={refresh} />
              ))}
            </ul>
            <p className="text-xs text-grey-500 mt-3">{photos.length} of {q.data?.most ?? 20} photos</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function PhotoTile({ hotelCode, photo, n, last, mayEdit, onMove, onChanged }: {
  hotelCode: string; photo: HotelPhoto; n: number; last: boolean; mayEdit: boolean;
  onMove: (by: -1 | 1) => void; onChanged: () => void;
}) {
  const src = useQuery({ queryKey: ["hotel-photo", hotelCode, photo.id], queryFn: () => photoSrc(hotelCode, photo.id), staleTime: Infinity });
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [asking, setAsking] = useState(false);
  const dirty = caption.trim() !== (photo.caption ?? "");

  const save = async () => {
    const res = await captionPhoto(hotelCode, photo.id, caption);
    if (!res.ok) return void toast.error("Caption not saved", res.reason);
    onChanged();
  };
  const remove = async () => {
    const res = await removePhoto(hotelCode, photo.id);
    if (!res.ok) return void toast.error("Not deleted", res.reason);
    toast.success("Photo deleted", "Guests no longer see it.");
    onChanged();
  };

  return (
    <li className="min-w-0">
      {src.data ? (
        <img src={src.data} alt={photo.caption ?? `Photo ${n}`}
          className="aspect-[4/3] w-full rounded-md object-cover bg-grey-100" />
      ) : (
        <Skeleton className="aspect-[4/3] w-full" />
      )}
      {mayEdit ? (
        <div className="mt-2 flex gap-1.5">
          <Input value={caption} maxLength={120} placeholder="Caption" aria-label={`Caption for photo ${n}`}
            onChange={(e) => setCaption(e.target.value)} className="min-w-0" />
          {dirty && (
            <Button variant="secondary" aria-label={`Save caption for photo ${n}`} onClick={() => void save()}>Save</Button>
          )}
        </div>
      ) : (
        photo.caption && <p className="mt-1.5 text-sm text-ink-900 break-words">{photo.caption}</p>
      )}
      {mayEdit && (asking ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-grey-600">Delete it?</span>
          <Button variant="danger" aria-label={`Yes, delete photo ${n}`} onClick={() => void remove()}>Delete</Button>
          <Button variant="ghost" onClick={() => setAsking(false)}>Keep</Button>
        </div>
      ) : (
        <div className="mt-1.5 flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`Move photo ${n} earlier`} disabled={n === 1} onClick={() => onMove(-1)}>
            <ArrowLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move photo ${n} later`} disabled={last} onClick={() => onMove(1)}>
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete photo ${n}`} className="ml-auto" onClick={() => setAsking(true)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </li>
  );
}
