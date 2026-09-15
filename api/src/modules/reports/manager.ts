import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor, monthStart } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE MANAGER REPORT — the daily flash

   Three columns throughout: Today · PTD · YTD. PTD is the period to
   date; YTD runs from 1 April, the Indian financial year.

   EVERY FIGURE IS DERIVED, and the ones that are not derivable are
   NULL — which the interface prints as an em-dash. There are eight of
   those, and each is a real gap rather than a zero: an opening balance
   nothing predates, a POS bridge that does not exist, commission
   charged outside this system. An invented zero on a report an owner
   reads is worse than a visible gap.

   The three windows share ONE derivation. Computing them separately is
   how a report ends up saying that today's revenue is not part of the
   period's.
   ══════════════════════════════════════════════════════════════════ */

export const manager = new Hono<{ Variables: { subject: string } }>();

/** The Indian financial year. */
const FY_START = "2026-04-01";

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

interface Window {
  room: number;
  extra: number;
  tax: number;
  discount: number;
  available: number;
  sold: number;
  complimentary: number;
  dayUse: number;
  noShow: number;
  walkIns: number;
  payments: Record<string, number>;
  /** Every receipt, whatever method it was recorded under. */
  received: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Everything one date range is worth, in one round trip. */
async function windowFor(
  client: Client, hotelId: string, from: string, to: string,
): Promise<Window> {
  const { rows } = await client.query<{
    room: string; extra: string; tax: string; discount: string;
    received: string; available: string; sold: string; complimentary: string;
    day_use: string; no_show: string; walk_ins: string;
  }>(
    `with live as (
       select fp.*
         from folio_postings fp
        where fp.hotel_id = $1
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id
          )
          and fp.business_date between $2::date and $3::date
     ),
     nights as (
       select r.is_complimentary, r.id
         from reservations r,
              generate_series(r.check_in, r.check_out - 1, interval '1 day') d
        where r.hotel_id = $1
          and r.status in ('confirmed','checked_in','checked_out')
          and d::date between $2::date and $3::date
     ),
     arrivals as (
       select r.*
         from reservations r
        where r.hotel_id = $1
          and r.check_in between $2::date and $3::date
     )
     select
       coalesce((select sum(amount) filter (where category = 'room') from live), 0)::text     as room,
       coalesce((select sum(amount) filter (where category not in
            ('room','payment','discount','tax','refund')) from live), 0)::text                as extra,
       coalesce((select sum(tax_amount) + coalesce(sum(amount) filter (
            where category = 'tax'), 0) from live), 0)::text                                  as tax,
       coalesce((select -sum(amount) filter (where category = 'discount') from live), 0)::text as discount,
       coalesce((select -sum(amount) filter (where category = 'payment') from live), 0)::text  as received,
       coalesce((select sum(app.sellable_rooms($1, d::date))
                   from generate_series($2::date, $3::date, interval '1 day') d), 0)::text    as available,
       (select count(*) from nights where not is_complimentary)::text                          as sold,
       (select count(*) from nights where is_complimentary)::text                              as complimentary,
       (select count(*) from arrivals where is_day_use)::text                                  as day_use,
       (select count(*) from reservations r where r.hotel_id = $1
          and r.status = 'no_show' and r.check_in between $2::date and $3::date)::text         as no_show,
       (select count(*) from arrivals where source = 'walk_in')::text                          as walk_ins`,
    [hotelId, from, to],
  );

  const r = rows[0]!;

  /* Payments by method. `payments` carries the method; the posting
     carries the money, and the two are joined rather than duplicated. */
  const { rows: paid } = await client.query<{ method: string; amount: string }>(
    `select p.method, sum(p.amount)::text as amount
       from payments p
       join folio_postings fp on fp.id = p.posting_id
      where p.hotel_id = $1
        and fp.business_date between $2::date and $3::date
        and not exists (
          select 1 from folio_postings rev where rev.reverses_id = fp.id
        )
      group by p.method`,
    [hotelId, from, to],
  );

  return {
    room: round(Number(r.room)),
    extra: round(Number(r.extra)),
    tax: round(Number(r.tax)),
    discount: round(Number(r.discount)),
    received: round(Number(r.received)),
    available: Number(r.available),
    sold: Number(r.sold),
    complimentary: Number(r.complimentary),
    dayUse: Number(r.day_use),
    noShow: Number(r.no_show),
    walkIns: Number(r.walk_ins),
    payments: Object.fromEntries(
      paid.map((p) => [p.method, round(Number(p.amount))]),
    ),
  };
}

/** The database's payment methods, and the labels the report prints. */
const METHOD_LABELS: Array<[string, string]> = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["card", "Credit Card"],
  ["netbanking", "Net Banking"],
  ["wallet", "Google Pay"],
  ["cheque", "Cheque"],
  ["bank_transfer", "Bank Transfer"],
];

manager.get("/:code/reports/manager", async (c) => {
  const asOnParam = c.req.query("asOn");
  const ptdFromParam = c.req.query("ptdFrom");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const bd = await businessDateFor(client, hotelId);
    const asOn = asOnParam ?? bd;
    const ptdFrom = ptdFromParam ?? monthStart(bd);

    const [today, ptd, ytd] = await Promise.all([
      windowFor(client, hotelId, asOn, asOn),
      windowFor(client, hotelId, ptdFrom, asOn),
      windowFor(client, hotelId, FY_START, asOn),
    ]);

    /* Blocked is derived below as physical minus sellable. An earlier
       version also selected a `blocked` column here whose condition
       compared two constants — it would have returned 0 or EVERY room,
       and nothing read it. Dead code that names a real figure is worse
       than none: the next reader trusts it. */
    const { rows: hotel } = await client.query<{
      currency: string; rooms: string;
    }>(
      `select h.currency,
              (select count(*) from rooms r
                where r.hotel_id = h.id and r.is_active)::text as rooms
         from hotels h where h.id = $1`,
      [hotelId],
    );

    const cur = hotel[0]!;
    const sellableToday = today.available;
    const physical = Number(cur.rooms);

    const three = (
      label: string,
      pick: (w: Window) => number | null,
      extra: Partial<{ total: boolean; indent: boolean }> = {},
    ) => ({ label, today: pick(today), ptd: pick(ptd), ytd: pick(ytd), ...extra });

    /* DISCOUNT COMES OFF.
       `w.discount` was fetched, typed, and never read — so the revenue
       total was higher than the ledger by every discount the property
       had given. It showed ₹4,60,697.76 against a ledger holding
       ₹4,59,697.76, and its own rows did not subtract to its own
       closing balance.

       Found by building the Guest Ledger over the same postings and
       watching two reports of one figure disagree by exactly ₹1,000 —
       which was the single discount in the demo. Second time in this
       project a Manager Report column has been selected and not read.

       Stored positive (`-sum(amount)` over negative postings), so it
       subtracts. */
    const net = (w: Window) => round(w.room + w.extra - w.discount);
    const gross = (w: Window) => round(net(w) + w.tax);
    const paidTotal = (w: Window) =>
      round(Object.values(w.payments).reduce((t, n) => t + n, 0));

    const revenue = [
      three("Room Charges", (w) => w.room),
      /* Nothing in this system charges a cancellation fee, so this is a
         true zero rather than a gap. */
      three("Cancellation Revenue", () => 0),
      three("Extra Charges", (w) => w.extra),
      /* Shown, so the total below is derivable from the rows above it.
         A total nobody can reconstruct from what is printed is a total
         nobody can check. Negated for display because it reduces
         revenue, and a positive number under "Discount" reads as one. */
      three("Discount", (w) => (w.discount ? -w.discount : 0)),
      three("SGST", (w) => round(w.tax / 2), { indent: true }),
      three("CGST", (w) => round(w.tax / 2), { indent: true }),
      three("Total Revenue without Tax", net, { total: true }),
      three("Total Revenue with Tax", gross, { total: true }),
      /* Sattva posts to the PMS in the live system. Stage 7 is that
         bridge; until it exists there is nothing here to report. */
      three("POS to PMS Posting", () => null),
    ];

    const payments = [
      ...METHOD_LABELS.map(([key, label]) =>
        three(label, (w) => w.payments[key] ?? 0),
      ),
      three("Total Payment", paidTotal, { total: true }),
    ];

    const cityLedger = [
      three("Opening Balance", () => null),
      three("Payment Received", () => null),
      three("Charges Raised", () => null),
      three("Outstanding Commission", () => null),
      three("Closing Balance", () => null, { total: true }),
    ];

    /* Every open balance on the file, not a window — a folio still
       carrying money is carrying it today regardless of when it was
       charged. */
    const { rows: bal } = await client.query<{ balance: string }>(
      `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as balance
         from folio_postings fp
        where fp.hotel_id = $1
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id
          )`,
      [hotelId],
    );
    const openBalance = round(Number(bal[0]!.balance));

    const guestLedger = [
      /* Nothing predates the demo window, so an opening balance would
         be invented rather than derived. */
      three("Opening Balance", () => null),
      three("Charge Posted to Guest Ledger", gross),
      three("Settlement by Guest", paidTotal),
      { label: "Closing Balance", today: openBalance, ptd: openBalance, ytd: openBalance, total: true },
    ];

    const roomSummary = [
      { label: "Total Room", today: sellableToday, ptd: sellableToday, ytd: sellableToday },
      /* Blocked is a fact about TODAY. Over a period it is a count of
         room-nights, which is a different question and not the one the
         real report asks. */
      { label: "Block Room", today: physical - sellableToday, ptd: null, ytd: null },
      three("Total Available Room nights", (w) => w.available),
      three("Sold Room", (w) => w.sold),
      three("Day Use Room", (w) => w.dayUse),
      three("Complimentary Room", (w) => w.complimentary),
      three("No Show Rooms", (w) => w.noShow),
      three("No of Walkins", (w) => w.walkIns),
    ];

    /* Rates from the TOTALS, never averaged from averages. And room
       revenue only — extras never enter ADR. */
    const rate = (w: Window) => (w.sold ? round(w.room / w.sold) : 0);
    const revpar = (w: Window) => (w.available ? round(w.room / w.available) : 0);
    const occ = (w: Window) =>
      w.available ? Math.round((w.sold / w.available) * 10000) / 100 : 0;

    const statistics = [
      three("Occupancy Rate (%)", occ),
      three("Average Daily Rate (ADR)", rate),
      three("Revenue Per Available Room", revpar),
    ];

    return {
      asOn,
      ptdFrom,
      ytdFrom: FY_START,
      currency: cur.currency,
      sections: [
        { title: "Revenue", rows: revenue },
        { title: "Payment", rows: payments },
        {
          title: "City Ledger",
          rows: cityLedger,
          note: "OTA balances are settled outside the PMS today. This section fills when the channel bridge lands at Stage 9.",
        },
        {
          title: "Guest Ledger",
          rows: guestLedger,
          note: "Closing Balance = Opening Balance − Carry forwarded Advance Deposit + Charge Posted to Guest Ledger − Settlement by Guest",
        },
      ],
      roomSummary,
      statistics,
      footnotes: [
        "Guest Ledger Closing Balance = Opening Balance − Carry forwarded Advance Deposit + Charge Posted to Guest Ledger − Settlement by Guest",
        "PMS Revenue = Total PMS Revenue without Tax",
        "POS Revenue = All Outlet's Total Revenue without Tax",
        "Total Revenue = PMS Revenue + POS Revenue",
        "A dash means the figure is not derivable from this system yet — it is not a zero.",
      ],
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
