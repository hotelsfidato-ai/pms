import type { Client } from "../../../db.ts";
import { col, row, type ReportDoc } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   EQUIPMENT (phase 3A; the owner's D27-238, D27-240 for who reads it)

   Read from the register (097) as it stands, against the report's date:
     out of the store   where each thing is now (app.equipment_place: its
                        latest move that needed no approval or was
                        approved), when that is a room or a place that is
                        not a store
     under repair       the item's status (097) and its open repair (058,
                        102), with the repair's costs so far as recorded -
                        a dash when none is recorded, never a zero
     warranty and AMC   the dates typed on the item, and the days left from
                        the report's date (negative: already ended)
   A retired item is in none of them.
   ══════════════════════════════════════════════════════════════════ */

export async function equipmentReport(client: Client, property: Property, asOn: string): Promise<ReportDoc> {
  /* One client, so one question at a time. */
  const outside = await client.query<{ item: string; tag: string | null; where_: string; since: string }>(
      `select i.name as item, i.tag,
              coalesce('Room ' || r.number, l.name) as where_,
              (mv.moved_at at time zone $2)::date::text as since
         from equipment_items i
         cross join lateral app.equipment_place(i.id) p
         join equipment_moves mv on mv.seq = p.seq
         left join rooms r on r.id = p.room_id
         left join locations l on l.id = p.location_id
        where i.hotel_id = $1 and i.status <> 'retired'
          and (p.room_id is not null or l.kind <> 'store')
        order by i.name, i.tag`,
      [property.id, property.timezone]);
  const repairs = await client.query<{ item: string; tag: string | null; repair: string | null; since: string | null; cost: string | null }>(
      `select i.name as item, i.tag, w.title as repair,
              (w.raised_at at time zone $2)::date::text as since,
              (select sum(c.amount) from work_order_costs c
                where c.work_order_id = w.id and c.cancelled_at is null)::text as cost
         from equipment_items i
         left join lateral (
           select wo.id, wo.title, wo.raised_at from work_orders wo
            where wo.equipment_item_id = i.id and wo.status in ('open', 'in_progress')
            order by wo.raised_at desc limit 1) w on true
        where i.hotel_id = $1 and i.status = 'under_repair'
        order by i.name, i.tag`,
      [property.id, property.timezone]);
  const cover = await client.query<{ item: string; tag: string | null; warranty: string | null; amc: string | null;
                   warranty_left: number | null; amc_left: number | null }>(
      `select i.name as item, i.tag, i.warranty_ends::text as warranty, i.amc_ends::text as amc,
              (i.warranty_ends - $2::date) as warranty_left, (i.amc_ends - $2::date) as amc_left
         from equipment_items i
        where i.hotel_id = $1 and i.status <> 'retired'
          and (i.warranty_ends is not null or i.amc_ends is not null)
        order by least(i.warranty_ends, i.amc_ends), i.name`,
      [property.id, asOn]);

  return {
    report: "equipment",
    title: "Equipment report",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "As On Date", value: asOn, kind: "date" }],
    sections: [
      {
        key: "out", title: "Out of the store",
        columns: [col("item", "Item", "text"), col("tag", "Tag", "text"),
          col("where", "Where", "text"), col("since", "Since", "date")],
        rows: outside.rows.map((r) => row({ item: r.item, tag: r.tag, where: r.where_, since: r.since })),
        empty: "Everything on the register is in a store.",
      },
      {
        key: "repair", title: "Under repair",
        columns: [col("item", "Item", "text"), col("tag", "Tag", "text"), col("repair", "Open repair", "text"),
          col("since", "Since", "date"), col("cost", "Cost so far (as recorded)")],
        rows: repairs.rows.map((r) => row({
          item: r.item, tag: r.tag, repair: r.repair, since: r.since,
          cost: r.cost === null ? null : Number(r.cost),
        })),
        empty: "Nothing is under repair.",
      },
      {
        key: "warranty", title: "Warranty and AMC",
        columns: [col("item", "Item", "text"), col("tag", "Tag", "text"),
          col("warranty", "Warranty ends", "date"), col("amc", "AMC ends", "date"),
          col("warrantyLeft", "Warranty days left", "count"), col("amcLeft", "AMC days left", "count")],
        rows: cover.rows.map((r) => row({
          item: r.item, tag: r.tag, warranty: r.warranty, amc: r.amc,
          warrantyLeft: r.warranty_left, amcLeft: r.amc_left,
        })),
        empty: "No warranty or AMC date is on the register.",
        note: "Soonest first. A negative number of days: it has already ended.",
      },
    ],
    footnotes: [],
  };
}
