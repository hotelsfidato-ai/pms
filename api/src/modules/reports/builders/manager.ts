import type { Client } from "../../../db.ts";
import {
  col, row, total, band, round2, pct, ratio,
  type ReportDoc, type ReportRow, type ReportSection, type Cell, type CellKind,
} from "../document.ts";
import {
  dailyFigures, sumDays, heading, firstTradingDay, LIVE,
  type Property, type DayFigures,
} from "../figures.ts";
import { countedFrom } from "./statistics.ts";

/* ══════════════════════════════════════════════════════════════════
   MANAGER REPORT — the daily flash, in the owner's eZee layout

   Today · PTD · YTD throughout, in the export's order: Room Charges,
   Extra Charges, Tax, the revenue lines, Payment, City Ledger, Advance
   Deposit Ledger, Guest Ledger, Room Summary, Statistics, POS Summary,
   POS Payment Summary, Revenue Summary. PTD is the report's own month;
   YTD runs from the 1 April on or before the report's date (REP-2).

   Where each figure comes from, once:
     room charges, sold, available, guests   dailyFigures() (figures.ts):
         a night's charge on its night; a complimentary room sold
     extra charges       postings that are neither room nor money, by
         what the desk wrote on them; the restaurant's own postings are
         "POS to PMS Posting", never extra charges counted twice
     payment             money received, by method. A bill transferred to
         the city ledger is not money received (D17-74)
     city ledger         Charges Raised = bills transferred; the rest "-"
         until a company's payment is recorded (D17-74, D17-75)
     advance deposit     money taken on a booking before its arrival day
     guest ledger        every bill's balance, less deposits still waiting
         for their guest; the formulas the export prints hold exactly
     POS                 settled orders, through app.pos_order_by_rate:
         the till's own arithmetic, so the two cannot disagree

   eZee prints the two ledgers for today only; PTD and YTD are "-" there.
   ══════════════════════════════════════════════════════════════════ */

/** The first day of the Indian financial year the date falls in (REP-2). */
export function financialYearStart(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${month >= 4 ? year : year - 1}-04-01`;
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

interface Windows { today: string; ptd: string; ytd: string; asOn: string }
type Three = { today: Cell; ptd: Cell; ytd: Cell };

/** A figure per day → the three columns. */
function threeOf(w: Windows, byDate: Map<string, number>): { today: number; ptd: number; ytd: number } {
  let today = 0, ptd = 0, ytd = 0;
  for (const [date, v] of byDate) {
    if (date < w.ytd || date > w.asOn) continue;
    ytd += v;
    if (date >= w.ptd) ptd += v;
    if (date === w.today) today += v;
  }
  return { today: round2(today), ptd: round2(ptd), ytd: round2(ytd) };
}

const line = (label: string, v: Three, extra: { unit?: CellKind; indent?: 0 | 1 | 2 | 3 } = {}): ReportRow =>
  row({ label, today: v.today, ptd: v.ptd, ytd: v.ytd }, extra);
const sumLine = (label: string, v: Three, unit?: CellKind): ReportRow =>
  total({ label, today: v.today, ptd: v.ptd, ytd: v.ytd }, unit ? { unit } : {});
const add = (...xs: Array<{ today: number; ptd: number; ytd: number }>) => ({
  today: round2(xs.reduce((t, x) => t + x.today, 0)),
  ptd: round2(xs.reduce((t, x) => t + x.ptd, 0)),
  ytd: round2(xs.reduce((t, x) => t + x.ytd, 0)),
});
const TODAY_ONLY = (today: number): Three => ({ today, ptd: null, ytd: null });
const NOT_HELD: Three = { today: null, ptd: null, ytd: null };

const COLUMNS = [
  col("label", "Particulars", "text"),
  col("today", "Today", "money"),
  col("ptd", "PTD", "money"),
  col("ytd", "YTD", "money"),
];

const section = (key: string, title: string, rows: ReportRow[]): ReportSection =>
  ({ key, title, columns: COLUMNS, rows });

/* The kinds of extra charge, in the order the export lists its own. */
const EXTRA_KINDS: Array<[string, string]> = [
  ["late", "Late Check-out Fee"],
  ["early", "Early Check-in Fee"],
  ["no_show", "No-show retention"],
  ["food", "Food"],
  ["beverage", "Beverage"],
  ["laundry", "Laundry"],
  ["spa", "Spa"],
  ["minibar", "Minibar"],
  ["telephone", "Telephone"],
  ["misc", "Miscellaneous"],
];

const PAY_METHODS: Array<[string, string, boolean]> = [
  // [method, label, always printed]
  ["cash", "Cash", true],
  ["upi", "UPI", true],
  /* One row until Finance records credit and debit cards apart (D17-73). */
  ["card", "Card", true],
  ["netbanking", "Net Banking", false],
  ["wallet", "Wallet", false],
  ["cheque", "Cheque", false],
  ["bank_transfer", "Bank Transfer", false],
];

const POS_METHODS: Array<[string, string]> = [
  ["cash", "Payment - Cash"],
  ["card", "Payment - Card"],
  ["upi", "Payment - UPI"],
  ["room", "Payment - Room Posting"],
  ["function", "Payment - Function"],
];

const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export async function managerReport(
  client: Client, property: Property, asOn: string,
): Promise<ReportDoc> {
  const hotelId = property.id;
  const w: Windows = { today: asOn, ptd: monthStart(asOn), ytd: financialYearStart(asOn), asOn };

  /* ── Rooms, nights, guests ─────────────────────────────────────────── */
  const days = await dailyFigures(client, hotelId, w.ytd, asOn);
  const opened = await firstTradingDay(client, hotelId);
  const pick = (from: string) => sumDays(days.filter((d) => d.date >= from));
  const t = { today: pick(w.today), ptd: pick(w.ptd), ytd: pick(w.ytd) };
  const of = (f: (x: Omit<DayFigures, "date">) => number) =>
    ({ today: round2(f(t.today)), ptd: round2(f(t.ptd)), ytd: round2(f(t.ytd)) });

  /* ── Everything posted that is neither a room nor money ────────────── */
  const { rows: posted } = await client.query<{
    date: string; bucket: string; amount: string; tax: string;
  }>(
    `select to_char(fp.business_date, 'YYYY-MM-DD') as date,
            case when fp.source_type = 'pos'                        then 'pos'
                 when fp.category = 'discount'                      then 'discount'
                 when fp.category = 'tax'                           then 'tax_line'
                 when fp.category = 'refund'                        then 'refund'
                 when fp.description = 'Early check-in'             then 'early'
                 when fp.description = 'Late check-out'             then 'late'
                 when fp.description like 'Retention%no-show'       then 'no_show'
                 else fp.category end                               as bucket,
            sum(fp.amount)::text                                    as amount,
            sum(fp.tax_amount)::text                                as tax
       from folio_postings fp
      where fp.hotel_id = $1
        and fp.category not in ('room', 'payment')
        and ${LIVE}
        and fp.business_date between $2::date and $3::date
      group by 1, 2`,
    [hotelId, w.ytd, asOn],
  );
  const amountBy = new Map<string, Map<string, number>>();
  const taxBy = new Map<string, Map<string, number>>();
  for (const p of posted) {
    if (!amountBy.has(p.bucket)) { amountBy.set(p.bucket, new Map()); taxBy.set(p.bucket, new Map()); }
    bump(amountBy.get(p.bucket)!, p.date, Number(p.amount));
    bump(taxBy.get(p.bucket)!, p.date, Number(p.tax));
  }
  const bucket = (k: string) => threeOf(w, amountBy.get(k) ?? new Map());
  const bucketTax = (k: string) => threeOf(w, taxBy.get(k) ?? new Map());

  /* ── Money received, and bills transferred to the city ledger ──────── */
  const { rows: paid } = await client.query<{ date: string; method: string; amount: string }>(
    `select to_char(fp.business_date, 'YYYY-MM-DD') as date,
            coalesce(p.method, 'unrecorded')         as method,
            (-sum(fp.amount))::text                  as amount
       from folio_postings fp
       left join payments p on p.posting_id = fp.id
      where fp.hotel_id = $1
        and fp.category = 'payment'
        and ${LIVE}
        and fp.business_date between $2::date and $3::date
      group by 1, 2`,
    [hotelId, w.ytd, asOn],
  );
  const payBy = new Map<string, Map<string, number>>();
  for (const p of paid) {
    if (!payBy.has(p.method)) payBy.set(p.method, new Map());
    bump(payBy.get(p.method)!, p.date, Number(p.amount));
  }
  const method = (k: string) => threeOf(w, payBy.get(k) ?? new Map());

  /* ── The two ledgers, for today ────────────────────────────────────── */
  const { rows: [ledgers] } = await client.query<Record<string, string>>(
    `with pay as (
       select fp.business_date, -fp.amount as amount, r.check_in,
              exists (select 1 from payments p
                       where p.posting_id = fp.id and p.method = 'city_ledger') as transfer
         from folio_postings fp
         join folios f on f.id = fp.folio_id
         left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
        where fp.hotel_id = $1 and fp.category = 'payment' and ${LIVE}
          and fp.business_date <= $2::date
     ),
     deposit as (
       select * from pay
        where not transfer and check_in is not null and business_date < check_in
     ),
     everything as (
       select fp.business_date, fp.category, fp.amount + fp.tax_amount as movement
         from folio_postings fp
        where fp.hotel_id = $1 and ${LIVE} and fp.business_date <= $2::date
     )
     select
       coalesce((select sum(amount) from deposit where business_date <  $2::date and check_in >= $2::date), 0)::text as adv_opening,
       coalesce((select sum(amount) from deposit where business_date =  $2::date), 0)::text                          as adv_collected,
       coalesce((select sum(amount) from deposit where business_date <  $2::date and check_in =  $2::date), 0)::text as adv_transfer,
       coalesce((select sum(amount) from deposit where business_date <= $2::date and check_in >  $2::date), 0)::text as adv_closing,
       coalesce((select sum(movement) from everything where business_date < $2::date), 0)::text                   as before,
       coalesce((select sum(movement) from everything where business_date = $2::date and category <> 'payment'), 0)::text as charged,
       coalesce((select sum(amount) from pay where business_date = $2::date), 0)::text                             as paid_today`,
    [hotelId, asOn],
  );
  const L = Object.fromEntries(Object.entries(ledgers!).map(([k, v]) => [k, round2(Number(v))]));
  const glOpening = round2(L["before"]! + L["adv_opening"]!);
  const glSettlement = round2(L["paid_today"]! - L["adv_collected"]!);
  const glClosing = round2(glOpening - L["adv_transfer"]! + L["charged"]! - glSettlement);

  /* ── Rooms that are not sold, and the bookings made ────────────────── */
  const { rows: [counts] } = await client.query<Record<string, string>>(
    `with win as (select $2::date as today, $3::date as ptd, $4::date as ytd)
     select
       ${["today", "ptd", "ytd"].map((k) => `
       (select count(*) from reservations r, win
         where r.hotel_id = $1 and r.status = 'no_show'
           and r.check_in between win.${k} and win.today)::text as no_show_${k},
       (select count(*) from reservations r, win
         where r.hotel_id = $1 and r.is_complimentary and r.check_out = r.check_in
           and r.status in ('confirmed','checked_in','checked_out')
           and r.check_in between win.${k} and win.today)::text as comp_day_use_${k},
       (select count(*) from reservations r, win
         where r.hotel_id = $1
           and r.status in ('confirmed','checked_in','checked_out','no_show')
           and (r.created_at at time zone $5)::date between win.${k} and win.today)::text as confirmed_${k},
       (select count(*) from reservations r, win
         where r.hotel_id = $1 and r.status = 'tentative'
           and (r.created_at at time zone $5)::date between win.${k} and win.today)::text as unconfirmed_${k},
       (select count(*) from reservations r
          left join booking_sources bs on bs.id = r.booking_source_id, win
         where r.hotel_id = $1
           and r.status in ('checked_in','checked_out')
           and (r.source = 'walk_in' or bs.kind = 'walk_in')
           and r.check_in between win.${k} and win.today)::text as walk_ins_${k}`).join(",")}`,
    [hotelId, w.today, w.ptd, w.ytd, property.timezone],
  );
  const n = (k: string) => Number(counts![k]);
  const counted = (k: string): Three => ({ today: n(`${k}_today`), ptd: n(`${k}_ptd`), ytd: n(`${k}_ytd`) });

  /* ── The restaurant ────────────────────────────────────────────────── */
  const pos = await posFigures(client, hotelId, w);

  /* ══ The sections ══════════════════════════════════════════════════ */

  const roomCharges = of((x) => x.room);
  const cancellation = { today: 0, ptd: 0, ytd: 0 };  // nothing here charges a cancellation fee
  const roomTotal = add(roomCharges, cancellation);

  const extraRows: ReportRow[] = [];
  const extras: Array<{ today: number; ptd: number; ytd: number }> = [];
  for (const [key, label] of EXTRA_KINDS) {
    const v = bucket(key);
    extras.push(v);
    extraRows.push(line(label, v));
  }
  const discount = bucket("discount");
  extras.push(discount);
  extraRows.push(line("Discount", discount));
  const extraTotal = add(...extras);

  /* Tax on the rooms, on the extras and on any tax posted as its own line.
     The restaurant's tax travels with its posting, below. */
  const extraTaxes = [...EXTRA_KINDS.map(([k]) => bucketTax(k)), bucketTax("discount"), bucket("tax_line")];
  const taxTotal = add(of((x) => x.roomTax), ...extraTaxes);
  const half = (v: { today: number; ptd: number; ytd: number }) =>
    ({ today: round2(v.today / 2), ptd: round2(v.ptd / 2), ytd: round2(v.ytd / 2) });
  const sgst = half(taxTotal);
  const cgst = { today: round2(taxTotal.today - sgst.today), ptd: round2(taxTotal.ptd - sgst.ptd), ytd: round2(taxTotal.ytd - sgst.ytd) };

  const withoutTax = add(roomTotal, extraTotal);
  const withTax = add(withoutTax, taxTotal);
  const posPosting = add(bucket("pos"), bucketTax("pos"));

  const paymentRows: ReportRow[] = [];
  const payments: Array<{ today: number; ptd: number; ytd: number }> = [];
  for (const [key, label, always] of PAY_METHODS) {
    const v = method(key);
    payments.push(v);
    if (always || v.today || v.ptd || v.ytd) paymentRows.push(line(label, v));
  }
  const unrecorded = method("unrecorded");
  if (unrecorded.today || unrecorded.ptd || unrecorded.ytd) {
    payments.push(unrecorded);
    paymentRows.push(line("Method not recorded", unrecorded));
  }

  const occupancy = { today: pct(t.today.sold, t.today.available), ptd: pct(t.ptd.sold, t.ptd.available), ytd: pct(t.ytd.sold, t.ytd.available) };
  const adr = { today: ratio(t.today.room, t.today.sold), ptd: ratio(t.ptd.room, t.ptd.sold), ytd: ratio(t.ytd.room, t.ytd.sold) };
  const revpar = { today: ratio(t.today.room, t.today.available), ptd: ratio(t.ptd.room, t.ptd.available), ytd: ratio(t.ytd.room, t.ytd.available) };
  const pair = (a: number, b: number) => `${a}/${b}`;
  const guests = (x: Omit<DayFigures, "date">) => pair(x.adults, x.children);
  const perRoom = (x: Omit<DayFigures, "date">) => pair(ratio(x.adults, x.sold), ratio(x.children, x.sold));
  const compDayUse = counted("comp_day_use");

  const sections: ReportSection[] = [
    section("room-charges", "Room Charges", [
      line("Room Charges", roomCharges),
      line("Cancellation Revenue", cancellation),
      sumLine("Total", roomTotal),
    ]),
    section("extra-charges", "Extra Charges", [...extraRows, sumLine("Total", extraTotal)]),
    section("tax", "Tax", [
      line("SGST", sgst),
      line("CGST", cgst),
      sumLine("Total", taxTotal),
    ]),
    section("revenue", "Revenue", [
      line("Total Revenue without Tax", withoutTax),
      line("Total Revenue with Tax", withTax),
      line("POS to PMS Posting", posPosting),
      sumLine("Transfer Charges to Guest Ledger", add(withTax, posPosting)),
    ]),
    section("payment", "Payment", [...paymentRows, sumLine("Total Payment", add(...payments))]),
    section("city-ledger", "City Ledger", [
      line("Opening Balance", NOT_HELD),
      line("Payment Received", NOT_HELD),
      line("Charges Raised", method("city_ledger")),
      line("Outstanding Commission", NOT_HELD),
      sumLine("Closing Balance", NOT_HELD),
    ]),
    section("advance-deposit-ledger", "Advance Deposit Ledger", [
      line("Opening Balance", TODAY_ONLY(L["adv_opening"]!)),
      line("Advance Deposit Collected", TODAY_ONLY(L["adv_collected"]!)),
      line("Balance Transfer to Guest Ledger", TODAY_ONLY(L["adv_transfer"]!)),
      sumLine("Closing Balance", TODAY_ONLY(L["adv_closing"]!)),
    ]),
    section("guest-ledger", "Guest Ledger", [
      line("Opening Balance", TODAY_ONLY(glOpening)),
      line("Carry Forwarded Advance Deposit", TODAY_ONLY(L["adv_transfer"]!)),
      line("Charge Posted to Guest Ledger", TODAY_ONLY(L["charged"]!)),
      line("Settlement by Guest", TODAY_ONLY(glSettlement)),
      line("Outstanding payment on charges", NOT_HELD),
      sumLine("Closing Balance*", TODAY_ONLY(glClosing)),
      line("Transfer From Advance Deposit*", TODAY_ONLY(L["adv_transfer"]!)),
    ]),
    section("room-summary", "Room Summary", [
      line("Total Room", of((x) => x.available), { unit: "count" }),
      /* Room-nights the house could not sell, day by day (figures.ts).
         It used to be the room count times the days, less what was
         available — which counted every night before the property traded
         as a room held back, once available started at its first trading
         day (D17-93). */
      line("Block Room", of((x) => x.blocked), { unit: "count" }),
      line("No of Guest (Adult/Child)", { today: guests(t.today), ptd: guests(t.ptd), ytd: guests(t.ytd) }, { unit: "text" }),
      line("Total Available Room nights", of((x) => x.available), { unit: "count" }),
      line("Sold Room", of((x) => x.sold), { unit: "count" }),
      line("Day Use Room", of((x) => x.dayUse), { unit: "count" }),
      line("Complimentary Room | Complimentary Day Use", {
        today: `${t.today.complimentary} | ${compDayUse.today}`,
        ptd: `${t.ptd.complimentary} | ${compDayUse.ptd}`,
        ytd: `${t.ytd.complimentary} | ${compDayUse.ytd}`,
      }, { unit: "text" }),
      line("No Show Rooms", counted("no_show"), { unit: "count" }),
      line("Average Guest Per Room", { today: perRoom(t.today), ptd: perRoom(t.ptd), ytd: perRoom(t.ytd) }, { unit: "text" }),
      line("No of Reservations (Confirm)", counted("confirmed"), { unit: "count" }),
      line("No of Reservations (Unconfirm)", counted("unconfirmed"), { unit: "count" }),
      line("No of Walkins", counted("walk_ins"), { unit: "count" }),
    ]),
    section("statistics", "Statistics", [
      line("Occupancy Rate (%)", occupancy, { unit: "percent" }),
      line("Average Daily Rate (ADR)", adr, { unit: "money" }),
      line("Revenue Per Available Room", revpar, { unit: "money" }),
    ]),
    section("pos-summary", "POS Summary", pos.summary),
    section("pos-payment-summary", "POS Payment Summary", pos.payments),
    section("revenue-summary", "Revenue Summary (without tax)", [
      line("Room Revenue", roomTotal),
      line("Extra Revenue", extraTotal),
      sumLine("PMS Revenue", withoutTax),
      ...pos.outlets.map((o) => line(o.name, o.withoutTax)),
      sumLine("POS Revenue", pos.withoutTax),
      sumLine("Total Revenue", add(withoutTax, pos.withoutTax)),
    ]),
  ];

  return {
    report: "manager",
    title: "Manager report",
    property: heading(property),
    orientation: "portrait",
    facts: [
      { label: "As on Date", value: asOn, kind: "date" },
      { label: "PTD", value: w.ptd, kind: "date" },
      { label: "YTD", value: w.ytd, kind: "date" },
      { label: "Currency", value: property.currency, kind: "text" },
    ],
    sections,
    footnotes: [
      "Guest Ledger Closing Balance = Opening Balance - Carry forwarded Advance Deposit + Charge Posted to Guest Ledger - Settlement by Guest",
      "Transfer From Advance Deposit = Balance Transfer To Guest Ledger",
      "PMS Revenue = Total PMS Revenue without Tax",
      "POS Revenue = All Outlet's Total Revenue without Tax",
      "Total Revenue = PMS Revenue + POS Revenue",
      "Sold Room, occupancy and the average rate count complimentary rooms, as the owner's eZee reports do. A night's room charge is shown on that night.",
      "City Ledger: Charges Raised is the bills transferred to a company or booking site. The other rows show \"-\": this system does not record a company's payment, or commission paid, yet.",
      countedFrom(opened),
      "A \"-\" means the figure is not held in this system. It is not a zero.",
    ],
  };
}

/* ── The restaurant, by outlet ─────────────────────────────────────── */

type Money3 = { today: number; ptd: number; ytd: number };

async function posFigures(client: Client, hotelId: string, w: Windows) {
  const params = [hotelId, w.ytd, w.asOn];
  const settled = `o.hotel_id = $1 and o.status = 'settled' and o.business_date between $2::date and $3::date`;

  const [{ rows: outlets }, { rows: cats }, { rows: rates }, { rows: offs }, { rows: tenders }] = await Promise.all([
    client.query<{ id: string; name: string }>(
      `select id::text, name from pos_outlets where hotel_id = $1 and is_active order by name`, [hotelId]),
    client.query<{ outlet: string; date: string; category: string; net: string }>(
      `select o.outlet_id::text as outlet, to_char(o.business_date, 'YYYY-MM-DD') as date,
              coalesce(c.name, 'Other') as category,
              sum(round(l.qty * l.unit_price, 2))::text as net
         from pos_orders o
         join pos_order_lines l on l.order_id = o.id and not l.voided
         left join pos_menu_items i on i.id = l.item_id
         left join pos_menu_categories c on c.id = i.category_id
        where ${settled}
        group by 1, 2, 3`, params),
    client.query<{ outlet: string; date: string; rate: string; discount: string; tax: string }>(
      `select o.outlet_id::text as outlet, to_char(o.business_date, 'YYYY-MM-DD') as date,
              r.tax_rate::text as rate, sum(r.discount)::text as discount, sum(r.tax)::text as tax
         from pos_orders o
         cross join lateral app.pos_order_by_rate(o.id) r
        where ${settled}
        group by 1, 2, 3`, params),
    client.query<{ outlet: string; date: string; round_off: string }>(
      `select o.outlet_id::text as outlet, to_char(o.business_date, 'YYYY-MM-DD') as date,
              sum(coalesce(o.round_off, 0))::text as round_off
         from pos_orders o where ${settled}
        group by 1, 2`, params),
    client.query<{ outlet: string; date: string; method: string; amount: string }>(
      `select o.outlet_id::text as outlet, to_char(o.business_date, 'YYYY-MM-DD') as date,
              t.method, sum(t.amount)::text as amount
         from pos_orders o join pos_order_tenders t on t.order_id = o.id
        where ${settled}
        group by 1, 2, 3`, params),
  ]);

  const summary: ReportRow[] = [];
  const payments: ReportRow[] = [];
  const perOutlet: Array<{ name: string; withoutTax: Money3 }> = [];
  const allWithout: Money3[] = [];
  const allWith: Money3[] = [];
  const allPaid: Money3[] = [];
  const three = (list: Array<{ date: string; v: number }>) => {
    const m = new Map<string, number>();
    for (const x of list) bump(m, x.date, x.v);
    return threeOf(w, m);
  };
  const sumMoney = (...xs: Money3[]) => ({
    today: round2(xs.reduce((a, x) => a + x.today, 0)),
    ptd: round2(xs.reduce((a, x) => a + x.ptd, 0)),
    ytd: round2(xs.reduce((a, x) => a + x.ytd, 0)),
  });
  const neg = (x: Money3) => ({ today: -x.today, ptd: -x.ptd, ytd: -x.ytd });

  for (const outlet of outlets) {
    summary.push(band("label", outlet.name));
    const mine = <T extends { outlet: string }>(xs: T[]) => xs.filter((x) => x.outlet === outlet.id);

    const categories = [...new Set(mine(cats).map((c) => c.category))].sort();
    const net: Money3[] = [];
    for (const name of categories) {
      const v = three(mine(cats).filter((c) => c.category === name).map((c) => ({ date: c.date, v: Number(c.net) })));
      net.push(v);
      summary.push(line(`Category - ${name}`, v));
    }
    const taxes: Money3[] = [];
    for (const rate of [...new Set(mine(rates).map((r) => r.rate))].sort((a, b) => Number(a) - Number(b))) {
      const tax = three(mine(rates).filter((r) => r.rate === rate).map((r) => ({ date: r.date, v: Number(r.tax) })));
      if (!tax.today && !tax.ptd && !tax.ytd) continue;
      const cgstPart = { today: round2(tax.today / 2), ptd: round2(tax.ptd / 2), ytd: round2(tax.ytd / 2) };
      const sgstPart = { today: round2(tax.today - cgstPart.today), ptd: round2(tax.ptd - cgstPart.ptd), ytd: round2(tax.ytd - cgstPart.ytd) };
      const halfRate = String(Number(rate) / 2);
      summary.push(line(`Tax - CGST ${halfRate}%`, cgstPart));
      summary.push(line(`Tax - SGST ${halfRate}%`, sgstPart));
      taxes.push(tax);
    }
    const discount = three(mine(rates).map((r) => ({ date: r.date, v: Number(r.discount) })));
    summary.push(line("Discount", neg(discount)));
    const adjustment = three(mine(offs).map((r) => ({ date: r.date, v: Number(r.round_off) })));
    summary.push(line("Adjustment - Round off", adjustment));

    const withoutTax = sumMoney(...net, neg(discount), adjustment);
    const withTax = sumMoney(withoutTax, ...taxes);
    summary.push(sumLine("Total Revenue without Tax", withoutTax));
    summary.push(sumLine("Total Revenue with Tax", withTax));
    perOutlet.push({ name: outlet.name, withoutTax });
    allWithout.push(withoutTax);
    allWith.push(withTax);

    payments.push(band("label", outlet.name));
    const paidHere: Money3[] = [];
    for (const [key, label] of POS_METHODS) {
      const v = three(mine(tenders).filter((x) => x.method === key).map((x) => ({ date: x.date, v: Number(x.amount) })));
      paidHere.push(v);
      if (key !== "function" || v.today || v.ptd || v.ytd) payments.push(line(label, v));
    }
    const outletPaid = sumMoney(...paidHere);
    payments.push(sumLine("Total", outletPaid));
    allPaid.push(outletPaid);
  }

  summary.push(sumLine("All Outlet's Total Revenue without Tax", sumMoney(...allWithout)));
  summary.push(sumLine("All Outlet's Total Revenue with Tax", sumMoney(...allWith)));
  payments.push(sumLine("All Outlet's Payment Total", sumMoney(...allPaid)));

  return { summary, payments, outlets: perOutlet, withoutTax: sumMoney(...allWithout) };
}
