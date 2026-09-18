import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   REPAIRS — what the equipment register lets another service do

   ⚠ WRITTEN BY THE HOUSEKEEPING CHAT, 17 September, on the owner's
   answer: "I write it, master reviews". No equipment chat was running,
   and D17-7 says opening a repair sets the item "Under repair" and
   closing it sets "In use" — through THIS service's front door, never by
   another service writing `equipment_items`. Exported from index.ts; the
   master reviews these lines at merge.

   The rules are the register's own, restated here so a repair cannot do
   what the status route (`equipment.ts`) refuses:

     a retired thing is kept as it was retired
     a thing waiting in the approvals inbox is decided there first
     (the owner, 17 September: a repair on it is refused, with that sentence)
     only a TAGGED thing is repaired (the owner, 17 September) — marking a
     counted line would mark the working pieces on it too

   WHO may report a repair or record its cost is the housekeeping API's
   (`api/src/modules/housekeeping/repairRoles.ts`). These functions check
   what the THING allows, not who is asking — the caller has already
   decided that, inside the same transaction.
   ══════════════════════════════════════════════════════════════════ */

export type RepairStatus = "in_use" | "under_repair";

export const REPAIR_WAITING =
  "A request for this item is waiting in the approvals inbox. It is decided there first.";

/** A thing a repair may point at. */
export interface RepairableItem {
  id: string;
  name: string;
  tag: string;
  /** "Room 204" or the place's name. */
  place: string;
  /** The room it stands in, when it stands in one — the board offers these first. */
  roomNumber: string | null;
  status: RepairStatus;
  /** True while a request for it waits in the approvals inbox. */
  waiting: boolean;
}

interface Row {
  id: string; name: string; tag: string; status: RepairStatus;
  room_number: string | null; location_name: string | null;
  waiting: boolean;
}

const placeOf = (r: Pick<Row, "room_number" | "location_name">) =>
  r.room_number ? `Room ${r.room_number}` : (r.location_name ?? "-");

/** Every tagged thing at the property that is not retired, by place then name. */
export async function itemsForRepair(client: Client, hotelId: string): Promise<RepairableItem[]> {
  const { rows } = await client.query<Row>(
    `select i.id::text, i.name, i.tag, i.status,
            r.number as room_number, l.name as location_name,
            (app.equipment_move_waiting(i.id) or app.equipment_retire_waiting(i.id)) as waiting
       from equipment_items i
       left join lateral app.equipment_place(i.id) pl on true
       left join rooms r on r.id = pl.room_id
       left join locations l on l.id = pl.location_id
      where i.hotel_id = $1
        and i.held_as = 'tagged'
        and not app.equipment_is_retired(i.id)
      order by r.number nulls last, l.name nulls last, i.name, i.tag`,
    [hotelId],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, tag: r.tag, place: placeOf(r),
    roomNumber: r.room_number, status: r.status, waiting: r.waiting,
  }));
}

export type RepairCheck =
  | { ok: true; item: RepairableItem }
  | { ok: false; reason: string };

/**
 * May a repair point at this thing now? Locks the item for the rest of the
 * transaction, so nothing changes it between this answer and the write.
 */
export async function checkRepairable(
  client: Client, hotelId: string, itemId: string,
): Promise<RepairCheck> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { ok: false, reason: "No such item here." };

  const { rows } = await client.query<Row & { held_as: string; retired: boolean }>(
    `select i.id::text, i.name, i.tag, i.status, i.held_as,
            app.equipment_is_retired(i.id) as retired,
            (app.equipment_move_waiting(i.id) or app.equipment_retire_waiting(i.id)) as waiting,
            r.number as room_number, l.name as location_name
       from equipment_items i
       left join lateral app.equipment_place(i.id) pl on true
       left join rooms r on r.id = pl.room_id
       left join locations l on l.id = pl.location_id
      where i.hotel_id = $1 and i.id = $2
        for update of i`,
    [hotelId, itemId],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "No such item here." };
  if (row.held_as !== "tagged") {
    return { ok: false,
             reason: "A repair points at one tagged item. A counted line is retired or replaced, not repaired." };
  }
  if (row.retired) return { ok: false, reason: "A retired item is kept exactly as it was retired." };
  if (row.waiting) return { ok: false, reason: REPAIR_WAITING };

  return {
    ok: true,
    item: {
      id: row.id, name: row.name, tag: row.tag, place: placeOf(row),
      roomNumber: row.room_number, status: row.status, waiting: row.waiting,
    },
  };
}

/**
 * Set a thing "Under repair" or back "In use", the way the register's own
 * status route does: the note goes into the item's history beside who did it.
 * Nothing to do when it is already so. Call `checkRepairable` first, in the
 * same transaction.
 */
export async function setRepairStatus(
  client: Client, hotelId: string, itemId: string, status: RepairStatus, note: string,
): Promise<{ changed: boolean }> {
  await client.query("select set_config('app.equipment_note', $1, true)", [note.trim()]);
  const { rowCount } = await client.query(
    `update equipment_items set status = $1
      where id = $2 and hotel_id = $3 and status is distinct from $1`,
    [status, itemId, hotelId],
  );
  /* Cleared, so a later write in this transaction does not carry this note. */
  await client.query("select set_config('app.equipment_note', '', true)");
  return { changed: (rowCount ?? 0) > 0 };
}
