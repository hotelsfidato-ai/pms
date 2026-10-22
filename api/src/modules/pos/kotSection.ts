import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KOT SECTION OF RESTAURANT SETUP (the owner's D27-292, 9 October)

   "One KOT machine prints everything - bar, restaurant, bills. Let me
   configure several, by place." Asked question by question:

   - KOT KINDS: Kitchen and Bar to start, renamed at will, more added
     (Tandoor). Each slip says what it is at the top: "BAR KOT 14".
   - A STATION IS A COMPUTER (the website cannot reach a printer by its
     IP): on the bar's computer, "This computer prints Bar KOTs". ONE
     COMPUTER PER KIND - ticking it elsewhere moves it, and starts afresh.
     One computer may print several kinds, or all, and the bills.
   - Routing is per menu section, pre-filled from the tax heading; the
     kind is stamped on a line when it is sent (211).
   - One Send, one number, one slip per kind.
   - An offline computer's KOTs wait for it, with a red line naming it.
   - A REPRINT (the pad, the Till, the Terminal) waits for the computer
     that prints that KOT's kind and prints there, marked REPRINT
     (D27-329; table pos_kot_reprints, 225).
   - THE BILL PRINTER: Print bill anywhere asks it here and it prints
     silently - INTERIM BILL, BILL, BILL · DUPLICATE. With none chosen,
     the bill opens on the device as before; offline, "Print here".

   Who: Restaurant setup's people and the kitchen manager set it up
   (roleGate KOT_SWITCH, menu edit); every till and kitchen screen reads
   it, for the red line; the station's own asks are KOT_PRINT.

   Registered on the till's router by till.ts, behind its module gate.
   Nothing here imports till.ts.
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;

const refuse = (reason: string) => ({ ok: false as const, reason });

/** Seen within this long is online (D27-161). */
export const ONLINE = "90 seconds";

/** The id a browser sends: it makes it, so it is only checked for shape. */
export const deviceOf = (raw: unknown): string | null =>
  typeof raw === "string" && /^[\w-]{8,64}$/.test(raw) ? raw : null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONGEST_KIND = 30;
const LONGEST_STATION = 60;

/** A kind's name as typed: "Tandoor". It heads the slip: "TANDOOR KOT 14". */
function kindName(raw: unknown): string | { reason: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) return { reason: "Type a name for it - for example Tandoor." };
  if (name.length > LONGEST_KIND) return { reason: `Keep it to ${LONGEST_KIND} letters: it heads the slip.` };
  if (/\bkot\b/i.test(name)) return { reason: `Just "${name.replace(/\s*\bkot\b\s*/i, " ").trim() || "Kitchen"}" - the slip adds KOT.` };
  return name;
}

/** The bill a print is: before payment INTERIM, after it BILL, then DUPLICATE;
    a paid bill voided, VOID (D27-324); a bill given free, NC (D27-351). */
async function headingFor(client: Client, orderId: string, status: string) {
  if (status === "void") return "void" as const;
  if (status === "no_charge") return "nc" as const;
  if (status !== "settled") return "interim" as const;
  const { rows } = await client.query(
    `select 1 from pos_bill_prints where order_id = $1 and heading in ('bill', 'duplicate') limit 1`,
    [orderId]);
  return rows.length > 0 ? "duplicate" as const : "bill" as const;
}

export function registerKotSection(till: App, hotelFor: HotelFor): void {
  /* ── The setup, as every screen reads it ─────────────────────────── */
  till.get("/:code/till/kot-setup", async (c) => {
    const device = c.req.query("device") ?? "";
    const body = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      const { rows: stations } = await client.query<{
        id: string; name: string; mine: boolean; prints_bills: boolean;
        seen_at: string | null; online: boolean;
      }>(
        `select id::text, name, device = $2 as mine, prints_bills, seen_at::text,
                coalesce(seen_at > now() - interval '${ONLINE}', false) as online
           from pos_kot_stations
          where hotel_id = $1 and is_active
          order by created_at`,
        [hotelId, device]);

      /* Each section, its own kind if it has one, and where it prints: the
         kind the section names, else by its tax heading (211). A section
         with no dish on sale sends nothing anywhere. */
      const { rows: sections } = await client.query<{
        id: string; name: string; tax_kind: string | null; own: string | null;
        kind: string | null; selling: boolean;
      }>(
        `select c.id::text, c.name, c.tax_kind, ko.id::text as own,
                coalesce(ko.id, kr.id)::text as kind,
                exists (select 1 from pos_menu_items i
                         where i.category_id = c.id and i.is_active) as selling
           from pos_menu_categories c
           left join pos_kot_kinds ko on ko.id = c.kot_kind_id and ko.is_active
           left join pos_kot_kinds kr on kr.hotel_id = c.hotel_id
                 and kr.role = case when c.tax_kind in ('bar', 'alcohol') then 'bar' else 'food' end
          where c.hotel_id = $1 and c.is_active
          order by c.sort_order, c.name`,
        [hotelId]);

      const { rows: kinds } = await client.query<{
        id: string; name: string; role: "food" | "bar" | null; station_id: string | null;
      }>(
        `select id::text, name, role, station_id::text
           from pos_kot_kinds
          where hotel_id = $1 and is_active
          order by sort, created_at`,
        [hotelId]);

      const byId = new Map(stations.map((s) => [s.id, s]));
      const station = (id: string | null) => {
        const s = id ? byId.get(id) : undefined;
        return s ? { id: s.id, name: s.name, mine: s.mine, online: s.online, seenAt: s.seen_at } : null;
      };
      const bills = stations.find((s) => s.prints_bills) ?? null;

      return {
        kinds: kinds.map((k) => ({
          id: k.id, name: k.name, role: k.role,
          /* Fixed: Kitchen and Bar are never switched off (211). */
          fixed: k.role !== null,
          station: station(k.station_id),
          /* Sections with a dish on sale that print here: the red line shows
             only for a kind something prints to (the owner). */
          sections: sections.filter((s) => s.kind === k.id && s.selling).length,
        })),
        stations: stations.map((s) => ({
          id: s.id, name: s.name, mine: s.mine, online: s.online, seenAt: s.seen_at,
          printsBills: s.prints_bills,
          kinds: kinds.filter((k) => k.station_id === s.id).map((k) => k.id),
        })),
        sections: sections.map((s) => ({
          id: s.id, name: s.name, heading: s.tax_kind, own: s.own, kind: s.kind,
        })),
        billPrinter: bills ? station(bills.id) : null,
        me: stations.find((s) => s.mine)?.id ?? null,
      };
    });
    return body ? c.json(body) : c.json({ error: "No such property." }, 404);
  });

  /* ── The kinds ───────────────────────────────────────────────────── */
  till.post("/:code/till/kot-setup/kinds", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { name?: unknown };
    const name = kindName(input.name);
    if (typeof name !== "string") return c.json(refuse(name.reason), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows: taken } = await client.query(
        `select 1 from pos_kot_kinds where hotel_id = $1 and is_active and lower(trim(name)) = lower($2)`,
        [hotelId, name]);
      if (taken.length) return refuse(`There is already a ${name} KOT.`);
      const { rows } = await client.query<{ id: string }>(
        `insert into pos_kot_kinds (hotel_id, name, sort)
         values ($1, $2, (select coalesce(max(sort), 0) + 1 from pos_kot_kinds where hotel_id = $1))
         returning id::text`,
        [hotelId, name]);
      return { ok: true as const, id: rows[0]!.id };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  till.patch("/:code/till/kot-setup/kinds/:id", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { name?: unknown };
    const name = kindName(input.name);
    if (typeof name !== "string") return c.json(refuse(name.reason), 409);
    if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such KOT."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows: taken } = await client.query(
        `select 1 from pos_kot_kinds
          where hotel_id = $1 and is_active and lower(trim(name)) = lower($2) and id <> $3`,
        [hotelId, name, c.req.param("id")]);
      if (taken.length) return refuse(`There is already a ${name} KOT.`);
      const { rowCount } = await client.query(
        `update pos_kot_kinds set name = $3 where id = $2 and hotel_id = $1 and is_active`,
        [hotelId, c.req.param("id"), name]);
      return rowCount ? { ok: true as const } : refuse("No such KOT.");
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* Switched off, never deleted (the owner). Its sections go back to their
     heading; KOTs already sent on it keep it for a reprint. */
  till.post("/:code/till/kot-setup/kinds/:id/off", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such KOT."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{ name: string; role: string | null }>(
        `select name, role from pos_kot_kinds where id = $2 and hotel_id = $1 and is_active for update`,
        [hotelId, c.req.param("id")]);
      if (!rows[0]) return refuse("No such KOT.");
      if (rows[0].role) {
        return refuse(`${rows[0].name} stays: a section with no KOT of its own prints there. Rename it instead.`);
      }
      await client.query(
        `update pos_menu_categories set kot_kind_id = null where hotel_id = $1 and kot_kind_id = $2`,
        [hotelId, c.req.param("id")]);
      await client.query(
        `update pos_kot_kinds set is_active = false, station_id = null, station_since = null
          where id = $2 and hotel_id = $1`,
        [hotelId, c.req.param("id")]);
      return { ok: true as const };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* ── Which section prints where ──────────────────────────────────── */
  till.post("/:code/till/kot-setup/sections/:id", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { kindId?: unknown };
    /* Null takes the section back to its heading. */
    const kindId = input.kindId === null ? null
      : typeof input.kindId === "string" && UUID.test(input.kindId) ? input.kindId : undefined;
    if (kindId === undefined) return c.json(refuse("Which KOT does it print on?"), 409);
    if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such section."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      if (kindId) {
        const { rows } = await client.query(
          `select 1 from pos_kot_kinds where id = $2 and hotel_id = $1 and is_active`, [hotelId, kindId]);
        if (!rows.length) return refuse("That KOT is switched off, or is not here.");
      }
      const { rowCount } = await client.query(
        `update pos_menu_categories set kot_kind_id = $3 where id = $2 and hotel_id = $1`,
        [hotelId, c.req.param("id"), kindId]);
      return rowCount ? { ok: true as const } : refuse("No such section.");
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* ── This computer ───────────────────────────────────────────────────
     The kinds it prints and whether it prints the bills, named. A kind or
     the bills ticked here MOVE here from any other computer, and start
     afresh: what was sent before is not this computer's (D27-161) - but a
     reprint still waiting moves with its kind (D27-330 (6)).
     Nothing ticked: this computer prints nothing and leaves the list. */
  till.post("/:code/till/kot-setup/this-computer", async (c) => {
    const input = await c.req.json().catch(() => ({})) as {
      device?: unknown; name?: unknown; kindIds?: unknown; bills?: unknown;
    };
    const device = deviceOf(input.device);
    if (!device) return c.json(refuse("This computer has no id. Reload the page and try again."), 409);
    const kindIds = Array.isArray(input.kindIds)
      ? [...new Set(input.kindIds.filter((k): k is string => typeof k === "string"))] : null;
    if (!kindIds || kindIds.some((k) => !UUID.test(k))) return c.json(refuse("Which KOTs?"), 409);
    const bills = input.bills === true;
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    const printsSomething = kindIds.length > 0 || bills;
    if (printsSomething && !name) {
      return c.json(refuse("Type a name for this computer - for example Bar PC."), 409);
    }
    if (name.length > LONGEST_STATION) {
      return c.json(refuse(`Keep the computer's name to ${LONGEST_STATION} letters.`), 409);
    }

    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;

      if (kindIds.length) {
        const { rows } = await client.query(
          `select id from pos_kot_kinds where hotel_id = $1 and is_active and id = any($2::uuid[])`,
          [hotelId, kindIds]);
        if (rows.length !== kindIds.length) return refuse("One of those KOTs is switched off. Look again.");
      }

      const { rows: had } = await client.query<{ id: string }>(
        `select id::text from pos_kot_stations where hotel_id = $1 and device = $2 and is_active for update`,
        [hotelId, device]);
      let station = had[0]?.id ?? null;
      if (!station && !printsSomething) return { ok: true as const };
      if (!station) {
        station = (await client.query<{ id: string }>(
          `insert into pos_kot_stations (hotel_id, device, name, seen_at)
           values ($1, $2, $3, now()) returning id::text`,
          [hotelId, device, name])).rows[0]!.id;
      } else if (name) {
        await client.query(
          `update pos_kot_stations set name = $2, seen_at = now() where id = $1`, [station, name]);
      }

      /* The kinds: here from now, off here when unticked. */
      await client.query(
        `update pos_kot_kinds set station_id = $2, station_since = now()
          where hotel_id = $1 and is_active and id = any($3::uuid[])
            and station_id is distinct from $2`,
        [hotelId, station, kindIds]);
      await client.query(
        `update pos_kot_kinds set station_id = null, station_since = null
          where hotel_id = $1 and station_id = $2 and not (id = any($3::uuid[]))`,
        [hotelId, station, kindIds]);

      /* The bills: one computer prints them (the owner). */
      if (bills) {
        await client.query(
          `update pos_kot_stations set prints_bills = false, bills_since = null
            where hotel_id = $1 and prints_bills and id <> $2`,
          [hotelId, station]);
        await client.query(
          `update pos_kot_stations set prints_bills = true, bills_since = now()
            where id = $1 and not prints_bills`,
          [station]);
      } else {
        await client.query(
          `update pos_kot_stations set prints_bills = false, bills_since = null where id = $1`,
          [station]);
      }

      if (!printsSomething) {
        await client.query(`update pos_kot_stations set is_active = false where id = $1`, [station]);
      }
      return { ok: true as const };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* A computer that prints nothing any more - a PC replaced, its kinds
     ticked on the new one - comes off the list from anywhere. One that
     still prints is changed on itself. */
  till.post("/:code/till/kot-setup/stations/:id/remove", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.json(refuse("No such computer."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{ name: string; prints: boolean }>(
        `select s.name, s.prints_bills
                or exists (select 1 from pos_kot_kinds k where k.station_id = s.id and k.is_active) as prints
           from pos_kot_stations s where s.id = $2 and s.hotel_id = $1 and s.is_active`,
        [hotelId, c.req.param("id")]);
      if (!rows[0]) return refuse("No such computer.");
      if (rows[0].prints) {
        return refuse(`${rows[0].name} still prints. Tick its KOTs on another computer first.`);
      }
      await client.query(`update pos_kot_stations set is_active = false where id = $1`, [c.req.param("id")]);
      return { ok: true as const };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* ── The station's ask ───────────────────────────────────────────────
     Every 30 seconds and whenever an order moves; it is also "last seen".
     The slips due for each kind it prints, oldest first - only from the
     business date and from when the kind came here (D27-167) - and the
     bills asked of it; and its last 20 slips for Reprint. A docket printed
     whole before 211 counts as printed for every kind. */
  till.post("/:code/till/kot-stations/poll", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { device?: unknown };
    const device = deviceOf(input.device);
    const body = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows: me } = await client.query<{ id: string; name: string; prints_bills: boolean }>(
        `update pos_kot_stations set seen_at = now()
          where hotel_id = $1 and device = $2 and is_active
         returning id::text, name, prints_bills`,
        [hotelId, device]);
      if (!me[0]) return { station: false as const };
      const station = me[0];
      const bd = await businessDateFor(client, hotelId);

      const { rows: kinds } = await client.query<{ id: string; name: string }>(
        `select id::text, name from pos_kot_kinds where station_id = $1 and is_active order by sort`,
        [station.id]);

      const slips = `
        select l.order_id::text as order_id, l.kot_no, k.id::text as kind_id, k.name as kind_name,
               o.table_ref, min(l.kot_sent_at)::text as sent_at,
               (select max(p.printed_at)::text from pos_kot_prints p
                 where p.order_id = l.order_id and p.kot_no = l.kot_no
                   and (p.kind_id = k.id or p.kind_id is null)) as printed_at
          from pos_order_lines l
          join pos_orders o on o.id = l.order_id
          join pos_kot_kinds k on k.id = coalesce(l.kot_kind_id, app.pos_line_kot_kind(l.id))
         where l.hotel_id = $1 and k.station_id = $2 and k.is_active and l.kot_no is not null
           and not l.packing`;
      type Row = {
        order_id: string; kot_no: number; kind_id: string; kind_name: string;
        table_ref: string | null; sent_at: string; printed_at: string | null;
      };
      const { rows: due } = await client.query<Row>(
        `${slips}
           and o.business_date = $3::date
           and l.kot_sent_at >= k.station_since
           and not exists (select 1 from pos_kot_prints p
                            where p.order_id = l.order_id and p.kot_no = l.kot_no
                              and (p.kind_id = k.id or p.kind_id is null))
         group by l.order_id, l.kot_no, k.id, k.name, o.table_ref
         order by min(l.kot_sent_at), l.kot_no`,
        [hotelId, station.id, bd]);
      /* ponytail: the last 20 read on every ask - fine at a hotel's volume. */
      const { rows: recent } = await client.query<Row>(
        `${slips} and o.business_date >= $3::date - 1
         group by l.order_id, l.kot_no, k.id, k.name, o.table_ref
         order by min(l.kot_sent_at) desc, l.kot_no desc limit 20`,
        [hotelId, station.id, bd]);

      const { rows: bills } = station.prints_bills ? await client.query<{
        id: string; order_id: string; heading: string; table_ref: string | null;
      }>(
        `select b.id::text, b.order_id::text, b.heading, o.table_ref
           from pos_bill_prints b join pos_orders o on o.id = b.order_id
          where b.station_id = $1 and b.printed_at is null and not b.printed_here
            /* Today's bills; and a finished bill of an earlier day asked
               for again (its duplicate, 20 Oct) - within a day of asking. */
            and (o.business_date = $2::date
                 or (o.status <> 'open' and b.asked_at > now() - interval '1 day'))
          order by b.asked_at`,
        [station.id, bd]) : { rows: [] };

      /* Reprints asked of its kinds (D27-329 (2)), oldest first: Reprint on
         the pad, the Till or the Terminal waits for the computer that prints
         the kind NOW. A kind moved here brings its waiting reprints with it
         (the owner's D27-330 (6)); its waiting new KOTs start afresh (D27-161). */
      const { rows: reprints } = await client.query<{
        id: string; order_id: string; kot_no: number; kind_id: string; kind_name: string;
        table_ref: string | null;
      }>(
        `select r.id::text, r.order_id::text, r.kot_no, k.id::text as kind_id, k.name as kind_name,
                o.table_ref
           from pos_kot_reprints r
           join pos_kot_kinds k on k.id = r.kind_id
           join pos_orders o on o.id = r.order_id
          where r.hotel_id = $1 and k.station_id = $2 and k.is_active
            and r.printed_at is null
          order by r.asked_at`,
        [hotelId, station.id]);

      const shape = (r: Row) => ({
        orderId: r.order_id, kotNo: r.kot_no, kindId: r.kind_id, kind: r.kind_name,
        table: r.table_ref, sentAt: r.sent_at, printedAt: r.printed_at,
      });
      return {
        station: { id: station.id, name: station.name, kinds, printsBills: station.prints_bills },
        due: due.map(shape),
        recent: recent.map(shape),
        bills: bills.map((b) => ({ id: b.id, orderId: b.order_id, heading: b.heading, table: b.table_ref })),
        reprints: reprints.map((r) => ({
          id: r.id, orderId: r.order_id, kotNo: r.kot_no, kindId: r.kind_id, kind: r.kind_name,
          table: r.table_ref,
        })),
      };
    });
    return body ? c.json(body) : c.json({ error: "No such property." }, 404);
  });

  /* ── A KOT printed again, at its station (the owner's D27-329) ──────
     Reprint on the order pad, the Till and the Terminal. The slip waits
     for the computer that prints its kind - where the KOT first went - and
     prints there marked REPRINT, through that computer's own ask, the KOT
     read and a claim: never on the device where Reprint was pressed.
     Offline, it waits there and the answer says so; with no computer for
     the kind it is refused. Who: whoever takes orders (roleGate TILL). */
  till.post("/:code/till/orders/:id/kot/:no/reprint", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { kind?: unknown };
    const kindId = typeof input.kind === "string" && UUID.test(input.kind) ? input.kind : null;
    if (!kindId) return c.json(refuse("Which KOT?"), 409);
    const kotNo = Number(c.req.param("no"));
    const orderId = c.req.param("id");
    if (!Number.isInteger(kotNo) || !UUID.test(orderId)) return c.json(refuse("No such KOT."), 409);
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{
        kind: string; station: string | null; online: boolean; seen_at: string | null;
      }>(
        `select k.name as kind, s.name as station, s.seen_at::text,
                coalesce(s.seen_at > now() - interval '${ONLINE}', false) as online
           from pos_kot_kinds k
           left join pos_kot_stations s on s.id = k.station_id and s.is_active
          where k.id = $3 and k.hotel_id = $2
            and exists (select 1 from pos_order_lines l
                         where l.order_id = $1 and l.hotel_id = $2 and l.kot_no = $4
                           and coalesce(l.kot_kind_id, app.pos_line_kot_kind(l.id)) = k.id)`,
        [orderId, hotelId, kindId, kotNo]);
      const slip = rows[0];
      if (!slip) return refuse("No such KOT.");
      if (!slip.station) {
        return refuse(`No computer prints ${slip.kind} KOTs, so the reprint has nowhere to print. `
          + "Choose one in Restaurant setup - KOT section.");
      }
      await client.query(
        `insert into pos_kot_reprints (hotel_id, order_id, kot_no, kind_id, asked_by)
         values ($1, $2, $3, $4, $5)`,
        [hotelId, orderId, kotNo, kindId, session.staffId]);
      return {
        ok: true as const,
        station: { name: slip.station, online: slip.online, seenAt: slip.seen_at },
      };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* The station's claim of a reprint before the paper: the first asker
     prints, and only the computer that prints its kind. */
  till.post("/:code/till/kot-reprints/:id/printed", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { device?: unknown };
    if (!/^\d+$/.test(c.req.param("id"))) return c.json(refuse("No such reprint."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rowCount } = await client.query(
        `update pos_kot_reprints r set printed_at = now()
          where r.id = $2 and r.hotel_id = $1 and r.printed_at is null
            and r.kind_id in (select k.id from pos_kot_kinds k
                                join pos_kot_stations s on s.id = k.station_id
                               where k.hotel_id = $1 and k.is_active and s.device = $3 and s.is_active)`,
        [hotelId, c.req.param("id"), deviceOf(input.device)]);
      return { ok: true as const, claimed: rowCount === 1 };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result);
  });

  /* ── A bill to print ─────────────────────────────────────────────────
     Asked of the bill printer, silently. Its heading is decided now. An
     unpaid bill printed is the floor's "Bill printed", as before. With no
     bill printer the screen opens the bill as it always did (the owner);
     with one offline, it offers Print here. */
  till.post("/:code/till/orders/:id/bill-print", async (c) => {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const orderId = c.req.param("id");
      const { rows: order } = await client.query<{ status: string }>(
        `select status from pos_orders where id = $1 and hotel_id = $2`, [orderId, hotelId]);
      if (!order[0]) return refuse("No such order.");
      if (order[0].status === "abandoned") return refuse("This bill was closed unpaid. There is nothing to print.");
      if (order[0].status === "open") {
        await client.query(
          `update pos_orders set printed_at = coalesce(printed_at, now()) where id = $1`, [orderId]);
      }
      const heading = await headingFor(client, orderId, order[0].status);

      const { rows: printer } = await client.query<{ id: string; name: string; online: boolean }>(
        `select id::text, name, coalesce(seen_at > now() - interval '${ONLINE}', false) as online
           from pos_kot_stations where hotel_id = $1 and prints_bills and is_active`,
        [hotelId]);
      if (!printer[0]) return { ok: true as const, heading, sentTo: null };

      const { rows: job } = await client.query<{ id: string }>(
        `insert into pos_bill_prints (hotel_id, order_id, heading, station_id, asked_by)
         values ($1, $2, $3, $4, $5) returning id::text`,
        [hotelId, orderId, heading, printer[0].id, session.staffId]);
      return {
        ok: true as const, heading, jobId: job[0]!.id,
        sentTo: { name: printer[0].name, online: printer[0].online },
      };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* Printed on this device instead - the bill page's Print here. A bill
     waiting at the bill printer is taken off its list (the owner: "unless
     Print here was used") and this print is that one. */
  till.post("/:code/till/orders/:id/bill-print/here", async (c) => {
    const result = await withSession(c.get("subject"), async (client, session) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const orderId = c.req.param("id");
      const { rows: order } = await client.query<{ status: string }>(
        `select status from pos_orders where id = $1 and hotel_id = $2`, [orderId, hotelId]);
      if (!order[0]) return refuse("No such order.");
      /* Every bill of this order still waiting comes off the list; this
         print is the newest of them. */
      const { rows: waiting } = await client.query<{ heading: "interim" | "bill" | "duplicate" }>(
        `with off as (
           update pos_bill_prints set printed_here = true, printed_at = now()
            where order_id = $1 and printed_at is null and not printed_here
           returning heading, asked_at)
         select heading from off order by asked_at desc limit 1`,
        [orderId]);
      if (waiting[0]) return { ok: true as const, heading: waiting[0].heading };
      if (order[0].status === "open") {
        await client.query(
          `update pos_orders set printed_at = coalesce(printed_at, now()) where id = $1`, [orderId]);
      }
      const heading = await headingFor(client, orderId, order[0].status);
      await client.query(
        `insert into pos_bill_prints (hotel_id, order_id, heading, asked_by, printed_at, printed_here)
         values ($1, $2, $3, $4, now(), true)`,
        [hotelId, orderId, heading, session.staffId]);
      return { ok: true as const, heading };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result, result.ok ? 200 : 409);
  });

  /* The bill printer's claim before the paper: the first asker prints. */
  till.post("/:code/till/bill-prints/:id/printed", async (c) => {
    const input = await c.req.json().catch(() => ({})) as { device?: unknown };
    if (!/^\d+$/.test(c.req.param("id"))) return c.json(refuse("No such bill."), 409);
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rowCount } = await client.query(
        `update pos_bill_prints b set printed_at = now()
          where b.id = $2 and b.hotel_id = $1 and b.printed_at is null and not b.printed_here
            and b.station_id = (select s.id from pos_kot_stations s
                                 where s.hotel_id = $1 and s.device = $3 and s.is_active and s.prints_bills)`,
        [hotelId, c.req.param("id"), deviceOf(input.device)]);
      return { ok: true as const, claimed: rowCount === 1 };
    });
    if (!result) return c.json({ error: "No such property." }, 404);
    return c.json(result);
  });
}
