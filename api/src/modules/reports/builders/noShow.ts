import type { Client } from "../../../db.ts";
import { col, row, type ReportDoc } from "../document.ts";
import { heading, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   NO SHOW REPORT

   The owner's export for 25 August 2026 is the property's name, the
   title, "As On Date 25/08/2026" and nothing else: nobody failed to
   arrive. That is the report working, not a report failing, so an empty
   day still prints its date and says so.

   A no-show is a booking the night audit marked no_show, arriving on
   the day asked about. Where it came from is app.booking_source_label
   (082), the one answer every screen gives; a dash when nothing is known.
   ══════════════════════════════════════════════════════════════════ */

export async function noShowReport(
  client: Client, property: Property, asOn: string,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    reference: string; guest: string; room_type: string; arrival: string;
    departure: string; source: string | null; rate: string; adults: number; children: number;
  }>(
    `select r.reference,
            g.full_name                                          as guest,
            rt.name                                              as room_type,
            to_char(r.check_in, 'YYYY-MM-DD')                    as arrival,
            to_char(r.check_out, 'YYYY-MM-DD')                   as departure,
            app.booking_source_label(bs.name, co.name, r.source) as source,
            r.agreed_rate::text                                  as rate,
            r.adults, r.children
       from reservations r
       join guests g      on g.id  = r.guest_id
       join room_types rt on rt.id = r.room_type_id
       left join companies co       on co.id = r.company_id
       left join booking_sources bs on bs.id = r.booking_source_id
      where r.hotel_id = $1
        and r.status = 'no_show'
        and r.check_in = $2::date
      order by r.reference`,
    [property.id, asOn],
  );

  return {
    report: "no-show",
    title: "No show",
    property: heading(property),
    orientation: "portrait",
    facts: [{ label: "As On Date", value: asOn, kind: "date" }],
    sections: [{
      key: "no-shows",
      title: "No show",
      columns: [
        col("reference", "Booking", "text"),
        col("guest", "Guest", "text"),
        col("roomType", "Room Type", "text"),
        col("arrival", "Arrival", "date"),
        col("departure", "Departure", "date"),
        col("pax", "Pax", "count"),
        col("source", "Source", "text"),
        col("rate", "Rate", "money"),
      ],
      rows: rows.map((r) => row({
        reference: r.reference,
        guest: r.guest,
        roomType: r.room_type,
        arrival: r.arrival,
        departure: r.departure,
        pax: Number(r.adults) + Number(r.children),
        source: r.source,
        rate: Number(r.rate),
      })),
      empty: "Nobody failed to arrive on this day.",
    }],
    footnotes: [],
  };
}
