import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { at, withUnlock } from "@/modules/online-checkin/data/guestPage";
import { H2, SECTION, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   ABOUT THE HOTEL (the owner's D27-257)

   The highlights the hotel wrote on Settings → Highlights, the amenities it
   has switched on, and its map point as a plain Google Maps link - behind
   the code (api/src/routes/guestAbout.ts, rule 8). Plain text: a blank line
   is a new paragraph. The section draws nothing when there is nothing.
   ══════════════════════════════════════════════════════════════════ */

/** A plain Google Maps link to a map point: no key, nothing kept (D27-257). */
export const mapLink = (m: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${m.latitude},${m.longitude}`;

const TITLES: [string, string][] = [
  ["about", ""], ["attractions", "Local attractions"], ["directions", "Getting here"],
  ["activities", "Things to do"], ["landmarks", "Famous landmarks"],
];

interface About {
  texts: Record<string, string>; amenities: { name: string; icon: string }[];
  map: { latitude: number; longitude: number } | null;
}

export function AboutTheHotel({ token, hotel, onUnlockGone }: {
  token: string; hotel: string; onUnlockGone: () => void;
}) {
  const q = useQuery({
    queryKey: ["guest-behind", token, "about"],
    queryFn: () => api<About>(at(token, "/about"), withUnlock(token)), retry: false,
  });
  useUnlockGone(q.error, onUnlockGone);
  const a = q.data;
  const texts = TITLES.filter(([kind]) => a?.texts[kind]);
  if (!a || (texts.length === 0 && a.amenities.length === 0 && !a.map)) return null;

  return (
    <section className={SECTION} aria-labelledby="guest-about">
      <h2 id="guest-about" className={H2}>About {hotel}</h2>
      <div className="mt-3 flex flex-col gap-4 text-base text-ink-900">
        {texts.map(([kind, title]) => (
          <div key={kind}>
            {title && <h3 className="text-sm font-semibold text-grey-600 mb-1">{title}</h3>}
            {a.texts[kind]!.split(/\n\s*\n/).map((para, i) => (
              <p key={i} className="whitespace-pre-line break-words mb-2 last:mb-0">{para}</p>
            ))}
          </div>
        ))}
        {a.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Amenities">
            {a.amenities.map((m) => (
              <li key={m.name} className="rounded-full bg-grey-100 px-3 py-1 text-sm text-ink-900">{m.name}</li>
            ))}
          </ul>
        )}
        {a.map && (
          <a href={mapLink(a.map)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 underline underline-offset-2">
            Open in Maps <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </section>
  );
}
