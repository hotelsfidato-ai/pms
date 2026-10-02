import { useQuery } from "@tanstack/react-query";
import { api, apiBase } from "@/lib/api";
import { at, withUnlock } from "@/modules/online-checkin/data/guestPage";
import { H2, SECTION, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S PHOTOS (the owner's D27-243, D27-244)

   The list comes behind the code (api/src/routes/guestGallery.ts, rule 8);
   each picture is an <img> on the link's own address, as the logo is - an
   <img> cannot carry the unlock, and the pictures are the hotel's, never the
   guest's. Loaded as they scroll into view, kept a day by the browser.
   The section draws nothing when the hotel has no photos.
   ══════════════════════════════════════════════════════════════════ */

interface Photo { id: string; caption: string | null; width: number; height: number }

const getGallery = async (token: string) => {
  const [list, base] = await Promise.all([
    api<{ photos: Photo[] }>(at(token, "/gallery"), withUnlock(token)), apiBase()]);
  return list.photos.map((p) => ({ ...p, src: `${base}${at(token, `/gallery/${p.id}`)}` }));
};

export function GallerySection({ token, hotel, onUnlockGone }: {
  token: string; hotel: string; onUnlockGone: () => void;
}) {
  const q = useQuery({ queryKey: ["guest-behind", token, "gallery"], queryFn: () => getGallery(token), retry: false });
  useUnlockGone(q.error, onUnlockGone);
  const photos = q.data ?? [];
  if (photos.length === 0) return null;

  return (
    <section className={SECTION} aria-labelledby="guest-gallery">
      <h2 id="guest-gallery" className={H2}>Photos of {hotel}</h2>
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {photos.map((p) => (
          <li key={p.id} className="min-w-0">
            <img src={p.src} alt={p.caption ?? ""} loading="lazy" width={p.width} height={p.height}
              className="aspect-[4/3] w-full h-auto rounded-md object-cover bg-grey-100" />
            {p.caption && <p className="mt-1 text-sm text-grey-600 break-words">{p.caption}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
