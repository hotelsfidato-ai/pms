import { Hono } from "hono";
import ExcelJS from "exceljs";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { phoneProblem } from "../../validate.ts";
import { renderPdf, renderXlsx, renderCsv } from "../../reportRender.ts";
import type { ReportDoc } from "../reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A GROUP'S ROOMING LIST (D27-383 item 8, built under D27-396)

   The group's rooms, each with its guest's name, the room type, the
   arrival and departure, the plan and who pays. A booking of several rooms
   is made in one guest's name (book.ts: "individual names are filled in as
   the rooming list arrives"); this is where they arrive. The desk types the
   names, or reads them from the Excel or CSV file the group sends, and on
   Save each name becomes the guest of its booking.

     read     GET  /:code/groups/:id/rooming-list           the list
              GET  ...?as=pdf|xlsx|csv                      printed or sent on
     check    POST /:code/groups/:id/rooming-list/read      a file: its columns
              matched, each row tied to a room, every problem listed - and
              nothing saved
     save     PUT  /:code/groups/:id/rooming-list           the names, all or
              none: one row wrong refuses the whole list

   WHAT THE LIST CHANGES: the guest's name and phone, on rooms still to
   arrive. The room type, the dates, the plan and who pays are the
   booking's, priced and billed: they are shown, printed and checked against
   the file, never changed from it (decided under D27-396) - Change dates,
   routing and the rest stay on the booking and the group's page, with their
   own rules. Whoever may change a booking may fill the list in.
   ══════════════════════════════════════════════════════════════════ */

export const rooming = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export interface ListRoom {
  reservationId: string; reference: string; guest: string; phone: string | null;
  roomType: string; roomTypeCode: string; room: string | null;
  checkIn: string; checkOut: string; mealPlan: string;
  whoPays: "host" | "guest"; status: string; editable: boolean;
}

/** The group's rooms that stand, with what the list shows; null: no such group. */
async function listFor(client: Client, hotelId: string, groupId: string) {
  if (!A_UUID.test(groupId)) return null;
  const { rows: g } = await client.query<{ name: string; block_code: string | null; company: string | null }>(
    `select g.name, g.block_code, co.name as company
       from reservation_groups g left join companies co on co.id = g.company_id
      where g.id = $1`, [groupId]);
  if (!g[0]) return null;
  const { rows } = await client.query<ListRoom>(
    `select r.id::text as "reservationId", r.reference, gu.full_name as guest, gu.phone,
            rt.name as "roomType", rt.code as "roomTypeCode", app.stay_room(r.id) as room,
            r.check_in::text as "checkIn", r.check_out::text as "checkOut", r.meal_plan as "mealPlan",
            case when r.route_room_to_group then 'host' else 'guest' end as "whoPays",
            r.status, r.status in ('confirmed', 'tentative') as editable
       from reservations r
       join guests gu     on gu.id = r.guest_id
       join room_types rt on rt.id = r.room_type_id
      where r.hotel_id = $1 and r.group_id = $2
        and r.status not in ('cancelled', 'no_show', 'void')
      order by rt.sort_order, rt.name, r.reference`,
    [hotelId, groupId]);
  if (rows.length === 0) return null;
  return { group: { id: groupId, name: g[0].name, blockCode: g[0].block_code, company: g[0].company }, rows };
}

const WHO_PAYS = { host: "Host", guest: "Guest" } as const;

rooming.get("/:code/groups/:id/rooming-list", async (c) => {
  const as = c.req.query("as");
  if (as !== undefined && as !== "pdf" && as !== "xlsx" && as !== "csv") {
    return c.json({ error: "A rooming list downloads as pdf, xlsx or csv." }, 400);
  }
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const list = await listFor(client, hotelId, c.req.param("id"));
    if (!list || !as) return list;
    const { rows: h } = await client.query<{
      code: string; name: string; address: string | null; gstin: string | null;
      timezone: string; test: boolean; me: string | null;
    }>(
      `select code, name, address_line as address, gstin, timezone, test_of is not null as test,
              (select full_name from staff where id = app.current_user_id()) as me
         from hotels where id = $1`, [hotelId]);
    return { ...list, hotel: h[0]! };
  });
  if (!body) return c.json({ error: "No such group." }, 404);
  if (!("hotel" in body)) return c.json(body);

  /* The front desk's and the group leader's copy: the shared renderer
     (reportRender.ts), as every report and a purchase order. No phone
     numbers: the copy leaves the hotel (decided under D27-396). */
  const { hotel, group, rows } = body;
  const doc: ReportDoc = {
    report: "rooming-list",
    title: "Rooming list",
    property: { code: hotel.code, name: hotel.name, address: hotel.address, gstin: hotel.gstin,
                timezone: hotel.timezone, ...(hotel.test ? { test: true } : {}) },
    orientation: "landscape",
    facts: [
      { label: "Group", value: group.name, kind: "text" },
      ...(group.company ? [{ label: "Company", value: group.company, kind: "text" as const }] : []),
      { label: "Rooms", value: rows.length, kind: "count" },
    ],
    sections: [{
      key: "rooms", title: group.blockCode ? `${group.name} · ${group.blockCode}` : group.name,
      columns: [
        { key: "reference", label: "Booking", kind: "text" },
        { key: "guest", label: "Guest name", kind: "text" },
        { key: "roomType", label: "Room type", kind: "text" },
        { key: "room", label: "Room", kind: "text" },
        { key: "arrival", label: "Arrival", kind: "date" },
        { key: "departure", label: "Departure", kind: "date" },
        { key: "plan", label: "Plan", kind: "text" },
        { key: "whoPays", label: "Who pays", kind: "text" },
      ],
      rows: rows.map((r) => ({ kind: "row" as const, cells: {
        reference: r.reference, guest: r.guest, roomType: r.roomType, room: r.room,
        arrival: r.checkIn, departure: r.checkOut, plan: r.mealPlan, whoPays: WHO_PAYS[r.whoPays],
      } })),
    }],
    footnotes: ["Who pays: Host is the group's master bill; Guest is the room's own bill."],
  };
  const by = { name: hotel.me ?? "-", at: new Date(), timezone: hotel.timezone };
  const file = as === "pdf" ? await renderPdf(doc, by)
    : as === "xlsx" ? await renderXlsx(doc, by)
    : Buffer.from(renderCsv(doc, by), "utf-8");
  const name = `${hotel.code}-rooming-list-${group.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${as}`;
  return c.body(new Uint8Array(file), 200, {
    "Content-Type": as === "pdf" ? "application/pdf"
      : as === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
});

/* ── Reading a file the group sent ─────────────────────────────────── */

type Field = "reference" | "guestName" | "phone" | "roomType" | "arrival" | "departure" | "mealPlan" | "whoPays";

/** Headers, as a group writes them, to the field they fill. Lower case,
    letters and digits only. "Room" (a room number) is read past. */
const HEADERS: Record<string, Field> = Object.fromEntries(([
  ["reference", ["booking", "bookingref", "bookingreference", "reference", "ref", "bookingno", "bookingnumber", "confirmation"]],
  ["guestName", ["guest", "guestname", "guestsname", "name", "fullname", "nameofguest"]],
  ["phone", ["phone", "mobile", "phoneno", "mobileno", "phonenumber", "mobilenumber", "contact", "contactno"]],
  ["roomType", ["roomtype", "type", "category", "roomcategory"]],
  ["arrival", ["arrival", "arrivaldate", "checkin", "checkindate", "from"]],
  ["departure", ["departure", "departuredate", "checkout", "checkoutdate", "to"]],
  ["mealPlan", ["plan", "mealplan", "meal"]],
  ["whoPays", ["whopays", "pays", "billing", "billto", "payment"]],
] as const).flatMap(([field, names]) => names.map((n) => [n, field])));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as a file writes it: an Excel date, 2026-11-12, 12/11/2026 or
    12-11-2026 (day first, as India writes it - decided under D27-396), or
    12 Nov 2026. Null when it is none of those. */
export function fileDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let y: number, m: number, d: number;
  let p: RegExpExecArray | null;
  if ((p = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+p[1]!, +p[2]!, +p[3]!];
  else if ((p = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [+p[1]!, +p[2]!, +p[3]!];
  else if ((p = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})$/.exec(s))) {
    [d, m, y] = [+p[1]!, MONTHS.indexOf(p[2]!.toLowerCase()) + 1, +p[3]!];
  } else return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** One CSV line, honouring quotes ("Sharma, Mr" is one name). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  /* Our own CSV writer prefixes a tab to =,+,-,@ (reportRender.ts). */
  return out.map((v) => v.replace(/^\t/, "").trim());
}

/** The file's rows as cells, the header first. Null with a sentence when
    it is not a file this reads. */
export async function fileRows(name: string, bytes: Buffer): Promise<unknown[][] | { reason: string }> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch {
      return { reason: "That Excel file could not be opened. Save it again as .xlsx or as CSV." };
    }
    const sheet = wb.worksheets[0];
    if (!sheet) return { reason: "That Excel file has no sheet." };
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value as unknown;
        /* A formula's result, a rich text's words, a link's text. */
        const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown } | null;
        cells[col - 1] = o && typeof o === "object" && !(v instanceof Date)
          ? o.result ?? o.richText?.map((t) => t.text).join("") ?? o.text ?? ""
          : v ?? "";
      });
      rows.push(cells);
    });
    return rows;
  }
  if (lower.endsWith(".xls")) {
    return { reason: "That is an old Excel file (.xls). Open it and save it as .xlsx or CSV." };
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return bytes.toString("utf-8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")
      .filter((l) => l.trim() !== "").map(csvCells);
  }
  return { reason: `"${name}" is not an Excel (.xlsx) or CSV file.` };
}

export interface ReadRow { line: number; reservationId: string; reference: string; guestName: string; phone: string }
export interface RowProblem { line: number; reason: string }

const norm = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const whoPaysOf = (v: string): "host" | "guest" | "unknown" | null => {
  const k = key(v);
  if (!k) return null;
  if (["host", "group", "master", "masterbill", "company"].includes(k)) return "host";
  if (["guest", "self", "own", "direct", "guestpays"].includes(k)) return "guest";
  return "unknown";
};

/** Each row of the file tied to one of the group's rooms, or why not.
    Matched by the Booking column where the file has it (the list this
    route prints carries it), else by room type, arrival, departure and
    plan, to the first such room not yet named in the file. */
export function matchRows(rows: unknown[][], rooms: ListRoom[]): {
  rows: ReadRow[]; problems: RowProblem[]; unknown: string[];
} {
  const problems: RowProblem[] = [];
  const header = (rows[0] ?? []).map((h) => HEADERS[key(h)] ?? null);
  const unknown = (rows[0] ?? []).map(norm).filter((h, i) => h && !header[i] && key(h) !== "room"
    && !["roomno", "roomnumber", "sno", "no", "slno", "nights", "adults", "children", "pax"].includes(key(h)));
  const col = (f: Field) => header.indexOf(f);
  if (col("guestName") < 0) {
    return { rows: [], unknown, problems: [{ line: 1, reason: "The file has no Guest name column." }] };
  }
  const byRef = col("reference") >= 0;
  if (!byRef && (col("roomType") < 0 || col("arrival") < 0 || col("departure") < 0)) {
    return { rows: [], unknown, problems: [{ line: 1,
      reason: "The file has no Booking column, so it needs Room type, Arrival and Departure to find each room." }] };
  }

  const taken = new Map<string, number>();
  const out: ReadRow[] = [];
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const at = (f: Field) => (col(f) >= 0 ? cells[col(f)] : undefined);
    if (cells.every((v) => norm(v instanceof Date ? "x" : v) === "")) return;
    const guestName = norm(at("guestName"));
    const phone = norm(at("phone"));
    const type = norm(at("roomType"));
    const arrival = at("arrival") === undefined || norm(at("arrival")) === "" ? null : fileDate(at("arrival"));
    const departure = at("departure") === undefined || norm(at("departure")) === "" ? null : fileDate(at("departure"));
    const plan = norm(at("mealPlan")).toUpperCase();
    const pays = whoPaysOf(norm(at("whoPays")));
    const say = (reason: string) => problems.push({ line, reason: `Row ${line}: ${reason}` });

    if (!guestName) return say("no guest name.");
    if (guestName.length > 120) return say("a name is at most 120 characters.");
    const badPhone = phoneProblem(phone);
    if (badPhone) return say(badPhone);
    if (norm(at("arrival")) && !arrival) return say(`"${norm(at("arrival"))}" is not a date (write 12/11/2026).`);
    if (norm(at("departure")) && !departure) return say(`"${norm(at("departure"))}" is not a date (write 12/11/2026).`);
    if (pays === "unknown") return say(`who pays is Host or Guest, not "${norm(at("whoPays"))}".`);

    const fits = (r: ListRoom) => (!type || key(type) === key(r.roomType) || key(type) === key(r.roomTypeCode))
      && (!arrival || arrival === r.checkIn) && (!departure || departure === r.checkOut)
      && (!plan || plan === r.mealPlan);
    let room: ListRoom | undefined;
    const ref = norm(at("reference"));
    if (byRef && ref) {
      room = rooms.find((r) => r.reference.toLowerCase() === ref.toLowerCase());
      if (!room) return say(`${ref} is not one of this group's rooms.`);
      if (!fits(room)) {
        return say(`${room.reference} is a ${room.roomType} from ${day(room.checkIn)} to ${day(room.checkOut)} `
          + `on ${room.mealPlan}, not what the file says. Change the booking first, or the file.`);
      }
    } else {
      if (!type || !arrival || !departure) return say("say the booking, or the room type, arrival and departure.");
      room = rooms.find((r) => r.editable && !taken.has(r.reservationId) && fits(r));
      if (!room) {
        return say(`no ${type} room of this group from ${day(arrival)} to ${day(departure)}`
          + `${plan ? ` on ${plan}` : ""} is left to name.`);
      }
    }
    if (taken.has(room.reservationId)) {
      return say(`${room.reference} is named twice, on rows ${taken.get(room.reservationId)} and ${line}.`);
    }
    if (!room.editable) {
      return say(`${room.reference} has ${room.status === "checked_in" ? "arrived" : "left"}; its guest is changed at the desk.`);
    }
    if (pays && pays !== room.whoPays) {
      return say(`${room.reference} is paid by the ${room.whoPays}, not the ${pays}. Who pays is changed on the group's page.`);
    }
    taken.set(room.reservationId, line);
    out.push({ line, reservationId: room.reservationId, reference: room.reference, guestName, phone });
  });
  if (out.length === 0 && problems.length === 0) {
    problems.push({ line: 1, reason: "The file has no rows under its headings." });
  }
  return { rows: out, problems, unknown };
}

rooming.post("/:code/groups/:id/rooming-list/read", async (c) => {
  const input = await c.req.json<{ name?: unknown; data?: unknown }>().catch(() => ({} as { name?: unknown; data?: unknown }));
  const name = typeof input.name === "string" ? input.name : "";
  const bytes = Buffer.from(typeof input.data === "string" ? input.data : "", "base64");
  if (!name || bytes.length === 0) return c.json(refuse("Choose the file the group sent."), 409);
  if (bytes.length > 2_000_000) return c.json(refuse("That file is over 2 MB - far bigger than a rooming list."), 409);
  const cells = await fileRows(name, bytes);
  if (!Array.isArray(cells)) return c.json(refuse(cells.reason), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const list = await listFor(client, hotelId, c.req.param("id"));
    if (!list) return null;
    const read = matchRows(cells, list.rows);
    /* NOTHING IS SAVED HERE: the rows come back for the screen to fill in,
       and Save sends them, checked again. */
    return { ok: read.problems.length === 0, rows: read.rows, problems: read.problems, unknownColumns: read.unknown };
  });
  if (!result) return c.json({ error: "No such group." }, 404);
  return c.json(result);
});

/* ── Saving: every name, or none ───────────────────────────────────── */

rooming.put("/:code/groups/:id/rooming-list", async (c) => {
  const input = await c.req.json<{ rows?: unknown }>().catch(() => ({} as { rows?: unknown }));
  const given = Array.isArray(input.rows) ? input.rows as { reservationId?: unknown; guestName?: unknown; phone?: unknown }[] : null;
  if (!given || given.length === 0) return c.json(refuse("Type at least one guest's name."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const list = await listFor(client, hotelId, c.req.param("id"));
    if (!list) return null;

    /* EVERY ROW IS CHECKED BEFORE ANY IS WRITTEN (MEMORY 243): a list with
       one wrong row saves nothing, and says which. */
    const problems: string[] = [];
    const seen = new Set<string>();
    const changes: { room: ListRoom; name: string; phone: string | null }[] = [];
    for (const g of given) {
      const room = list.rows.find((r) => r.reservationId === g.reservationId);
      const name = norm(g.guestName);
      const phone = norm(g.phone) || null;
      if (!room) { problems.push("One of those rooms is not in this group any more. Reload the list."); continue; }
      if (seen.has(room.reservationId)) { problems.push(`${room.reference} is given twice.`); continue; }
      seen.add(room.reservationId);
      if (!name) { problems.push(`${room.reference}: no guest name.`); continue; }
      if (name.length > 120) { problems.push(`${room.reference}: a name is at most 120 characters.`); continue; }
      const badPhone = phoneProblem(phone);
      if (badPhone) { problems.push(`${room.reference}: ${badPhone}`); continue; }
      if (name === room.guest && (phone === null || phone === room.phone)) continue;
      /* A record's phone is filled, never overwritten (book.ts's rule): a
         different number is changed on the guest's own record. */
      if (name === room.guest && room.phone) {
        problems.push(`${room.reference}: ${name} has ${room.phone} on file; change it on the guest's record.`);
        continue;
      }
      if (!room.editable) {
        problems.push(`${room.reference} has ${room.status === "checked_in" ? "arrived" : "left"}; its guest is changed at the desk.`);
        continue;
      }
      changes.push({ room, name, phone });
    }
    if (problems.length > 0) return { ...refuse(problems.join(" ")), problems };

    /* ── Nothing below this line refuses. ─────────────────────────────
       A name that is not the booking's guest becomes a guest of its own
       (guests are never deleted, 015); the same name with a phone fills
       that guest's blank phone. */
    for (const ch of changes) {
      if (ch.name === ch.room.guest) {
        await client.query(
          `update guests set phone = $2
             where id = (select guest_id from reservations where id = $1) and phone is null`,
          [ch.room.reservationId, ch.phone]);
        continue;
      }
      const { rows } = await client.query<{ id: string }>(
        "insert into guests (full_name, phone) values ($1, $2) returning id::text",
        [ch.name, ch.phone]);
      await client.query("update reservations set guest_id = $2 where id = $1",
        [ch.room.reservationId, rows[0]!.id]);
    }
    return { ok: true as const, changed: changes.length };
  });
  if (!result) return c.json({ error: "No such group." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
