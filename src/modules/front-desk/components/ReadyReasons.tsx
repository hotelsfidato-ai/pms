import { useQuery } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { listOf, type ListKind } from "@/modules/front-desk/data/lists";

/** The hotel's ready reasons for an action (phase 5, the owner's D27-260):
    tapped, one fills the reason box; typing your own still works. Nothing
    is drawn while the hotel has none. */
export function ReadyReasons({ kind, onPick }: { kind: ListKind; onPick: (reason: string) => void }) {
  const hotelId = useUi((s) => s.hotelId);
  const q = useQuery({
    queryKey: ["lists", hotelId, kind],
    queryFn: () => listOf(hotelId!, kind),
    enabled: Boolean(hotelId),
  });
  const ready = (q.data ?? []).filter((r) => r.active);
  if (ready.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5" data-ready-reasons={kind}>
      {ready.map((r) => (
        <button key={r.id} type="button" onClick={() => onPick(r.label)}
          className="h-8 px-2.5 rounded-full border border-grey-200 bg-white text-sm text-ink-900 hover:border-grey-300 transition-colors duration-150">
          {r.label}
        </button>
      ))}
    </div>
  );
}
