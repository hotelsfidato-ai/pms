import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { Button, Card, Input, Skeleton, toast } from "@/components/ui";
import { getSession } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ListItem } from "@/modules/front-desk/data/lists";

/* ══════════════════════════════════════════════════════════════════
   ONE LIST, THE SETTINGS PATTERN (plan section 3; the owner's D27-260)

   Search, "+", and per row: move up or down, On/Off, rename, delete (the
   server refuses when something uses it and says to switch it Off). Every
   list in Settings › Lists is this component with its own four calls.
   ══════════════════════════════════════════════════════════════════ */

type Saved = { ok: true; id?: string } | { ok: false; reason: string };

export interface ListCalls {
  key: readonly unknown[];
  read: () => Promise<ListItem[]>;
  add: (item: { label: string; colour?: string | null }) => Promise<Saved>;
  change: (id: string, change: Partial<Omit<ListItem, "id">>) => Promise<Saved>;
  remove: (id: string) => Promise<Saved>;
}

export function ListEditor({ calls, noun, withColour = false }: {
  calls: ListCalls; noun: string; withColour?: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: calls.key, queryFn: calls.read });
  const [find, setFind] = useState("");
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: calls.key });
  const done = (r: Saved, what: string) => {
    if (!r.ok) { toast.error(`Not ${what}`, r.reason); return false; }
    refresh(); return true;
  };

  const rows = (q.data ?? []).filter((r) => r.label.toLowerCase().includes(find.trim().toLowerCase()));
  const all = q.data ?? [];
  const swap = async (i: number, j: number) => {
    const a = all[i], b = all[j];
    if (!a || !b) return;
    const ra = await calls.change(a.id, { sort: b.sort === a.sort ? b.sort + 1 : b.sort });
    const rb = await calls.change(b.id, { sort: a.sort });
    done(ra.ok ? rb : ra, "moved");
  };

  return (
    <Card className="p-0 overflow-hidden" data-list-editor={noun}>
      <div className="flex items-center gap-2 p-3 border-b border-grey-200">
        <div className="relative flex-1 min-w-0">
          <Search className="size-4 text-grey-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search"
            aria-label={`Search ${noun}s`} className="pl-9" />
        </div>
      </div>
      <form className="flex items-center gap-2 p-3 border-b border-grey-200"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          if (done(await calls.add({ label: adding.trim() }), "added")) setAdding("");
        }}>
        <Input value={adding} onChange={(e) => setAdding(e.target.value)}
          placeholder={`New ${noun}`} aria-label={`New ${noun}`} className="flex-1 min-w-0" />
        <Button type="submit" variant="primary" disabled={!adding.trim()} aria-label={`Add ${noun}`}>
          <Plus className="size-4" /> Add
        </Button>
      </form>
      {q.isLoading ? <Skeleton className="h-24 m-3" /> : rows.length === 0 ? (
        <p className="p-4 text-sm text-grey-500">{all.length ? "Nothing matches." : `No ${noun}s yet.`}</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const i = all.findIndex((x) => x.id === r.id);
            return (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2 border-b border-grey-100 last:border-b-0" data-list-row={r.label}>
                <div className="flex flex-col">
                  <button type="button" aria-label={`Move ${r.label} up`} disabled={i === 0 || !!find}
                    onClick={() => void swap(i, i - 1)} className="text-grey-400 hover:text-ink-900 disabled:opacity-30">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" aria-label={`Move ${r.label} down`} disabled={i === all.length - 1 || !!find}
                    onClick={() => void swap(i, i + 1)} className="text-grey-400 hover:text-ink-900 disabled:opacity-30">
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
                {withColour && (
                  <input type="color" aria-label={`Colour of ${r.label}`} value={r.colour ?? "#E2E5E8"}
                    onChange={async (e) => done(await calls.change(r.id, { colour: e.target.value.toUpperCase() }), "changed")}
                    className="size-7 rounded border border-grey-200 bg-white p-0.5 cursor-pointer" />
                )}
                {editing?.id === r.id ? (
                  <form className="flex-1 min-w-0" onSubmit={async (e) => {
                    e.preventDefault();
                    if (done(await calls.change(r.id, { label: editing.label.trim() }), "renamed")) setEditing(null);
                  }}>
                    <Input autoFocus value={editing.label} aria-label={`Rename ${r.label}`}
                      onChange={(e) => setEditing({ id: r.id, label: e.target.value })}
                      onBlur={() => setEditing(null)} />
                  </form>
                ) : (
                  <button type="button" className="flex-1 min-w-0 text-left text-base text-ink-900 truncate"
                    onClick={() => setEditing({ id: r.id, label: r.label })} title="Rename">
                    <span className={r.active ? "" : "text-grey-500 line-through"}>{r.label}</span>
                  </button>
                )}
                <input type="checkbox" role="switch" checked={r.active} aria-label={`${r.label} on`}
                  onChange={async (e) => done(await calls.change(r.id, { active: e.target.checked }), "changed")}
                  className="size-4 accent-brand-orange cursor-pointer" />
                <button type="button" aria-label={`Delete ${r.label}`}
                  onClick={async () => done(await calls.remove(r.id), "deleted")}
                  className="p-1.5 rounded text-grey-400 hover:text-brand-red-700">
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The screens read the hotel's settings from the hotel list: fetch it again. */
export async function refreshHotels() {
  const { hotels } = await getSession().catch(() => ({ hotels: null }));
  if (hotels) useSession.setState({ hotels });
}

/** A page's plain-words panel (plan section 3). */
export function Explain({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-grey-600 max-w-[70ch] mb-4">{children}</p>;
}
