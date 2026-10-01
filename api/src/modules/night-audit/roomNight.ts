import type { Client } from "../../db.ts";
import { POSTING_NIGHTS } from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE NIGHT'S ROOM CHARGE, IN ONE PLACE (the owner's D27-204, 30 September)

   The first night is posted at check-in, dated that business date; the night
   audit posts each later night. Both call THIS - who is charged for a night,
   what the charge is, and the insert that writes it - moved here from
   nightAudit.ts as they stood, so the two cannot come to differ.

   NEVER THE SAME NIGHT TWICE: a night is keyed by the stay and the night a
   room line pays for (POSTS_TONIGHT's "not exists"), not by who wrote the
   line. The night check-in posted is a night the audit finds charged.
   ══════════════════════════════════════════════════════════════════ */

/** Whether a room line already pays for the night `night` (SQL, a date) of
    the stay `r`: any of its lines on any bill - a reversed one too, so a night
    somebody took off is not charged again - read the way the reports read it.
    The run's rule, and the Bill tab's count of nights to come (FIN-24). */
const CHARGED = (night: string) => `exists (
            select 1 from folio_postings fp
             where fp.reservation_id = r.id
               and fp.category = 'room'
               and fp.business_date <= ${night}
               and fp.business_date + ${POSTING_NIGHTS} > ${night}
          )`;

/** The stays tonight's run charges a room night for, as SQL over `r` with
    $1 the hotel and $2 the night; the run then skips the complimentary ones.
    One text for the run and the checklist's count (QA NA-5: the checklist
    counted every stay in house and the run then posted none). */
export const POSTS_TONIGHT = `
          r.hotel_id = $1
          and r.status = 'checked_in'
          /* AN OPEN FOLIO, ASKED - NOT JOINED (28 September, the release
             review). A join to every open folio gave a stay with a second
             folio (a split bill) two rows, the "not exists" below ran for
             both before either insert, and the night was charged twice.
             Where the charge goes is folio_for_room_charge's answer. */
          and exists (select 1 from folios f
                       where f.reservation_id = r.id and f.status = 'open')
          -- A day-use room is sold and vacated inside one day. It has
          -- no night to charge for.
          and not r.is_day_use
          /* Not already charged for tonight. This is what makes an
             interrupted audit safe to restart: the charge is the thing
             that must not happen twice, so the check is on the charge,
             not on the run.

             PER STAY, NOT PER FOLIO. It used to ask whether the folio
             held a room charge for tonight, which is identical while
             every stay has its own folio - and silently wrong the moment
             a group routes twelve rooms to one master: charge the first,
             skip the other eleven, every night, and the run's summary
             reports what it posted so nothing looks amiss.

             AND NOT ONLY A LINE DATED TONIGHT (D24-14). A walk-in posts
             its whole stay on arrival, "Room 201 · 2 nights" (D17-33), and
             this asked only for a line dated tonight - so every night
             after the first was charged twice. A line counts for every
             night it pays for, read the way the reports read it. */
          and not ${CHARGED("$2::date")}`;

/** A stay whose night is still to be charged, as `roomNightsDue` answers it. */
export interface RoomNight {
  reservation_id: string; folio_id: string; room: string;
  rate: string; comp: boolean; routed: boolean;
  gst: string | null; tax: string | null;
}

/** The stays whose night of `date` is still to be charged: every one at the
    hotel (the audit's run), or `stayId` alone (check-in, the printed bill).
    The caller skips the complimentary ones. */
export async function roomNightsDue(
  client: Client, hotelId: string, date: string, stayId?: string,
): Promise<RoomNight[]> {
  const { rows } = await client.query<RoomNight>(
    `select r.id::text as reservation_id,
            /* WHERE THE CHARGE GOES, in one definition. A stay routed to
               its group posts to the master folio; everything else posts
               to its own. */
            app.folio_for_room_charge(r.id)::text as folio_id,
            coalesce(a.number, '-') as room,
            r.agreed_rate::text as rate,
            r.is_complimentary as comp,
            (r.route_room_to_group and r.group_id is not null) as routed,
            /* Read-only, for a caller that shows the charge before it is
               posted: null where the property has no GST rule for rooms. */
            app.gst_rate_or_null($1, 'room', r.agreed_rate)::text as gst,
            round(r.agreed_rate * app.gst_rate_or_null($1, 'room', r.agreed_rate)
                  / 100.0, 2)::text as tax
       from reservations r
       /* THE ROOM THIS STAY IS IN **TONIGHT**, and exactly one of them.

          ⚠ THIS WAS A PLAIN LEFT JOIN ON "released_at is null", WITH NO
          DATE, AND IT POSTED THE NIGHT TWICE.

          A room move does not release anything. It is modelled as two
          live assignments over adjoining half-open ranges - 302 for
          [5 Sep, 6 Sep), then 303 for [6 Sep, 10 Sep) - because both
          are true, on different nights. "released_at is null" is true
          of both, so one stay came back as TWO rows, the "not exists"
          guard below was evaluated once per row before either insert,
          and the loop inserted a room charge for each.

          One guest, one night, charged twice, every night for the rest
          of the stay. It was invisible here only because the one moved
          stay at Akkalkot happens to be complimentary, so the loop
          skips before posting and the miscount surfaced as
          "complimentary: 2" for a property with one complimentary
          room. Make that guest a paying one and it is money.

          The predicate is the half-open range this schema uses
          everywhere: "from <= D < to". LATERAL with "limit 1" on top,
          because a query that posts money must not depend on the data
          never producing an overlap - belt and braces are cheap here
          and a double charge on a guest's bill is not. */
       left join lateral (
         select rm.number
           from room_assignments ra
           join rooms rm on rm.id = ra.room_id
          where ra.reservation_id = r.id
            and ra.released_at is null
            and ra.from_date <= $2::date
            and (ra.to_date is null or ra.to_date > $2::date)
          order by ra.from_date desc
          limit 1
       ) a on true
      where ${POSTS_TONIGHT}${stayId ? "\n          and r.id = $3::uuid" : ""}
      order by a.number`,
    stayId ? [hotelId, date, stayId] : [hotelId, date],
  );
  return rows;
}

/** HOW MANY NIGHTS ARE STILL TO COME ON THE STAY'S OWN BILL (the review of
    1 October; FIN-24): its nights from the business date on that no room line
    pays for yet, by the run's own rule - so a night on the group's master and
    a night somebody reversed are not "to come". None for a room whose charge
    goes to its group's bill (the company pays it), a complimentary or day-use
    room, or a stay not booked or in house. The Bill tab counts nothing. */
export async function nightsToCome(client: Client, hotelId: string, stayId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n
       from reservations r
      cross join generate_series(greatest(r.check_in, app.business_date(r.hotel_id)),
                                 r.check_out - 1, interval '1 day') as night
      where r.hotel_id = $1 and r.id = $2
        and r.status in ('confirmed', 'checked_in')
        and not r.is_complimentary and not r.is_day_use
        and not exists (select 1 from folios m
                         where m.id = app.folio_for_room_charge(r.id) and m.group_id is not null)
        and not ${CHARGED("night::date")}`,
    [hotelId, stayId],
  );
  return rows[0]?.n ?? 0;
}

/** The line's words. The room number is on every line, and it has to be: a
    master folio holding twelve of these is unreadable otherwise. */
export const roomNightWords = (stay: RoomNight) => `Room ${stay.room} · 1 night`;

/** Post that night's charge and answer its amount. `source` is who wrote it:
    the audit's run, or the check-in (the first night). */
export async function postRoomNight(
  client: Client, hotelId: string, date: string, stay: RoomNight,
  source: "night_audit" | "check_in",
): Promise<number> {
  const amount = Number(stay.rate);

  await client.query(
    /* The rate and the tax it produces are BOTH derived here, from
       this room's own charge. Computing the rate in TypeScript and
       the amount in SQL is how the two stop agreeing. */
    `insert into folio_postings
       (hotel_id, folio_id, reservation_id, business_date, category,
        description, amount, tax_rate, tax_amount, source_type, posted_by)
     select $1::uuid, $2::uuid, $3::uuid, $4::date, 'room',
            $5::text, $6::numeric,
            t.rate, round($6::numeric * t.rate / 100.0, 2),
            $7::text, app.current_user_id()
       from (select app.gst_rate($1, 'room', $6::numeric) as rate) t`,
    [hotelId, stay.folio_id, stay.reservation_id, date,
     roomNightWords(stay),
     amount, source],
  );
  return amount;
}
