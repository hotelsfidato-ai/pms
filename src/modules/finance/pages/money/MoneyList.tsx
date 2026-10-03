import { useState, type ReactNode } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, EmptyState, SearchInput, Switch } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE SETTINGS LIST (plan § 3): search, "+", and per row drag to order,
   On/Off, edit, and delete only when nothing used it. Shared by Money's
   payment methods, extra charges and discounts. Every change reaches the
   activity log through the tables' audit triggers (191).
   ══════════════════════════════════════════════════════════════════ */

type Row = { id: string; isActive: boolean; used: boolean };

export function MoneyList<T extends Row>({
  rows, name, detail, addLabel, onAdd, onToggle, onEdit, onDelete, onOrder, empty,
}: {
  rows: T[];
  name: (row: T) => string;
  detail: (row: T) => ReactNode;
  addLabel: string;
  onAdd: () => void;
  onToggle: (row: T, on: boolean) => void;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
  /** Absent: the list keeps its own order (a name order) and has no handles. */
  onOrder?: (ids: string[]) => void;
  empty: string;
}) {
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const shown = rows.filter((r) => name(r).toLowerCase().includes(search.trim().toLowerCase()));
  /* Dragging reorders the whole list, so only while nothing is filtered out. */
  const canDrag = !!onOrder && !search.trim();

  const drop = (onto: string) => {
    if (!dragging || dragging === onto || !onOrder) return;
    const ids = rows.map((r) => r.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(onto), 0, dragging);
    onOrder(ids);
  };

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-grey-200 p-3">
        <SearchInput className="flex-1 min-w-0" placeholder="Search" aria-label="Search"
                     value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="primary" className="h-10 shrink-0" onClick={onAdd} aria-label={addLabel}>
          <Plus className="size-4" /> <span className="hidden sm:inline">{addLabel}</span>
        </Button>
      </div>
      {shown.length === 0 ? (
        <EmptyState compact title={rows.length ? "Nothing matches" : empty} />
      ) : (
        <ul className="divide-y divide-grey-200">
          {shown.map((row) => (
            <li key={row.id}
                draggable={canDrag}
                onDragStart={() => setDragging(row.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (canDrag) e.preventDefault(); }}
                onDrop={() => drop(row.id)}
                className={cn("flex items-center gap-3 px-3 py-2.5",
                              dragging === row.id && "opacity-50",
                              !row.isActive && "text-grey-500")}>
              {onOrder && (
                <GripVertical aria-hidden
                  className={cn("size-4 shrink-0 text-grey-400", canDrag ? "cursor-grab" : "opacity-30")} />
              )}
              <Switch checked={row.isActive} onCheckedChange={(on) => onToggle(row, on)}
                      label={<span className="sr-only">{name(row)}</span>} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{name(row)}</p>
                <p className="truncate text-sm text-grey-500">{detail(row)}</p>
              </div>
              <Button variant="ghost" className="h-10 w-10 shrink-0 p-0" aria-label={`Edit ${name(row)}`}
                      onClick={() => onEdit(row)}>
                <Pencil className="size-4" />
              </Button>
              {!row.used && (
                <Button variant="ghost" className="h-10 w-10 shrink-0 p-0" aria-label={`Delete ${name(row)}`}
                        onClick={() => onDelete(row)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** An editor's question with its reason beside it: the plain words and a ₹ example. */
export function Explained({ children, why }: { children: ReactNode; why: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-4 min-w-0">{children}</div>
      <aside className="rounded-lg bg-grey-50 p-3 text-sm text-grey-600 space-y-2">{why}</aside>
    </div>
  );
}
