import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { NIGHTS } from "../reports/index.ts";
import { AtCap, LeadsAppError, appHotelOf, cached, openReader, settings } from "../leads/index.ts";

/* ══════════════════════════════════════════════════════════════════
   MARKETING NUMBERS (D27-168, D27-170)

     GET /:code/marketing/numbers?month=YYYY-MM

   For the owner, an administrator and the GM (the role gate: `marketing`
   view, D22-17 and D27-170). One month, by the stays' ARRIVAL date:

     per campaign   its spend, read live from the leads app (the hotel's
                    campaign list and that month's spend, two reads, kept
                    60 s), beside the bookings here that carry the campaign
                    (reservations.campaign, set when a booking is made from
                    a lead) and their revenue
     per source     every booking source's bookings and revenue that month

   REVENUE IS BOOKED VALUE, THE REPORTS' OWN NIGHTS (the owner's D27-173,
   settling D27-170): the nights already charged, plus the nights not
   charged yet at the booking's rate, before tax, for stays still standing
   (cancelled and no-shows out). A figure nobody has is null, a dash on the
   screen, never 0. Booked value needs no GST rate: a property with no room
   rule yet still shows it (NIGHTS gives such a night an unknown tax, not an
   error, since 29 September).
   ══════════════════════════════════════════════════════════════════ */

export const numbers = new Hono<{ Variables: { subject: string } }>();

type Row = { by_source: boolean; campaign: string | null; source_id: string | null; source: string | null; bookings: number; revenue: string | null };

numbers.get("/:code/marketing/numbers", async (c) => {
  const month = c.req.query("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: "Choose a month." }, 400);
  const code = c.req.param("code");

  const pms = await withSession(c.get("subject"), async (client) => {
    const hotel = await client.query<{ id: string }>(
      "select id from hotels where code = upper($1) and id in (select app.auth_hotel_ids())", [code]);
    if (hotel.rowCount !== 1) return null;
    /* $2..$3 is the window of nights NIGHTS spreads: from the month's first
       day, far enough on to hold the longest stay that arrives in it. */
    const { rows } = await client.query<Row>(
      `with ${NIGHTS},
            stays as (
              select r.id, r.campaign, r.booking_source_id
                from reservations r
               where r.hotel_id = $1
                 and r.check_in between $4::date and ($4::date + interval '1 month' - interval '1 day')::date
                 and r.status in ('confirmed', 'checked_in', 'checked_out')),
            rent as (
              select reservation_id, rent from posted_nights
              union all
              select reservation_id, rent from booked_nights),
            per_stay as (
              select s.campaign, s.booking_source_id,
                     (select sum(x.rent) from rent x where x.reservation_id = s.id) as revenue
                from stays s)
       select grouping(p.campaign) = 1 as by_source,
              p.campaign, p.booking_source_id::text as source_id, bs.name as source,
              count(*)::int as bookings, sum(p.revenue)::text as revenue
         from per_stay p
         left join booking_sources bs on bs.id = p.booking_source_id
        group by grouping sets ((p.campaign), (p.booking_source_id, bs.name))`,
      [hotel.rows[0]!.id, `${month}-01`, `${Number(month.slice(0, 4)) + 2}-12-31`, `${month}-01`]);
    return rows;
  });
  if (!pms) return c.json({ error: "No such property." }, 404);

  /* grouping() tells the two sets apart: a stay with no campaign and a stay
     with no source both read as a null otherwise. */
  const campaignRows = pms.filter((r) => !r.by_source && r.campaign !== null);
  const sources = pms.filter((r) => r.by_source)
    .map((r) => ({ id: r.source_id, name: r.source, bookings: r.bookings, revenue: r.revenue }));

  /* The app's side: which campaigns this hotel runs, and what they spent. */
  const s = settings();
  const appHotel = s && appHotelOf(s, code);
  let app: { names: Record<string, { name: string | null; platform: string | null }>; spend: Record<string, number> | null } | null = null;
  let appError: string | null = null;
  if (s && appHotel) {
    try {
      app = await cached(`market:${appHotel}:${month}`, async () => {
        const { reader } = await openReader(s, "marketing");
        const { found } = await reader.get([`hotels/${appHotel}/marketing/campaigns`, `hotels/${appHotel}/spend/${month}`]);
        const catalogue = found.find((d) => d.name.endsWith("/marketing/campaigns"))?.fields["campaigns"] as Record<string, Record<string, unknown>> | undefined;
        const spendDoc = found.find((d) => d.name.endsWith(`/spend/${month}`))?.fields["campaigns"] as Record<string, { days?: Record<string, { spend?: number }> }> | undefined;
        return {
          names: Object.fromEntries(Object.entries(catalogue ?? {}).map(([k, v]) =>
            [k, { name: typeof v["name"] === "string" ? v["name"] : null, platform: typeof v["platform"] === "string" ? v["platform"] : null }])),
          spend: spendDoc ? Object.fromEntries(Object.entries(spendDoc).map(([k, v]) =>
            [k, Math.round(Object.values(v.days ?? {}).reduce((a, d) => a + (Number(d.spend) || 0), 0) * 100) / 100])) : null,
        };
      });
    } catch (error) {
      if (error instanceof AtCap) appError = error.message;
      else if (error instanceof LeadsAppError) appError = `The leads app did not answer (${error.status}), so spend is not shown.`;
      else throw error;
    }
  }

  const keys = new Set([...campaignRows.map((r) => r.campaign!), ...Object.keys(app?.spend ?? {})]);
  const campaigns = [...keys].sort().map((key) => {
    const here = campaignRows.find((r) => r.campaign === key);
    return {
      key,
      name: app?.names[key]?.name ?? null,
      platform: app?.names[key]?.platform ?? null,
      /* Spend is the app's; with no spend document for the month it is unknown, not 0. */
      spend: app?.spend ? (app.spend[key] ?? null) : null,
      bookings: here?.bookings ?? 0,
      revenue: here?.revenue ?? null,
    };
  });

  return c.json({ month, connected: !!s, inApp: !!appHotel, appError, campaigns, sources });
});
