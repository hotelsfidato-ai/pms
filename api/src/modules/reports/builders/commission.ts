import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   COMMISSION OWED TO BOOKING SITES AND AGENTS (D27-383 item 3)

   Per booking, the owner's D17-84: the site's own figure when it sent one
   (reservations.commission_amount, 111), else the rate recorded for the
   source or the agent's contract, stamped on the booking when it was taken
   (reservations.commission_pct, 082 and 177's C-8), times the booking's
   room revenue; else a dash. Never a zero for "no rate", never a default
   rate (no default prices).

   ON WHICH AMOUNT: neither a booking source's setting nor a contract says,
   so the room revenue before GST - the stay's live room charges, the
   Manager report's "Room Charges" (decided under D27-396; the CA confirms).

   WHEN: a booking is counted in the window it checked out in, whole - the
   way the sites bill it. A booking not checked out yet is not owed for.
   Nothing here is paid out: no payout is recorded (D27-259), which is why
   the Manager report's Outstanding Commission stays "-" (D17-75).
   ══════════════════════════════════════════════════════════════════ */

const sum = (list: number[]) => round2(list.reduce((t, n) => t + n, 0));

/** What a booking owes in commission: the site's figure, else rate x room revenue, else null. */
export const commissionOf = (site: number | null, pct: number | null, room: number): number | null =>
  site !== null ? site : pct !== null ? round2((room * pct) / 100) : null;

export async function commissionReport(
  client: Client, property: Property, from: string, to: string,
): Promise<ReportDoc> {
  const { rows } = await client.query<{
    account: string | null; reference: string; guest: string | null; arrival: string; departure: string;
    pct: string | null; site: string | null; room: string;
  }>(
    `select app.booking_source_label(bs.name, co.name, r.source) as account,
            r.reference, g.full_name as guest,
            to_char(r.check_in, 'YYYY-MM-DD') as arrival, to_char(r.check_out, 'YYYY-MM-DD') as departure,
            r.commission_pct::text as pct, r.commission_amount::text as site,
            (select coalesce(sum(fp.amount), 0)
               from folio_postings fp join folios f on f.id = fp.folio_id
              where coalesce(fp.reservation_id, f.reservation_id) = r.id
                and fp.category = 'room' and ${LIVE})::text as room
       from reservations r
       left join guests g on g.id = r.guest_id
       left join booking_sources bs on bs.id = r.booking_source_id
       left join companies co on co.id = r.company_id
      where r.hotel_id = $1 and r.status = 'checked_out'
        and r.check_out between $2::date and $3::date
        and (r.commission_pct is not null or r.commission_amount is not null
             or bs.kind in ('ota', 'travel_agent') or co.kind = 'travel_agent')
      order by 1, r.check_out, r.reference`,
    [property.id, from, to],
  );

  const bookings = rows.map((r) => {
    const room = round2(Number(r.room));
    const pct = r.pct === null ? null : Number(r.pct);
    const site = r.site === null ? null : Number(r.site);
    return { ...r, room, pct, site, owed: commissionOf(site, pct, room) };
  });
  /* A sum of the figures known; a dash when none is (MEMORY: a dash is not a zero). */
  const owedOf = (list: typeof bookings) =>
    list.some((b) => b.owed !== null) ? sum(list.flatMap((b) => (b.owed === null ? [] : [b.owed]))) : null;

  const lines: ReportRow[] = [];
  for (const account of [...new Set(bookings.map((b) => b.account))]) {
    const mine = bookings.filter((b) => b.account === account);
    lines.push(band("booking", account ?? "-"));
    for (const b of mine) {
      lines.push(row({ booking: b.reference, guest: b.guest, arrival: b.arrival, departure: b.departure,
        room: b.room, pct: b.pct, site: b.site, owed: b.owed }, { indent: 1 }));
    }
    lines.push(total({ booking: `${account ?? "-"}, total`, room: sum(mine.map((b) => b.room)), owed: owedOf(mine) }));
  }
  if (bookings.length) {
    lines.push(total({ booking: "Total", room: sum(bookings.map((b) => b.room)), owed: owedOf(bookings) }));
  }
  const noRate = bookings.filter((b) => b.owed === null).length;

  return {
    report: "commission",
    title: "Commission owed",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "From", value: from, kind: "date" }, { label: "To", value: to, kind: "date" }],
    sections: [{
      key: "bookings",
      title: "Bookings checked out, by booking site and agent",
      columns: [
        col("booking", "Booking", "text"), col("guest", "Guest", "text"),
        col("arrival", "Arrival", "date"), col("departure", "Departure", "date"),
        col("room", "Room revenue before GST"), col("pct", "Rate %", "ratio"),
        col("site", "Site's figure"), col("owed", "Commission"),
      ],
      rows: lines,
      empty: "No booking from a booking site or an agent checked out in these days.",
      ...(noRate ? { note: `${noRate} booking${noRate === 1 ? " has" : "s have"} no commission on record: a dash, not counted in the totals.` } : {}),
    }],
    footnotes: [
      "Commission is the site's own figure when it sent one; else the rate on record when the booking was taken, times its room revenue; else \"-\" (D17-84).",
      "Room revenue is the stay's room charges before GST, discounts not taken off: no booking source or contract names another amount. The CA confirms the basis.",
      "A booking counts in the days it checked out in. The site's GST on its commission, and the TCS or TDS it keeps, are not here.",
      "No commission paid out is recorded, so this is what is owed for these stays, not what is left to pay.",
    ],
  };
}
