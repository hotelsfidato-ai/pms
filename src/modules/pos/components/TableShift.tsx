import { useState } from "react";
import { ArrowRightLeft, Merge } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { getFloor, moveOrder, joinTable, type Order } from "@/modules/pos/data/till";
import { AskDialog, type Ask, type Reply } from "@/modules/pos/components/AskDialog";

/* ══════════════════════════════════════════════════════════════════
   TABLE SHIFTING (the owner's D27-370, D27-372): Move and Join, two
   separate acts for whoever takes orders, to any table of the order's
   restaurant. Nothing prints; the Kitchen screen shows the new table by
   itself. Join says it cannot be undone before it is done.

   The Till's two buttons and their questions, drawn once and used by the
   Till and the Terminal alike (D27-372). The server refuses what it must,
   and its sentence is read in the same box.
   ══════════════════════════════════════════════════════════════════ */

export function TableShift({ hotelId, order, onChanged, className }: {
  hotelId: string; order: Order; onChanged: () => void; className?: string;
}) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);

  const shifted = async (join: boolean, label: string, tableId: string): Promise<Reply | undefined> => {
    setBusy(true);
    const res = await (join ? joinTable : moveOrder)(hotelId, order.id, tableId);
    setBusy(false);
    if (!res.ok) return { refused: res.reason };
    toast.success(join ? `${label} joined this bill` : `Moved to ${label}`);
    onChanged();
    return undefined;
  };

  const shift = async (join: boolean) => {
    const floor = await getFloor(hotelId, order.outlet).catch(() => null);
    const sections = floor?.sections ?? [];
    if (!sections.some((s) => s.tables.some((t) => t.orderId === order.id))) {
      return void toast.error("Not on a table", "This order is not on one of the floor's tables.");
    }
    /* Every section of the restaurant (D27-372); the section named when there are several. */
    const tables = sections.flatMap((s) => s.tables
      .filter((t) => join
        ? t.orderId && t.orderId !== order.id && ["running", "kot", "printed"].includes(t.state)
        : t.state === "blank")
      .map((t) => ({ ...t, name: sections.length > 1 ? `${t.label} (${s.name})` : t.label })));
    if (!tables.length) {
      return void toast.error(join ? "No table to join" : "No free table",
        join ? "No other table in the restaurant has an open bill." : "Every table in the restaurant is taken.");
    }
    setAsk(join ? {
      title: `Join another table to ${order.table ?? "this table"}`,
      body: `Its dishes, KOTs and covers come onto bill ${order.orderNo}, and its own bill closes as joined. Nothing prints.`,
      confirm: "", onConfirm: () => undefined,
      choices: tables.map((t) => ({
        label: `${t.name} · ${t.orderNo ?? ""}`,
        onChoose: () => ({ next: {
          title: `Join ${t.label} to ${order.table ?? "this table"}?`,
          body: `${t.label}'s dishes and KOTs come onto bill ${order.orderNo}, and ${t.label} shows "joined to ${order.table ?? "this table"}" until this bill is settled. This cannot be undone.`,
          confirm: "Join", onConfirm: () => shifted(true, t.label, t.id),
        } }),
      })),
    } : {
      title: `Move ${order.table ?? "this order"} to another table`,
      body: "The bill and its KOTs go with it, and this table becomes free. Nothing prints.",
      confirm: "", onConfirm: () => undefined,
      choices: tables.map((t) => ({ label: t.name, onChoose: () => shifted(false, t.label, t.id) })),
    });
  };

  return (
    <>
      <Button variant="secondary" size="lg" className={className ?? "w-full"} loading={busy} onClick={() => void shift(false)}>
        <ArrowRightLeft className="size-4" />
        Move to another table
      </Button>
      <Button variant="secondary" size="lg" className={className ?? "w-full"} loading={busy} onClick={() => void shift(true)}>
        <Merge className="size-4" />
        Join another table
      </Button>
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}
