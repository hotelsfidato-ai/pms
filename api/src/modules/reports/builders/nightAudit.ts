import type { Client } from "../../../db.ts";
import {
  col, row, total, band, round2,
  type ReportDoc, type ReportRow, type ReportSection,
} from "../document.ts";
import { heading, stayNights, LIVE, type Property } from "../figures.ts";

/* ══════════════════════════════════════════════════════════════════
   NIGHT AUDIT — the printed report, in the owner's layout

   The property's proof of what happened on one day, in the order the
   eZee export prints it: the rooms charged, the complimentary rooms
   apart from them, who checked out, the day's sales by type, every
   receipt and its summary, the miscellaneous charges, the room and pax
   counts, and the restaurant.

   The audit itself belongs to the night-audit service and is not
   touched here: this reads the day it closed. A night's room charge is
   the one figures.ts derives, so this report and the Manager report
   cannot disagree about what a night earned.

   VAR % IS THE POINT OF THE FIRST TWO SECTIONS. It is the discount off
   the rack rate, negative and prominent, and it is how a manager sees
   a clerk giving rooms away. Where a room type carries no rack rate it
   is "-", never 0: nothing to compare against is not a discount of
   nothing.
   ══════════════════════════════════════════════════════════════════ */

const STAY_COLUMNS = [
  col("room", "Room", "text"),
  col("booking", "Booking", "text"),
  col("guest", "Guest", "text"),
  col("source", "Source", "text"),
  col("company", "Company", "text"),
  col("rentDate", "Rent Date", "date"),
  col("rateType", "Rate Type", "text"),
  col("normal", "Nrml. Tariff", "money"),
  col("offered", "Ofrd. Tariff", "money"),
  col("tax", "Total Tax", "money"),
  col("rent", "Total Rent", "money"),
  col("varPct", "Var %", "percent"),
  col("checkinBy", "Checkin By", "text"),
];

interface StayRow {
  id: string; reference: string; guest: string; room: string | null;
  room_type: string; base_rate: string | null; source: string | null;
  company: string | null; meal_plan: string | null; checkin_by: string | null; status: string;
  adults: number; children: number; check_in: string; check_out: string;
}

const roomLabel = (r: { room: string | null; room_type: string }) =>
  r.room ? `${r.room} - ${r.room_type}` : r.room_type;

/** The discount off the rack rate, or "-" when there is no rack rate. */
const variance = (offered: number, normal: number | null) =>
  normal === null || normal === 0 ? null : Math.round(((offered - normal) / normal) * 10000) / 100;

export async function nightAuditReport(
  client: Client, property: Property, asOn: string,
): Promise<ReportDoc> {
  const hotelId = property.id;
  const nights = await stayNights(client, hotelId, asOn);

  const { rows: stays } = await client.query<StayRow>(
    `select r.id::text as id, r.reference, g.full_name as guest,
            app.stay_room(r.id)                                   as room,
            rt.name                                               as room_type,
            rt.base_rate::text                                    as base_rate,
            app.booking_source_label(bs.name, co.name, r.source)  as source,
            co.name                                               as company,
            r.meal_plan, r.adults, r.children, r.status,
            to_char(r.check_in, 'YYYY-MM-DD')                     as check_in,
            to_char(r.check_out, 'YYYY-MM-DD')                    as check_out,
            (select app.colleague_name(al.actor, r.hotel_id)
               from audit_log al
              where al.table_name = 'reservations' and al.row_id = r.id::text
                and al.after->>'status' = 'checked_in'
                and coalesce(al.before->>'status', '') <> 'checked_in'
              order by al.at limit 1)                             as checkin_by
       from reservations r
       join guests g      on g.id  = r.guest_id
       join room_types rt on rt.id = r.room_type_id
       left join companies co       on co.id = r.company_id
       left join booking_sources bs on bs.id = r.booking_source_id
      where r.hotel_id = $1 and r.id = any($2::uuid[])`,
    [hotelId, nights.map((n) => n.reservationId)],
  );
  const stayById = new Map(stays.map((s) => [s.id, s]));

  const stayRow = (n: (typeof nights)[number]): ReportRow | null => {
    const s = stayById.get(n.reservationId);
    if (!s) return null;
    const normal = s.base_rate === null ? null : round2(Number(s.base_rate));
    return row({
      room: roomLabel(s),
      booking: s.reference,
      guest: s.guest,
      source: s.source,
      company: s.company,
      rentDate: asOn,
      rateType: s.meal_plan,
      normal,
      offered: n.rent,
      tax: n.tax,
      rent: round2(n.rent + n.tax),
      varPct: variance(n.rent, normal),
      checkinBy: s.checkin_by,
    });
  };

  const charged = nights.filter((n) => !n.complimentary).map(stayRow).filter(Boolean) as ReportRow[];
  const comped = nights.filter((n) => n.complimentary).map(stayRow).filter(Boolean) as ReportRow[];

  const totalsFor = (list: ReportRow[]): ReportRow => {
    const sum = (k: string) => round2(list.reduce((t, r) => t + Number(r.cells[k] ?? 0), 0));
    const normalKnown = list.filter((r) => r.cells["normal"] !== null);
    const normal = normalKnown.length
      ? round2(normalKnown.reduce((t, r) => t + Number(r.cells["normal"]), 0)) : null;
    const offered = sum("offered");
    return total({
      room: `Total (${list.length})`,
      booking: null, guest: null, source: null, company: null,
      rentDate: null, rateType: null,
      normal, offered, tax: sum("tax"), rent: sum("rent"),
      varPct: variance(offered, normal), checkinBy: null,
    });
  };

  /* ── Who left today ────────────────────────────────────────────────── */
  const { rows: departures } = await client.query<{
    room: string | null; room_type: string; guest: string; invoice: string | null;
    arrival: string | null; departure: string | null; nights: number;
    room_charges: string; extra: string; discount: string; tax: string;
    adjust: string; payment: string; balance: string;
  }>(
    `with live as (
       select fp.* from folio_postings fp
        where fp.hotel_id = $1 and ${LIVE}
     )
     select app.stay_room(r.id) as room, rt.name as room_type, g.full_name as guest,
            (select i.number from invoices i
              join folios f2 on f2.id = i.folio_id
             where f2.reservation_id = r.id and i.credits_id is null
             order by i.issued_at desc limit 1)                          as invoice,
            (select to_char(al.at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
               from audit_log al
              where al.table_name = 'reservations' and al.row_id = r.id::text
                and al.after->>'status' = 'checked_in'
                and coalesce(al.before->>'status', '') <> 'checked_in'
              order by al.at limit 1)                                    as arrival,
            (select to_char(al.at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
               from audit_log al
              where al.table_name = 'reservations' and al.row_id = r.id::text
                and al.after->>'status' = 'checked_out'
              order by al.at desc limit 1)                               as departure,
            (r.check_out - r.check_in)                                   as nights,
            coalesce((select sum(l.amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id and l.category = 'room'), 0)::text     as room_charges,
            coalesce((select sum(l.amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id
                         and l.category not in ('room','payment','discount','tax','refund')), 0)::text as extra,
            coalesce((select -sum(l.amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id and l.category = 'discount'), 0)::text  as discount,
            coalesce((select sum(l.tax_amount) + coalesce(sum(l.amount) filter (where l.category = 'tax'), 0)
                        from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id), 0)::text                              as tax,
            coalesce((select sum(l.amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id and l.category = 'refund'), 0)::text    as adjust,
            coalesce((select -sum(l.amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id and l.category = 'payment'), 0)::text   as payment,
            coalesce((select sum(l.amount + l.tax_amount) from live l join folios f on f.id = l.folio_id
                       where f.reservation_id = r.id), 0)::text                              as balance
       from reservations r
       join guests g on g.id = r.guest_id
       join room_types rt on rt.id = r.room_type_id
      where r.hotel_id = $1 and r.status = 'checked_out' and r.check_out = $2::date
      order by app.stay_room(r.id)`,
    [hotelId, asOn],
  );

  const outRows: ReportRow[] = departures.map((d) => row({
    room: roomLabel(d),
    guest: d.guest,
    invoice: d.invoice,
    arrival: d.arrival,
    departure: d.departure,
    nights: d.nights,
    roomCharges: round2(Number(d.room_charges)),
    extra: round2(Number(d.extra)),
    discount: round2(Number(d.discount)),
    tax: round2(Number(d.tax)),
    adjust: round2(Number(d.adjust)),
    payment: round2(Number(d.payment)),
    balance: round2(Number(d.balance)),
  }));
  if (outRows.length) {
    const sum = (k: string) => round2(outRows.reduce((t, r) => t + Number(r.cells[k] ?? 0), 0));
    outRows.push(total({
      room: `Total (${outRows.length})`, guest: null, invoice: null, arrival: null,
      departure: null, nights: sum("nights"),
      roomCharges: sum("roomCharges"), extra: sum("extra"), discount: sum("discount"),
      tax: sum("tax"), adjust: sum("adjust"), payment: sum("payment"), balance: sum("balance"),
    }));
  }

  /* ── The day's sales, by type ──────────────────────────────────────── */
  const { rows: sales } = await client.query<Record<string, string>>(
    `select case
              when f.event_id is not null                              then 'incidental'
              when coalesce(fp.reservation_id, f.reservation_id) is null then 'direct'
              when fp.description = 'Late check-out'                   then 'late'
              when fp.description like 'Retention%no-show'             then 'no_show'
              when r.check_out = r.check_in                            then 'day_use'
              else 'room' end                                          as kind,
            /* Discounts and refunds keep their own signs; the columns
               below split them out by category. */
            sum(fp.amount)::text                                       as amount,
            sum(fp.tax_amount)::text                                   as tax,
            sum(fp.amount) filter (where fp.category = 'room')::text   as room,
            sum(fp.amount) filter (where fp.category = 'discount')::text as discount,
            sum(fp.amount) filter (where fp.category = 'refund')::text as refund,
            sum(fp.tax_amount) filter (where fp.category = 'room')::text as room_tax,
            sum(fp.amount) filter (where fp.category = 'tax')::text    as tax_line
       from folio_postings fp
       join folios f on f.id = fp.folio_id
       left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
      where fp.hotel_id = $1 and ${LIVE}
        and fp.category <> 'payment'
        and fp.business_date = $2::date
      group by 1`,
    [hotelId, asOn],
  );

  const salesBy = new Map(sales.map((s) => [s["kind"]!, s]));
  const part = (kind: string, key: string) => round2(Number(salesBy.get(kind)?.[key] ?? 0));

  /* The night's room rent is what the rooms earned tonight, whatever day
     the desk posted it on (D17-71) — so Room Sales carries that, not the
     postings dated today. */
  const nightRent = round2(nights.reduce((t, x) => t + x.rent, 0));
  const nightTax = round2(nights.reduce((t, x) => t + x.tax, 0));

  const salesRow = (label: string, v: {
    room: number; extra: number; roomTax: number; extraTax: number;
    discount: number; adjustment: number;
  }) => row({
    salesType: label,
    room: v.room, extra: v.extra, roomTax: v.roomTax, extraTax: v.extraTax,
    discount: v.discount, adjustment: v.adjustment,
    totalSales: round2(v.room + v.extra + v.roomTax + v.extraTax + v.discount + v.adjustment),
  });

  const extraOf = (kind: string) => round2(
    Number(salesBy.get(kind)?.["amount"] ?? 0)
      - Number(salesBy.get(kind)?.["room"] ?? 0)
      - Number(salesBy.get(kind)?.["discount"] ?? 0)
      - Number(salesBy.get(kind)?.["refund"] ?? 0));
  const taxOf = (kind: string) => round2(
    Number(salesBy.get(kind)?.["tax"] ?? 0)
      - Number(salesBy.get(kind)?.["room_tax"] ?? 0)
      + Number(salesBy.get(kind)?.["tax_line"] ?? 0));

  const salesRows: ReportRow[] = [
    salesRow("Room Sales", {
      room: nightRent, extra: extraOf("room"), roomTax: nightTax, extraTax: taxOf("room"),
      discount: part("room", "discount"), adjustment: part("room", "refund"),
    }),
    salesRow("Direct Room Sales", {
      room: part("direct", "room"), extra: extraOf("direct"),
      roomTax: part("direct", "room_tax"), extraTax: taxOf("direct"),
      discount: part("direct", "discount"), adjustment: part("direct", "refund"),
    }),
    /* Nothing in this system charges a cancellation fee, so there is
       nothing to count: "-", never 0 (the owner, D17-97). */
    row({
      salesType: "Cancellation Sales",
      room: null, extra: null, roomTax: null, extraTax: null,
      discount: null, adjustment: null, totalSales: null,
    }),
    salesRow("No Show Sales", {
      room: 0, extra: extraOf("no_show"), roomTax: 0, extraTax: taxOf("no_show"),
      discount: 0, adjustment: 0,
    }),
    salesRow("Day Use Sales", {
      room: part("day_use", "room"), extra: extraOf("day_use"),
      roomTax: part("day_use", "room_tax"), extraTax: taxOf("day_use"),
      discount: part("day_use", "discount"), adjustment: part("day_use", "refund"),
    }),
    salesRow("Late Checkout Sales", {
      room: 0, extra: extraOf("late"), roomTax: 0, extraTax: taxOf("late"),
      discount: 0, adjustment: 0,
    }),
    salesRow("Incidental Sales", {
      room: part("incidental", "room"), extra: extraOf("incidental"),
      roomTax: part("incidental", "room_tax"), extraTax: taxOf("incidental"),
      discount: part("incidental", "discount"), adjustment: part("incidental", "refund"),
    }),
  ];
  const salesTotal = (k: string) => round2(salesRows.reduce((t, r) => t + Number(r.cells[k] ?? 0), 0));
  salesRows.push(total({
    salesType: "Total", room: salesTotal("room"), extra: salesTotal("extra"),
    roomTax: salesTotal("roomTax"), extraTax: salesTotal("extraTax"),
    discount: salesTotal("discount"), adjustment: salesTotal("adjustment"),
    totalSales: salesTotal("totalSales"),
  }));

  /* ── Every receipt, by how it was paid ─────────────────────────────── */
  const { rows: receipts } = await client.query<{
    id: string; method: string; amount: string; reference: string | null;
    room: string | null; booking: string | null; user_name: string | null;
    entered_on: string; remark: string | null;
  }>(
    `select fp.id::text, coalesce(p.method, 'unrecorded') as method,
            (-fp.amount)::text as amount,
            r.reference as booking, app.stay_room(r.id) as room,
            app.posted_by_name(fp.id) as user_name,
            to_char(fp.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as entered_on,
            p.reference as remark
       from folio_postings fp
       join folios f on f.id = fp.folio_id
       left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
       left join payments p on p.posting_id = fp.id
      where fp.hotel_id = $1 and ${LIVE}
        and fp.category = 'payment'
        and coalesce(p.method, '') <> 'city_ledger'
        and fp.business_date = $2::date
      order by coalesce(p.method, 'unrecorded'), fp.id`,
    [hotelId, asOn],
  );

  const METHOD_LABEL: Record<string, string> = {
    cash: "Cash", card: "Card", upi: "UPI", netbanking: "Net Banking",
    wallet: "Wallet", cheque: "Cheque", bank_transfer: "Bank Transfer",
    unrecorded: "Method not recorded",
  };
  const receiptRows: ReportRow[] = [];
  const byMethod = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const method of [...new Set(receipts.map((r) => r.method))]) {
    receiptRows.push(band("date", METHOD_LABEL[method] ?? method));
    let sum = 0;
    for (const r of receipts.filter((x) => x.method === method)) {
      const amount = round2(Number(r.amount));
      sum += amount;
      byUser.set(r.user_name ?? "-", round2((byUser.get(r.user_name ?? "-") ?? 0) + amount));
      receiptRows.push(row({
        date: asOn,
        receipt: r.id,
        reference: r.booking ? `Front desk ${r.booking}${r.room ? `, Room ${r.room}` : ""}` : null,
        amount,
        user: r.user_name,
        enteredOn: r.entered_on,
        remark: r.remark,
      }));
    }
    byMethod.set(METHOD_LABEL[method] ?? method, round2(sum));
    receiptRows.push(total({
      date: null, receipt: null, reference: "Total", amount: round2(sum),
      user: null, enteredOn: null, remark: null,
    }));
  }
  const grandTotal = round2([...byMethod.values()].reduce((t, v) => t + v, 0));
  if (receiptRows.length) {
    receiptRows.push(total({
      date: null, receipt: null, reference: "Grand Total", amount: grandTotal,
      user: null, enteredOn: null, remark: null,
    }));
  }

  /* ── Charges that are not the room ─────────────────────────────────── */
  const { rows: misc } = await client.query<{
    id: string; room: string | null; booking: string | null; guest: string | null;
    description: string; amount: string; entered_on: string; outlet: string | null;
    order_no: string | null;
  }>(
    `select fp.id::text, app.stay_room(r.id) as room, r.reference as booking,
            g.full_name as guest, fp.description,
            (fp.amount + fp.tax_amount)::text as amount,
            to_char(fp.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as entered_on,
            ou.name as outlet, o.order_no
       from folio_postings fp
       join folios f on f.id = fp.folio_id
       left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
       left join guests g on g.id = r.guest_id
       left join pos_orders o on fp.source_type = 'pos' and o.id = fp.source_id
       left join pos_outlets ou on ou.id = o.outlet_id
      where fp.hotel_id = $1 and ${LIVE}
        and fp.category not in ('room', 'payment', 'discount', 'tax', 'refund')
        and fp.business_date = $2::date
      order by fp.id`,
    [hotelId, asOn],
  );
  const miscRows: ReportRow[] = misc.map((m) => row({
    room: m.room ? m.room : null,
    booking: m.booking,
    guest: m.guest,
    chargeDate: asOn,
    voucher: m.id,
    charge: m.description,
    unitPrice: round2(Number(m.amount)),
    qty: 1,
    amount: round2(Number(m.amount)),
    enteredOn: m.entered_on,
    remark: m.outlet ? `Outlet: ${m.outlet}${m.order_no ? `, Order ${m.order_no}` : ""}` : null,
  }));
  if (miscRows.length) {
    miscRows.push(total({
      room: `Total (${miscRows.length})`, booking: null, guest: null, chargeDate: null,
      voucher: null, charge: null, unitPrice: null,
      qty: miscRows.length,
      amount: round2(miscRows.reduce((t, r) => t + Number(r.cells["amount"] ?? 0), 0)),
      enteredOn: null, remark: null,
    }));
  }

  /* ── The house, and the people in it ───────────────────────────────── */
  const { rows: [house] } = await client.query<Record<string, string>>(
    `select
       (select count(*) from rooms where hotel_id = $1 and is_active)::text     as rooms,
       app.sellable_rooms($1, $2::date)::text                                   as sellable,
       (select count(*) from reservations r where r.hotel_id = $1
          and r.status = 'checked_in' and r.check_out = $2::date)::text         as due_out,
       (select count(*) from reservations r where r.hotel_id = $1
          and r.status = 'checked_out' and r.check_out = $2::date)::text        as departed,
       (select count(*) from reservations r where r.hotel_id = $1
          and r.status = 'confirmed' and r.check_in = $2::date)::text           as reserved,
       ${["checked_in", "checked_out"].map((s, i) => `
       (select count(*) from reservations r where r.hotel_id = $1
          and r.status = '${s}' and r.check_in = $2::date)::text                as arrived_${i},
       (select coalesce(sum(r.adults), 0) from reservations r where r.hotel_id = $1
          and r.status = '${s}' and r.check_in = $2::date)::text                as arrived_adults_${i},
       (select coalesce(sum(r.children), 0) from reservations r where r.hotel_id = $1
          and r.status = '${s}' and r.check_in = $2::date)::text                as arrived_children_${i}`).join(",")},
       (select coalesce(sum(r.adults), 0) from reservations r where r.hotel_id = $1
          and r.status = 'checked_out' and r.check_out = $2::date)::text        as left_adults,
       (select coalesce(sum(r.children), 0) from reservations r where r.hotel_id = $1
          and r.status = 'checked_out' and r.check_out = $2::date)::text        as left_children`,
    [hotelId, asOn],
  );
  const h = (k: string) => Number(house![k] ?? 0);

  /* Occupied is who has CHECKED IN (D17-10), the one definition every
     screen uses. A booking for tonight that nobody has arrived on is
     Reserve, not an occupied room. */
  const occupied = nights.filter((n) => {
    const s = stayById.get(n.reservationId);
    return s?.status === "checked_in" || s?.status === "checked_out";
  }).length;
  const blocked = Math.max(0, h("rooms") - h("sellable"));
  const statusRows: ReportRow[] = [row({
    date: asOn,
    rooms: h("rooms"),
    occupied,
    dueOut: h("due_out"),
    vacant: Math.max(0, h("rooms") - occupied - blocked),
    departed: h("departed"),
    reserved: h("reserved"),
    blocked,
  })];

  const staying = nights
    .map((n) => stayById.get(n.reservationId))
    .filter((s): s is StayRow => Boolean(s));
  const arrivedRooms = h("arrived_0") + h("arrived_1");
  const stayover = staying.filter((s) => s.check_in < asOn);
  const paxRows: ReportRow[] = [
    row({ status: "Arrived", rooms: arrivedRooms,
          adults: h("arrived_adults_0") + h("arrived_adults_1"),
          children: h("arrived_children_0") + h("arrived_children_1") }),
    row({ status: "Checked Out", rooms: h("departed"),
          adults: h("left_adults"), children: h("left_children") }),
    row({ status: "Stayover", rooms: stayover.length,
          adults: stayover.reduce((t, s) => t + s.adults, 0),
          children: stayover.reduce((t, s) => t + s.children, 0) }),
  ];

  const plans = [...new Set(staying.map((s) => s.meal_plan ?? "-"))].sort();
  const analysisRows: ReportRow[] = plans.map((plan) => {
    const mine = staying.filter((s) => (s.meal_plan ?? "-") === plan);
    return row({
      rateType: plan,
      adults: mine.reduce((t, s) => t + s.adults, 0),
      children: mine.reduce((t, s) => t + s.children, 0),
    });
  });

  /* ── The restaurant, on the day ────────────────────────────────────── */
  const pos = await posDay(client, hotelId, asOn);

  const sections: ReportSection[] = [
    { key: "room-charges", title: "Room Charges", columns: STAY_COLUMNS,
      rows: charged.length ? [...charged, totalsFor(charged)] : [],
      empty: "No room was charged for this night." },
    { key: "complimentary", title: "Complimentary", columns: STAY_COLUMNS,
      rows: comped.length ? [...comped, totalsFor(comped)] : [],
      empty: "No room was given free on this night." },
    { key: "checked-out", title: "Checked Out",
      columns: [
        col("room", "Room", "text"), col("guest", "Guest", "text"),
        col("invoice", "Invoice No", "text"),
        col("arrival", "Arrival", "datetime"), col("departure", "Departure", "datetime"),
        col("nights", "Nights", "count"),
        col("roomCharges", "Room Charges", "money"), col("extra", "Extra Charges", "money"),
        col("discount", "Discount", "money"), col("tax", "Tax", "money"),
        col("adjust", "Adjust", "money"), col("payment", "Payment", "money"),
        col("balance", "Balance", "money"),
      ],
      rows: outRows,
      empty: "Nobody checked out on this day.",
      note: "A balance may be negative: the guest paid more than the bill came to." },
    { key: "daily-sales", title: "Daily Sales",
      columns: [
        col("salesType", "Sales Type", "text"),
        col("room", "Room Charges", "money"), col("extra", "Extra Charges", "money"),
        col("roomTax", "Room Tax", "money"), col("extraTax", "Extra Tax", "money"),
        col("discount", "Discount", "money"), col("adjustment", "Adjustment", "money"),
        col("totalSales", "Total Sales", "money"),
      ],
      rows: salesRows },
    { key: "receipt-detail", title: "Receipt - Detail",
      columns: [
        col("date", "Date", "date"), col("receipt", "Receipt", "text"),
        col("reference", "Reference", "text"), col("amount", "Amount", "money"),
        col("user", "User", "text"), col("enteredOn", "Entered On", "datetime"),
        col("remark", "Remark", "text"),
      ],
      rows: receiptRows,
      empty: "No money was taken on this day." },
    { key: "receipt-by-user", title: "Receipt - Summary by user",
      columns: [col("user", "User", "text"), col("amount", "Amount", "money")],
      rows: summaryRows(byUser, "user") },
    { key: "receipt-by-method", title: "Receipt - Summary by payment method",
      columns: [col("method", "Pay Method", "text"), col("amount", "Amount", "money")],
      rows: summaryRows(byMethod, "method") },
    { key: "misc-charges", title: "Misc. Charges",
      columns: [
        col("room", "Room", "text"), col("booking", "Booking", "text"),
        col("guest", "Guest", "text"), col("chargeDate", "Charge Date", "date"),
        col("voucher", "Voucher No", "text"), col("charge", "Charge", "text"),
        col("unitPrice", "Unit Price", "money"), col("qty", "Unit (Q'ty)", "count"),
        col("amount", "Amount", "money"), col("enteredOn", "Entered On", "datetime"),
        col("remark", "Remark", "text"),
      ],
      rows: miscRows,
      empty: "Nothing but the rooms was charged on this day." },
    { key: "room-status", title: "Room Status",
      columns: [
        col("date", "Date", "date"), col("rooms", "Total Rooms", "count"),
        col("occupied", "Occupied", "count"), col("dueOut", "Due Out", "count"),
        col("vacant", "Vacant", "count"), col("departed", "Departed", "count"),
        col("reserved", "Reserve", "count"), col("blocked", "Blocked", "count"),
      ],
      rows: statusRows },
    { key: "pax-status", title: "Pax Status",
      columns: [
        col("status", "Status", "text"), col("rooms", "Rooms", "count"),
        col("adults", "Adult", "count"), col("children", "Child", "count"),
      ],
      rows: paxRows },
    { key: "pax-analysis", title: "Pax Analysis",
      columns: [
        col("rateType", "Rate Type", "text"),
        col("adults", "Adult", "count"), col("children", "Child", "count"),
      ],
      rows: analysisRows,
      empty: "Nobody was in the house on this night." },
    { key: "pos-summary", title: "POS Summary",
      columns: [
        col("outlet", "Outlets", "text"), col("sales", "POS Sales", "money"),
        col("charges", "Charges", "money"), col("tax", "Tax", "money"),
        col("itemDiscount", "Item Discount", "money"), col("orderDiscount", "Order Discount", "money"),
        col("roundOff", "Round Off", "money"), col("tips", "Tips", "money"),
        col("total", "Total", "money"), col("payments", "Payments", "money"),
        col("posting", "Posting", "money"),
      ],
      rows: pos.summary,
      empty: "The restaurant took nothing on this day.",
      note: "Charges, item discounts and tips are not recorded in this system and show \"-\"." },
    { key: "pos-payment-summary", title: "POS Payment Summary",
      columns: [
        col("method", "Pay Method", "text"), col("outlet", "Outlet", "text"),
        col("amount", "Amount", "money"),
      ],
      rows: pos.payments,
      empty: "No restaurant bill was settled on this day." },
  ];

  return {
    report: "night-audit",
    title: "Night audit report",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "As On Date", value: asOn, kind: "date" }],
    sections,
    footnotes: [
      "Var % is the discount off the rack rate. A room type with no rack rate shows \"-\".",
      "A night's room charge is shown on the night it pays for, whatever day it was posted (the owner, 17 September).",
      "A bill transferred to a company is not a receipt; it is on the Manager report as Charges Raised.",
      "A \"-\" means the figure is not held in this system. It is not a zero.",
    ],
  };
}

function summaryRows(by: Map<string, number>, key: string): ReportRow[] {
  const rows: ReportRow[] = [...by.entries()].map(([label, amount]) =>
    row({ [key]: label, amount }));
  if (rows.length) {
    rows.push(total({
      [key]: "Total",
      amount: round2([...by.values()].reduce((t, v) => t + v, 0)),
    }));
  }
  return rows;
}

/* ── The restaurant's day ──────────────────────────────────────────── */

async function posDay(client: Client, hotelId: string, asOn: string) {
  const settled = `o.hotel_id = $1 and o.status = 'settled' and o.business_date = $2::date`;
  const [{ rows: totals }, { rows: tenders }] = await Promise.all([
    /* Per rate for the money, per ORDER for the round-off: joining the
       rate breakdown would count a bill's round-off once per tax rate. */
    client.query<{
      outlet: string; net: string; discount: string; tax: string; round_off: string;
    }>(
      `with by_rate as (
         select o.outlet_id,
                coalesce(sum(r.rate_net), 0) as net,
                coalesce(sum(r.discount), 0) as discount,
                coalesce(sum(r.tax), 0)      as tax
           from pos_orders o
           cross join lateral app.pos_order_by_rate(o.id) r
          where ${settled}
          group by o.outlet_id
       ),
       by_order as (
         select o.outlet_id, coalesce(sum(o.round_off), 0) as round_off
           from pos_orders o where ${settled} group by o.outlet_id
       )
       select ou.name as outlet, by_rate.net::text, by_rate.discount::text,
              by_rate.tax::text, by_order.round_off::text
         from by_rate
         join by_order on by_order.outlet_id = by_rate.outlet_id
         join pos_outlets ou on ou.id = by_rate.outlet_id
        order by ou.name`, [hotelId, asOn]),
    client.query<{ outlet: string; method: string; amount: string }>(
      `select ou.name as outlet, t.method, sum(t.amount)::text as amount
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         join pos_order_tenders t on t.order_id = o.id
        where ${settled}
        group by 1, 2`, [hotelId, asOn]),
  ]);

  const summary: ReportRow[] = [];
  for (const t of totals) {
    const net = round2(Number(t.net));
    const discount = round2(Number(t.discount));
    const tax = round2(Number(t.tax));
    const roundOff = round2(Number(t.round_off));
    const paid = tenders.filter((x) => x.outlet === t.outlet);
    const takings = round2(paid.filter((x) => x.method !== "room" && x.method !== "function")
      .reduce((s, x) => s + Number(x.amount), 0));
    const posting = round2(paid.filter((x) => x.method === "room" || x.method === "function")
      .reduce((s, x) => s + Number(x.amount), 0));
    summary.push(row({
      outlet: t.outlet,
      sales: net,
      /* Service charges, item discounts and tips are not recorded here. */
      charges: null,
      tax,
      itemDiscount: null,
      orderDiscount: -discount,
      roundOff,
      tips: null,
      total: round2(net - discount + tax + roundOff),
      payments: takings,
      posting,
    }));
  }
  if (summary.length) {
    const sum = (k: string) => round2(summary.reduce((s, r) => s + Number(r.cells[k] ?? 0), 0));
    summary.push(total({
      outlet: "Total", sales: sum("sales"), charges: null, tax: sum("tax"),
      itemDiscount: null, orderDiscount: sum("orderDiscount"), roundOff: sum("roundOff"),
      tips: null, total: sum("total"), payments: sum("payments"), posting: sum("posting"),
    }));
  }

  const POS_LABEL: Record<string, string> = {
    cash: "Cash", card: "Card", upi: "UPI", room: "Room Posting", function: "Function",
  };
  const payments: ReportRow[] = [];
  for (const m of [...new Set(tenders.map((t) => t.method))]) {
    payments.push(band("method", POS_LABEL[m] ?? m));
    let sum = 0;
    for (const t of tenders.filter((x) => x.method === m)) {
      sum += Number(t.amount);
      payments.push(row({ method: null, outlet: t.outlet, amount: round2(Number(t.amount)) }));
    }
    payments.push(total({ method: null, outlet: "Total", amount: round2(sum) }));
  }

  return { summary, payments };
}
