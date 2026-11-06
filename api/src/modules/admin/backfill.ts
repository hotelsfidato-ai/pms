import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { canSend, messageIdFor, send, NOT_CONNECTED, type Message } from "../../sending.ts";
import { isTestHotelId, NOTHING_SENT } from "../../testHotels.ts";
import { countryProblem, emailProblem, idNumberProblem, phoneProblem } from "../../validate.ts";
import { inr } from "../../reportRender.ts";
import { isForeign, maskedId } from "../guests/index.ts";

/* ══════════════════════════════════════════════════════════════════
   BACKFILL DATA - what happened before a hotel's first day (the owner's
   D27-398, 7 November 2026; migration "backfill data")

     GET  /:code/backfill                         the register: stays,
                                                  restaurant bills, cash, and
                                                  what the screen needs
     POST /:code/backfill/:kind                   add       (kind: stays, bills, cash)
     PUT  /:code/backfill/:kind/:id               correct   (with a reason)
     POST /:code/backfill/:kind/:id/remove        remove    (with a reason; kept)

   A REGISTER OF ITS OWN: nothing here writes a booking, a bill, a payment,
   an order, a drawer or an invoice. The one live record touched is the
   guest - the desk's own suggestion (D21-20: "Same person" is the person's
   choice, checked again here by app.use_returning_guest) or a new guest
   record - so a returning guest is recognised.

   WHO: the owner, an Admin and the GM add, correct and remove; the
   Accountant reads (roleGate: `reservation` approve to write, `invoice`
   approve to read - exactly those three, and those four). The database
   asks the same (app.manages_hotel, app.reads_backfill) on every row.
   A guest's ID and visa numbers go only to the writers: the people who
   check guests in (D25-38), which the Accountant is not; an Aadhaar is its
   last four (D25-37).

   THE DATE RULE IS THE DATABASE'S (app.backfill_refusal): only days before
   the hotel's first live day, never a future one; a stay has left by the
   first day. Asked here first for the sentence, and by the tables' guard.

   THE SEND TICK (the owner's answer 3): "Send the guest their bill and
   thank-you", off unless ticked, on a stay only when it is added - so it is
   sent once, and a correction never sends it again. By email only, as the
   live tax invoice goes (D27-284: no WhatsApp template, and WhatsApp goes
   only through the CRS's approved ones, D27-266), through the one door out
   (sending.ts), which records it in messages_sent. The words are the
   workflow's `backfill-bill` email: the hotel's own bill number, never
   "tax invoice". A refused or failed send never undoes the save.
   ══════════════════════════════════════════════════════════════════ */

export const backfill = new Hono<{ Variables: { subject: string } }>();

const TABLES = { stays: "backfill_stays", bills: "backfill_restaurant_bills", cash: "backfill_cash" } as const;
type Kind = keyof typeof TABLES;
const isKind = (k: string): k is Kind => k in TABLES;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_TYPES = ["passport", "aadhaar", "driving_licence", "voter", "other"];

export const WRITERS_ONLY =
  "Backfilled records are entered, corrected and removed by the owner, an administrator or the general manager.";
export const READERS_ONLY =
  "Backfilled records are for the owner, an administrator, the general manager and the accountant.";

type Body = Record<string, unknown>;
type Refusal = { ok: false; reason: string };
const refuse = (reason: string): Refusal => ({ ok: false, reason });

/** Typed text, or null when blank. */
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** A figure typed, or null when left empty - never a zero for nothing (the owner's rule). */
function figure(v: unknown, what: string): { value: number | null } | Refusal {
  if (v === undefined || v === null || v === "") return { value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return refuse(`${what} is a figure of zero or more.`);
  return { value: Math.round(n * 100) / 100 };
}

const count = (v: unknown, min: number, fallback: number): number | null => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= 20 ? n : null;
};

interface Here {
  id: string; code: string; name: string; firstDay: string; today: string;
  writes: boolean; reads: boolean;
}

async function hotelHere(client: Client, code: string): Promise<Here | null> {
  const { rows } = await client.query<Here>(
    `select h.id::text, h.code, h.name,
            app.backfill_first_day(h.id)::text as "firstDay",
            (now() at time zone h.timezone)::date::text as today,
            app.manages_hotel(h.id) as writes, app.reads_backfill(h.id) as reads
       from hotels h where h.code = upper($1) and h.is_active`, [code]);
  return rows[0] ?? null;
}

/** Whether the tick can send at all here, and why not. */
async function sendable(client: Client, hotelId: string): Promise<{ ok: boolean; reason: string | null }> {
  if (await isTestHotelId(client, hotelId)) return { ok: false, reason: NOTHING_SENT };
  if (!canSend()) return { ok: false, reason: NOT_CONNECTED };
  return { ok: true, reason: null };
}

/** The hotel's ways of paying, by their words (191). */
async function methods(client: Client, hotelId: string): Promise<string[]> {
  const { rows } = await client.query<{ label: string }>(
    "select label from payment_methods where hotel_id = $1 and is_active order by sort_order, label", [hotelId]);
  return rows.map((r) => r.label);
}

/** The method as the hotel names it, or a refusal. */
async function method(client: Client, hotelId: string, v: unknown): Promise<{ value: string | null } | Refusal> {
  const typed = text(v);
  if (!typed) return { value: null };
  const { rows } = await client.query<{ label: string }>(
    "select label from payment_methods where hotel_id = $1 and lower(btrim(label)) = lower($2)", [hotelId, typed]);
  return rows[0] ? { value: rows[0].label } : refuse(`"${typed}" is not one of this hotel's payment methods.`);
}

const dateWords = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/* ── What each kind of record asks, checked before anything is written ── */

interface StayInput {
  guestId: string | null; guestName: string; phone: string | null; email: string | null;
  nationality: string; idType: string; idNumber: string | null; visaNumber: string | null;
  formCReference: string | null; roomId: string; arrival: string; departure: string;
  adults: number; children: number;
  rate: number | null; roomCharges: number | null; gst: number | null;
  otherCharges: number | null; otherChargesFor: string | null;
  paid: number | null; paidBy: string | null; billNumber: string | null; sendBill: boolean;
}

/** `adding`: the ID number must be typed; a correction may leave it blank (unchanged). */
async function stayInput(client: Client, hotelId: string, b: Body, adding: boolean): Promise<StayInput | Refusal> {
  const guestName = text(b["guestName"]);
  if (!guestName) return refuse("Type the guest's name.");
  if (guestName.length > 200) return refuse("A name is at most 200 characters.");
  const phone = text(b["phone"]);
  const email = text(b["email"])?.toLowerCase() ?? null;
  const nationality = (text(b["nationality"]) ?? "IN").toUpperCase();
  const idType = text(b["idType"]) ?? "";
  const idNumber = text(b["idNumber"]);
  const visaNumber = text(b["visaNumber"]);
  const wrong = phoneProblem(phone) ?? emailProblem(email) ?? countryProblem(nationality)
    ?? (ID_TYPES.includes(idType) ? null : "Choose the type of ID.")
    ?? (adding && !idNumber ? "Type the ID's number." : null)
    ?? idNumberProblem(idType, idNumber);
  if (wrong) return refuse(wrong);
  if (isForeign(nationality)) {
    if (idType !== "passport") return refuse("A foreign guest's ID is their passport (Form III).");
    if (!visaNumber && nationality !== "NP" && nationality !== "BT") {
      return refuse("Type a foreign guest's visa or OCI number (Form III).");
    }
  }
  const roomId = text(b["roomId"]);
  if (!roomId || !UUID.test(roomId)) return refuse("Choose the room.");
  const arrival = text(b["arrival"]) ?? "";
  const departure = text(b["departure"]) ?? "";
  if (!ISO.test(arrival) || !ISO.test(departure)) return refuse("Give the arrival and departure dates.");
  if (departure <= arrival) return refuse("The departure is after the arrival.");
  const adults = count(b["adults"], 1, 1);
  const children = count(b["children"], 0, 0);
  if (adults === null || children === null) return refuse("Adults are 1 to 20, children 0 to 20.");

  const money: Record<string, number | null> = {};
  for (const [key, what] of [["rate", "The rate a night"], ["roomCharges", "Room charges"], ["gst", "GST"],
                             ["otherCharges", "Other charges"], ["paid", "What was paid"]] as const) {
    const f = figure(b[key], what);
    if ("ok" in f) return f;
    money[key] = f.value;
  }
  const otherChargesFor = text(b["otherChargesFor"]);
  if (money["otherCharges"] !== null && !otherChargesFor) return refuse("Say in a word what the other charges were for.");
  const paidBy = await method(client, hotelId, b["paidBy"]);
  if ("ok" in paidBy) return paidBy;
  if ((money["paid"] === null) !== (paidBy.value === null)) {
    return refuse("Give what was paid and how, both or neither.");
  }
  const billNumber = text(b["billNumber"]);
  if (billNumber && billNumber.length > 40) return refuse("A bill number is at most 40 characters.");
  const guestId = text(b["guestId"]);
  if (guestId && !UUID.test(guestId)) return refuse("No such guest.");
  return {
    guestId, guestName, phone, email, nationality, idType, idNumber, visaNumber,
    formCReference: text(b["formCReference"]), roomId, arrival, departure, adults, children,
    rate: money["rate"]!, roomCharges: money["roomCharges"]!, gst: money["gst"]!,
    otherCharges: money["otherCharges"]!, otherChargesFor: money["otherCharges"] === null ? null : otherChargesFor,
    paid: money["paid"]!, paidBy: paidBy.value, billNumber, sendBill: b["sendBill"] === true,
  };
}

interface BillInput {
  outletId: string; billDate: string; billNumber: string | null;
  amount: number | null; gst: number | null; total: number | null; paidBy: string | null; note: string | null;
}

async function billInput(client: Client, hotelId: string, b: Body): Promise<BillInput | Refusal> {
  const outletId = text(b["outletId"]);
  if (!outletId || !UUID.test(outletId)) return refuse("Choose the restaurant.");
  const billDate = text(b["billDate"]) ?? "";
  if (!ISO.test(billDate)) return refuse("Give the bill's date.");
  const money: Record<string, number | null> = {};
  for (const [key, what] of [["amount", "The amount before GST"], ["gst", "GST"], ["total", "The total"]] as const) {
    const f = figure(b[key], what);
    if ("ok" in f) return f;
    money[key] = f.value;
  }
  const paidBy = await method(client, hotelId, b["paidBy"]);
  if ("ok" in paidBy) return paidBy;
  const note = text(b["note"]);
  if (note && note.length > 300) return refuse("A note is at most 300 characters.");
  const billNumber = text(b["billNumber"]);
  if (billNumber && billNumber.length > 40) return refuse("A bill number is at most 40 characters.");
  return { outletId, billDate, billNumber, amount: money["amount"]!, gst: money["gst"]!, total: money["total"]!,
           paidBy: paidBy.value, note };
}

interface CashInput { cashDate: string; direction: "in" | "out"; amount: number; purpose: string; person: string }

function cashInput(b: Body): CashInput | Refusal {
  const cashDate = text(b["cashDate"]) ?? "";
  if (!ISO.test(cashDate)) return refuse("Give the day.");
  const direction = b["direction"];
  if (direction !== "in" && direction !== "out") return refuse("Say whether the money came in or went out.");
  const f = figure(b["amount"], "The amount");
  if ("ok" in f) return f;
  if (!f.value) return refuse("Type the amount.");
  const purpose = text(b["purpose"]);
  if (!purpose) return refuse("Say what it was for.");
  const person = text(b["person"]);
  if (!person) return refuse("Say who paid it or took it.");
  if (purpose.length > 200 || person.length > 120) return refuse("Keep what it was for and who to a line each.");
  return { cashDate, direction, amount: f.value, purpose, person };
}

/** The date rule, in the database's words (one rule, app.backfill_refusal). */
async function dateRefusal(client: Client, hotelId: string, start: string, end: string): Promise<string | null> {
  const { rows } = await client.query<{ why: string | null }>(
    "select app.backfill_refusal($1, $2::date, $3::date) as why", [hotelId, start, end]);
  return rows[0]?.why ?? null;
}

/** Another backfilled stay in the room on one of these nights, named. */
async function roomClash(
  client: Client, roomId: string, arrival: string, departure: string, except: string | null,
): Promise<string | null> {
  const { rows } = await client.query<{ room: string; guest: string; a: string; d: string }>(
    `select rm.number as room, s.guest_name as guest, s.arrival::text as a, s.departure::text as d
       from backfill_stays s join rooms rm on rm.id = s.room_id
      where s.room_id = $1 and s.removed_at is null and s.id is distinct from $4::uuid
        and daterange(s.arrival, s.departure) && daterange($2::date, $3::date)
      order by s.arrival limit 1`, [roomId, arrival, departure, except]);
  const r = rows[0];
  return r ? `Room ${r.room} is already backfilled for ${r.guest}, ${dateWords(r.a)} to ${dateWords(r.d)}.` : null;
}

/** A refusal the database raised, in its words; anything else is thrown on. */
function databaseReason(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if (e?.code === "23P01") return "That room already has a backfilled stay on one of those nights.";
  if ((e?.code === "23514" || e?.code === "P0001") && e.message) return e.message;
  if (e?.code === "42501") return WRITERS_ONLY;
  return null;
}

/* ── The register ─────────────────────────────────────────────────── */

/* A person's name: their staff row where it is visible, else as the hotel's
   roster names them (deposits.ts does the same). */
const WHO = (alias: string, column: string) =>
  `coalesce((select st.full_name from staff st where st.id = ${alias}.${column}),
            (select hp.full_name from app.hotel_people($1) hp where hp.id = ${alias}.${column}))`;

const n = (v: string | null) => (v === null ? null : Number(v));

async function register(client: Client, here: Here) {
  const showsId = here.writes;
  const { rows: stays } = await client.query<Record<string, string | null> & { adults: number; children: number; send_bill: boolean }>(
    `select s.id::text, s.guest_id::text, s.guest_name, s.phone, s.email, s.nationality, s.id_type, s.id_number,
            s.visa_number, s.form_c_reference, s.room_id::text, rm.number as room,
            s.arrival::text, s.departure::text, s.adults, s.children,
            s.rate::text, s.room_charges::text, s.gst::text, s.other_charges::text, s.other_charges_for,
            s.paid::text, s.paid_by, s.bill_number, s.send_bill,
            m.status as message_status, m.detail as message_detail,
            app.hotel_clock(s.hotel_id, m.sent_at, 'DD Mon, HH24:MI') as message_at,
            ${WHO("s", "entered_by")} as entered_by, s.entered_at::text,
            ${WHO("s", "changed_by")} as changed_by, s.changed_at::text, s.change_reason,
            ${WHO("s", "removed_by")} as removed_by, s.removed_at::text, s.removed_reason
       from backfill_stays s
       join rooms rm on rm.id = s.room_id
       left join lateral (select x.status, x.detail, x.sent_at from messages_sent x
                           where x.hotel_id = s.hotel_id and x.about_kind = 'backfill-stay'
                             and x.about_id = s.id::text
                           order by x.sent_at desc limit 1) m on true
      where s.hotel_id = $1
      order by s.arrival desc, rm.number, s.entered_at`, [here.id]);
  const { rows: bills } = await client.query<Record<string, string | null>>(
    `select b.id::text, b.outlet_id::text, o.name as outlet, b.bill_date::text, b.bill_number,
            b.amount::text, b.gst::text, b.total::text, b.paid_by, b.note,
            ${WHO("b", "entered_by")} as entered_by, b.entered_at::text,
            ${WHO("b", "changed_by")} as changed_by, b.changed_at::text, b.change_reason,
            ${WHO("b", "removed_by")} as removed_by, b.removed_at::text, b.removed_reason
       from backfill_restaurant_bills b join pos_outlets o on o.id = b.outlet_id
      where b.hotel_id = $1
      order by b.bill_date desc, b.entered_at`, [here.id]);
  const { rows: cash } = await client.query<Record<string, string | null>>(
    `select c.id::text, c.cash_date::text, c.direction, c.amount::text, c.purpose, c.person,
            ${WHO("c", "entered_by")} as entered_by, c.entered_at::text,
            ${WHO("c", "changed_by")} as changed_by, c.changed_at::text, c.change_reason,
            ${WHO("c", "removed_by")} as removed_by, c.removed_at::text, c.removed_reason
       from backfill_cash c
      where c.hotel_id = $1
      order by c.cash_date desc, c.entered_at`, [here.id]);
  const trail = (r: Record<string, unknown>) => ({
    enteredBy: r["entered_by"] ?? null, enteredAt: r["entered_at"] ?? null,
    changedBy: r["changed_by"] ?? null, changedAt: r["changed_at"] ?? null, changeReason: r["change_reason"] ?? null,
    removedBy: r["removed_by"] ?? null, removedAt: r["removed_at"] ?? null, removedReason: r["removed_reason"] ?? null,
  });
  return {
    stays: stays.map((s) => ({
      id: s["id"], guestId: s["guest_id"], guestName: s["guest_name"], phone: s["phone"], email: s["email"],
      nationality: s["nationality"], idType: s["id_type"],
      idNumber: showsId ? maskedId(s["id_type"] ?? null, s["id_number"] ?? null) : null,
      visaNumber: showsId ? s["visa_number"] : null,
      formCReference: s["form_c_reference"], roomId: s["room_id"], room: s["room"],
      arrival: s["arrival"], departure: s["departure"], adults: s.adults, children: s.children,
      rate: n(s["rate"] ?? null), roomCharges: n(s["room_charges"] ?? null), gst: n(s["gst"] ?? null),
      otherCharges: n(s["other_charges"] ?? null), otherChargesFor: s["other_charges_for"],
      paid: n(s["paid"] ?? null), paidBy: s["paid_by"], billNumber: s["bill_number"], sendBill: s.send_bill,
      message: s["message_status"]
        ? { status: s["message_status"], at: s["message_at"], detail: s["message_detail"] } : null,
      ...trail(s),
    })),
    bills: bills.map((b) => ({
      id: b["id"], outletId: b["outlet_id"], outlet: b["outlet"], billDate: b["bill_date"],
      billNumber: b["bill_number"], amount: n(b["amount"] ?? null), gst: n(b["gst"] ?? null),
      total: n(b["total"] ?? null), paidBy: b["paid_by"], note: b["note"], ...trail(b),
    })),
    cash: cash.map((c) => ({
      id: c["id"], cashDate: c["cash_date"], direction: c["direction"], amount: n(c["amount"] ?? null),
      purpose: c["purpose"], person: c["person"], ...trail(c),
    })),
  };
}

backfill.get("/:code/backfill", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const here = await hotelHere(client, c.req.param("code"));
    if (!here) return { status: 404 as const, body: { error: "No such property." } };
    if (!here.reads) return { status: 403 as const, body: refuse(READERS_ONLY) };
    const { rows: rooms } = await client.query<{ id: string; number: string }>(
      "select id::text, number from rooms where hotel_id = $1 and is_active order by position, number", [here.id]);
    const { rows: outlets } = await client.query<{ id: string; name: string }>(
      "select id::text, name from pos_outlets where hotel_id = $1 and is_active order by name", [here.id]);
    return {
      status: 200 as const,
      body: {
        firstDay: here.firstDay, today: here.today, mayWrite: here.writes, showsId: here.writes,
        sending: await sendable(client, here.id),
        rooms, outlets, methods: await methods(client, here.id),
        ...(await register(client, here)),
      },
    };
  });
  return c.json(out.body, out.status);
});

/* ── Add ──────────────────────────────────────────────────────────── */

backfill.post("/:code/backfill/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!isKind(kind)) return c.json({ error: "No such kind of record." }, 404);
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  try {
    const out = await withSession(c.get("subject"), async (client, session) => {
      const here = await hotelHere(client, c.req.param("code"));
      if (!here) return { status: 404 as const, body: { error: "No such property." } };
      if (!here.writes) return { status: 403 as const, body: refuse(WRITERS_ONLY) };

      if (kind === "cash") {
        const v = cashInput(b);
        if ("ok" in v) return { status: 409 as const, body: v };
        const why = await dateRefusal(client, here.id, v.cashDate, v.cashDate);
        if (why) return { status: 409 as const, body: refuse(why) };
        const { rows } = await client.query<{ id: string }>(
          `insert into backfill_cash (hotel_id, cash_date, direction, amount, purpose, person)
           values ($1, $2::date, $3, $4, $5, $6) returning id::text`,
          [here.id, v.cashDate, v.direction, v.amount, v.purpose, v.person]);
        return { status: 200 as const, body: { ok: true as const, id: rows[0]!.id } };
      }

      if (kind === "bills") {
        const v = await billInput(client, here.id, b);
        if ("ok" in v) return { status: 409 as const, body: v };
        const why = await dateRefusal(client, here.id, v.billDate, v.billDate);
        if (why) return { status: 409 as const, body: refuse(why) };
        const { rows } = await client.query<{ id: string }>(
          `insert into backfill_restaurant_bills (hotel_id, outlet_id, bill_date, bill_number, amount, gst, total, paid_by, note)
           values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9) returning id::text`,
          [here.id, v.outletId, v.billDate, v.billNumber, v.amount, v.gst, v.total, v.paidBy, v.note]);
        return { status: 200 as const, body: { ok: true as const, id: rows[0]!.id } };
      }

      const v = await stayInput(client, here.id, b, true);
      if ("ok" in v) return { status: 409 as const, body: v };
      const why = await dateRefusal(client, here.id, v.arrival, v.departure)
        ?? await roomClash(client, v.roomId, v.arrival, v.departure, null);
      if (why) return { status: 409 as const, body: refuse(why) };
      if (v.sendBill) {
        const can = await sendable(client, here.id);
        if (!can.ok) return { status: 409 as const, body: refuse(`The bill cannot be sent: ${can.reason}`) };
        if (!v.email) return { status: 409 as const, body: refuse("Type the guest's email to send them the bill, or untick it.") };
      }

      /* The guest: the person chosen as "Same person", checked again; else a
         new guest record. A returning guest's blank phone or email is filled,
         nothing on file overwritten (app.use_returning_guest). */
      let guestId: string | null = null;
      if (v.guestId) {
        const { rows } = await client.query<{ id: string | null }>(
          "select app.use_returning_guest($1::uuid, $2, $3)::text as id", [v.guestId, v.phone, v.email]);
        guestId = rows[0]?.id ?? null;
        if (!guestId) {
          return { status: 409 as const, body: refuse(
            "That guest no longer matches the phone or email typed. Check the suggestion again, or add them as a new guest.") };
        }
      } else {
        const { rows } = await client.query<{ id: string }>(
          "insert into guests (full_name, phone, email, nationality) values ($1, $2, $3, $4) returning id::text",
          [v.guestName, v.phone, v.email, v.nationality]);
        guestId = rows[0]!.id;
      }

      const { rows } = await client.query<{ id: string }>(
        `insert into backfill_stays
           (hotel_id, guest_id, guest_name, phone, email, nationality, id_type, id_number, visa_number,
            form_c_reference, room_id, arrival, departure, adults, children, rate, room_charges, gst,
            other_charges, other_charges_for, paid, paid_by, bill_number, send_bill)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         returning id::text`,
        [here.id, guestId, v.guestName, v.phone, v.email, v.nationality, v.idType, v.idNumber, v.visaNumber,
         v.formCReference, v.roomId, v.arrival, v.departure, v.adults, v.children, v.rate, v.roomCharges, v.gst,
         v.otherCharges, v.otherChargesFor, v.paid, v.paidBy, v.billNumber, v.sendBill]);
      const id = rows[0]!.id;
      if (!v.sendBill) return { status: 200 as const, body: { ok: true as const, id, sent: null } };

      const { rows: room } = await client.query<{ number: string }>("select number from rooms where id = $1", [v.roomId]);
      const rupees = (x: number | null) => (x === null ? "-" : `INR ${inr(x)}`);
      const total = v.roomCharges === null && v.gst === null && v.otherCharges === null ? null
        : (v.roomCharges ?? 0) + (v.gst ?? 0) + (v.otherCharges ?? 0);
      const message: Message = {
        id: messageIdFor("backfill-bill", id),
        channel: "email",
        kind: "backfill-bill",
        hotel: { id: here.id, code: here.code, name: here.name },
        to: { name: v.guestName, phone: v.phone, email: v.email },
        data: {
          guestName: v.guestName, hotelName: here.name, billNumber: v.billNumber ?? "-",
          arrival: dateWords(v.arrival), departure: dateWords(v.departure), room: room[0]?.number ?? "-",
          roomCharges: rupees(v.roomCharges), gst: rupees(v.gst),
          otherCharges: v.otherCharges === null ? "-" : `${rupees(v.otherCharges)} (${v.otherChargesFor})`,
          total: rupees(total), paid: v.paid === null ? "-" : `${rupees(v.paid)} by ${v.paidBy}`,
        },
        about: { kind: "backfill-stay", id },
        sentBy: { id: session.staffId, name: session.fullName },
      };
      const answer = await send(client, message);
      return { status: 200 as const, body: { ok: true as const, id, sent: answer.ok ? true : answer.reason } };
    });
    return c.json(out.body, out.status);
  } catch (error) {
    const reason = databaseReason(error);
    if (reason) return c.json(refuse(reason), 409);
    throw error;
  }
});

/* ── Correct, with a reason. Never sends. ─────────────────────────── */

backfill.put("/:code/backfill/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  const id = c.req.param("id");
  if (!isKind(kind) || !UUID.test(id)) return c.json({ error: "No such record." }, 404);
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const reason = text(b["reason"]);
  if (!reason) return c.json(refuse("Say why it is being corrected."), 409);
  if (reason.length > 300) return c.json(refuse("A reason is at most 300 characters."), 409);
  try {
    const out = await withSession(c.get("subject"), async (client) => {
      const here = await hotelHere(client, c.req.param("code"));
      if (!here) return { status: 404 as const, body: { error: "No such property." } };
      if (!here.writes) return { status: 403 as const, body: refuse(WRITERS_ONLY) };
      const { rows: was } = await client.query<{ removed: boolean }>(
        `select removed_at is not null as removed from ${TABLES[kind]} where id = $1 and hotel_id = $2`, [id, here.id]);
      if (!was[0]) return { status: 404 as const, body: { error: "No such record." } };
      if (was[0].removed) return { status: 409 as const, body: refuse("A removed record stays as it was. Add it again if it was right.") };

      if (kind === "cash") {
        const v = cashInput(b);
        if ("ok" in v) return { status: 409 as const, body: v };
        const why = await dateRefusal(client, here.id, v.cashDate, v.cashDate);
        if (why) return { status: 409 as const, body: refuse(why) };
        await client.query(
          `update backfill_cash set cash_date = $2::date, direction = $3, amount = $4, purpose = $5, person = $6,
                  change_reason = $7 where id = $1`,
          [id, v.cashDate, v.direction, v.amount, v.purpose, v.person, reason]);
      } else if (kind === "bills") {
        const v = await billInput(client, here.id, b);
        if ("ok" in v) return { status: 409 as const, body: v };
        const why = await dateRefusal(client, here.id, v.billDate, v.billDate);
        if (why) return { status: 409 as const, body: refuse(why) };
        await client.query(
          `update backfill_restaurant_bills set outlet_id = $2, bill_date = $3::date, bill_number = $4, amount = $5,
                  gst = $6, total = $7, paid_by = $8, note = $9, change_reason = $10 where id = $1`,
          [id, v.outletId, v.billDate, v.billNumber, v.amount, v.gst, v.total, v.paidBy, v.note, reason]);
      } else {
        const v = await stayInput(client, here.id, b, false);
        if ("ok" in v) return { status: 409 as const, body: v };
        const why = await dateRefusal(client, here.id, v.arrival, v.departure)
          ?? await roomClash(client, v.roomId, v.arrival, v.departure, id);
        if (why) return { status: 409 as const, body: refuse(why) };
        /* The register's record only: the guest record is corrected on Guest
           360, and the tick is the add's alone - a correction never sends. A
           blank ID number keeps the one on file (it is shown masked). */
        await client.query(
          `update backfill_stays set guest_name = $2, phone = $3, email = $4, nationality = $5, id_type = $6,
                  id_number = coalesce($7, id_number), visa_number = $8, form_c_reference = $9, room_id = $10,
                  arrival = $11::date, departure = $12::date, adults = $13, children = $14, rate = $15,
                  room_charges = $16, gst = $17, other_charges = $18, other_charges_for = $19, paid = $20,
                  paid_by = $21, bill_number = $22, change_reason = $23
            where id = $1`,
          [id, v.guestName, v.phone, v.email, v.nationality, v.idType, v.idNumber, v.visaNumber, v.formCReference,
           v.roomId, v.arrival, v.departure, v.adults, v.children, v.rate, v.roomCharges, v.gst, v.otherCharges,
           v.otherChargesFor, v.paid, v.paidBy, v.billNumber, reason]);
      }
      return { status: 200 as const, body: { ok: true as const } };
    });
    return c.json(out.body, out.status);
  } catch (error) {
    const why = databaseReason(error);
    if (why) return c.json(refuse(why), 409);
    throw error;
  }
});

/* ── Remove, with a reason: kept, marked, never deleted ───────────── */

backfill.post("/:code/backfill/:kind/:id/remove", async (c) => {
  const kind = c.req.param("kind");
  const id = c.req.param("id");
  if (!isKind(kind) || !UUID.test(id)) return c.json({ error: "No such record." }, 404);
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const reason = text(b["reason"]);
  if (!reason) return c.json(refuse("Say why it is being removed."), 409);
  if (reason.length > 300) return c.json(refuse("A reason is at most 300 characters."), 409);
  try {
    const out = await withSession(c.get("subject"), async (client) => {
      const here = await hotelHere(client, c.req.param("code"));
      if (!here) return { status: 404 as const, body: { error: "No such property." } };
      if (!here.writes) return { status: 403 as const, body: refuse(WRITERS_ONLY) };
      const { rowCount } = await client.query(
        `update ${TABLES[kind]} set removed_at = now(), removed_reason = $3
          where id = $1 and hotel_id = $2 and removed_at is null`, [id, here.id, reason]);
      return rowCount
        ? { status: 200 as const, body: { ok: true as const } }
        : { status: 404 as const, body: { error: "No such record, or it was removed already." } };
    });
    return c.json(out.body, out.status);
  } catch (error) {
    const why = databaseReason(error);
    if (why) return c.json(refuse(why), 409);
    throw error;
  }
});
