import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { countryProblem, emailProblem, gstinProblem, phoneProblem } from "../../validate.ts";
import { makeBooking, fileRows, fileDate } from "../reservations/index.ts";

/* ══════════════════════════════════════════════════════════════════
   BRINGING IN AN OLD SYSTEM'S GUESTS AND BOOKINGS (D27-383 item 7,
   built under D27-396; migration "old system import")

     GET  /:code/imports                  what was brought in here, the
                                          bookings still without a rate
     POST /:code/imports/:kind/check      a file read and every row checked;
                                          NOTHING is saved
     POST /:code/imports/:kind            saved: one transaction
     POST /:code/imports/:id/undo         taken back, while nothing has
                                          touched it (app.undo_data_import)

   kind: guests | bookings. The file is an Excel (.xlsx) or CSV, read as a
   rooming list is (reservations' fileRows); its columns are matched by the
   person on screen, and the match is kept for the hotel's next file.

   ONE PATH FOR THE CHECK AND THE SAVE. The check does exactly what the
   save would, inside a savepoint it then rolls back - so what it lists is
   what Save does, the last free room and a guest two rows share included.

   WHAT STOPS THE SAVE AND WHAT IS LISTED. A row the FILE gets wrong (no
   name, a date that is not one, a plan, method or ID type this system does
   not know, a guest twice) stops everything: nothing is saved until the
   file is right. A guest already on file waits for the person's choice -
   keep (a new record), merge (the empty fields filled, nothing on file
   overwritten) or skip; never merged by itself. A booking THE HOTEL cannot
   take - no such room type, the nights full, a source not on its list, a
   guest in the house today - is refused, listed and recorded, and the rest
   are saved together.

   A FUTURE BOOKING is an ordinary confirmed booking, made by makeBooking
   (the desk's and the channel manager's one act) and never overbooked. Its
   guest is sent nothing at import time - the old system confirmed it -
   unless the import ticks "Send each guest our booking voucher" (the
   master, under D27-396; the sweep asks app.quietly_imported). No
   rate: a dash, listed here until the desk sets it; check-in refuses it.
   Its advance is a payment on its bill, dated the day it was paid, "brought
   in from <system>": never an invoice, never in a drawer, and only from
   before the hotel's first day here. A PAST STAY is history only
   (imported_stays): Guest 360 and the visit count, no money at all.

   WHO: the owner or an Admin at the hotel (app.imports_old_data, the module
   switches' pair). The database asks the same on every row.
   ══════════════════════════════════════════════════════════════════ */

export const oldSystem = new Hono<{ Variables: { subject: string } }>();

export const IMPORT_REFUSED =
  "Bringing in an old system's guests and bookings is for the owner or an administrator. Ask one of them.";

type Kind = "guests" | "bookings";
const isKind = (k: string): k is Kind => k === "guests" || k === "bookings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOST_ROWS = 5000;

/* ── The fields, and the headings old systems give them ─────────────
   Lower case, letters and digits only. */
interface Field { key: string; label: string; required?: true; note?: string; names: string[] }

const GUEST_FIELDS: Field[] = [
  { key: "name", label: "Guest name", required: true, names: ["name", "guestname", "guestsname", "fullname", "guest", "nameofguest"] },
  { key: "phone", label: "Phone", names: ["phone", "mobile", "mobileno", "phoneno", "phonenumber", "mobilenumber", "contact", "contactno", "cell"] },
  { key: "email", label: "Email", names: ["email", "emailid", "mail", "emailaddress"] },
  { key: "address", label: "Address", names: ["address", "addressline", "address1", "street"] },
  { key: "city", label: "City", names: ["city", "town"] },
  { key: "state", label: "State", names: ["state", "province"] },
  { key: "pincode", label: "Pincode", names: ["pincode", "pin", "zip", "zipcode", "postcode", "postalcode"] },
  { key: "country", label: "Country", names: ["country"] },
  { key: "nationality", label: "Nationality", note: "Two letters (IN, GB, US), or India. Blank: IN.", names: ["nationality", "nation", "citizenship"] },
  { key: "idType", label: "ID type", note: "Aadhaar, Passport, Driving licence, Voter ID or Other.", names: ["idtype", "documenttype", "idproof", "proof", "typeofid", "proofofid"] },
  { key: "idNumber", label: "ID number", note: "Only its last four are kept, never the whole number.", names: ["idnumber", "idno", "documentnumber", "documentno", "proofnumber", "proofno", "idlast4", "last4", "aadhaar", "aadhar", "aadhaarno", "passportno"] },
  { key: "dob", label: "Date of birth", names: ["dob", "dateofbirth", "birthdate", "birthday"] },
  { key: "company", label: "Company", names: ["company", "companyname", "organisation", "organization", "firm"] },
  { key: "gstin", label: "GSTIN", names: ["gstin", "gst", "gstno", "gstnumber", "gstin no"] },
  { key: "notes", label: "Notes", names: ["notes", "note", "remarks", "comments", "remark"] },
];

const BOOKING_FIELDS: Field[] = [
  { key: "reference", label: "Old reference", note: "The old system's booking number: the same booking is never brought in twice.", names: ["reference", "ref", "bookingno", "bookingid", "bookingref", "bookingnumber", "reservationno", "resno", "reservationnumber", "confirmation", "confirmationno"] },
  { key: "guestName", label: "Guest name", required: true, names: ["guest", "guestname", "name", "fullname", "guestsname", "nameofguest"] },
  { key: "phone", label: "Phone", names: ["phone", "mobile", "mobileno", "phoneno", "phonenumber", "mobilenumber", "contact", "contactno"] },
  { key: "email", label: "Email", names: ["email", "emailid", "mail", "emailaddress"] },
  { key: "arrival", label: "Arrival", required: true, names: ["arrival", "arrivaldate", "checkin", "checkindate", "from", "fromdate"] },
  { key: "departure", label: "Departure", required: true, names: ["departure", "departuredate", "checkout", "checkoutdate", "to", "todate"] },
  { key: "roomType", label: "Room type", note: "Its name or code here. A booking to come needs one this hotel has.", names: ["roomtype", "type", "category", "roomcategory"] },
  { key: "room", label: "Room", note: "If known: held for the booking when free.", names: ["room", "roomno", "roomnumber"] },
  { key: "rate", label: "Rate", note: "Per night, before GST. Blank: a dash, and the desk sets it before arrival.", names: ["rate", "tariff", "roomrate", "rateperday", "pernight", "nightlyrate", "roomtariff"] },
  { key: "plan", label: "Plan", note: "EP, CP, MAP or AP. Blank: EP.", names: ["plan", "mealplan", "meal"] },
  { key: "adults", label: "Adults", names: ["adults", "adult", "pax", "noofadults"] },
  { key: "children", label: "Children", names: ["children", "child", "kids", "noofchildren"] },
  { key: "source", label: "Source", note: "As it is named under Booking sources, e.g. Booking.com. Needed for a booking to come.", names: ["source", "bookingsource", "channel", "bookedvia", "via", "segment"] },
  { key: "advance", label: "Advance paid", names: ["advance", "advancepaid", "deposit", "amountpaid", "paid", "advanceamount"] },
  { key: "advanceDate", label: "Advance date", names: ["advancedate", "paidon", "depositdate", "paymentdate", "dateofpayment", "advancepaidon"] },
  { key: "advanceMethod", label: "Advance method", note: "One of this hotel's payment methods.", names: ["paymentmethod", "paidby", "mode", "paymentmode", "method", "advancemode"] },
];

export const FIELDS: Record<Kind, Field[]> = { guests: GUEST_FIELDS, bookings: BOOKING_FIELDS };

const key = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const norm = (v: unknown): string =>
  v instanceof Date ? (Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)) : String(v ?? "").trim();
const words = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The matching: field -> the file's heading ("" for none). What the person
    chose where they chose; else the hotel's last match, where the file still
    has that heading; else a heading by its usual name. */
export function matchColumns(
  headers: string[], fields: Field[], chosen: Record<string, unknown> | null, saved: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const pick = chosen?.[f.key];
    if (typeof pick === "string") { out[f.key] = headers.includes(pick) ? pick : ""; continue; }
    const last = saved[f.key];
    const guess = last && headers.includes(last) && !used.has(last) ? last
      : headers.find((h) => !used.has(h) && f.names.includes(key(h))) ?? "";
    out[f.key] = guess;
    if (guess) used.add(guess);
  }
  return out;
}

const ID_TYPES: Record<string, string> = {
  aadhaar: "aadhaar", aadhar: "aadhaar", aadhaarcard: "aadhaar", uid: "aadhaar",
  passport: "passport", drivinglicence: "driving_licence", drivinglicense: "driving_licence", dl: "driving_licence",
  licence: "driving_licence", license: "driving_licence", voter: "voter", voterid: "voter", votercard: "voter", epic: "voter",
  other: "other", pan: "other", pancard: "other",
};
const ID_WORD: Record<string, string> = {
  aadhaar: "Aadhaar", passport: "Passport", driving_licence: "Driving licence", voter: "Voter ID", other: "ID",
};

/* ── One row, as checked ───────────────────────────────────────────── */

export interface Match { id: string; name: string; visits: number }
export interface RowCheck {
  line: number;
  name: string;
  /** What it is, in a few words: the dates and room type, or the phone and email. */
  what: string;
  /** new | duplicate | merge | skip (guests); booking | stay (bookings); refused. */
  action: string;
  /** The file's faults: any stops the save. */
  problems: string[];
  /** Why the hotel cannot take it: listed, the rest saved. */
  refused?: string;
  /** Said, not stopping anything: no rate, no room held. */
  notes: string[];
  /** Guests on file with the same phone or email. */
  matches?: Match[];
}

type Choice = { action: "keep" } | { action: "skip" } | { action: "merge"; guestId: string };
const CHOOSE_ONE = "Already on file: choose keep, merge or skip.";

interface Here { id: string; code: string; businessDate: string; firstDay: string; today: string; may: boolean }

async function hotelHere(client: Client, code: string): Promise<Here | null> {
  const { rows } = await client.query<Here>(
    `select h.id::text, h.code, app.business_date(h.id)::text as "businessDate",
            app.backfill_first_day(h.id)::text as "firstDay",
            (now() at time zone h.timezone)::date::text as today,
            app.imports_old_data(h.id) as may
       from hotels h where h.code = upper($1) and h.is_active`, [code]);
  return rows[0] ?? null;
}

const text = (v: string, most: number, what: string, problems: string[]): string | null => {
  if (!v) return null;
  if (v.length > most) { problems.push(`${what} is at most ${most} characters.`); return null; }
  return v;
};

function amount(v: string, what: string, problems: string[]): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 99_999_999) {
    problems.push(`${what} "${v}" is not an amount above 0.`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

function count(v: string, what: string, min: number, problems: string[]): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 20) { problems.push(`${what} "${v}" is not a number from ${min} to 20.`); return undefined; }
  return n;
}

function day(v: unknown, what: string, problems: string[]): string | null {
  if (norm(v) === "") return null;
  const d = fileDate(v);
  if (!d) problems.push(`${what} "${norm(v)}" is not a date (write 12/11/2026).`);
  return d;
}

/* ── The guests' file ──────────────────────────────────────────────── */

interface GuestRow {
  line: number; name: string; phone: string | null; email: string | null; nationality: string;
  documents: { address: string | null; city: string | null; state: string | null; pincode: string | null;
               country: string | null; dob: string | null } | null;
  notes: string | null;
}

async function guestsRun(
  client: Client, here: Here, system: string, cells: unknown[][], cols: Record<string, string>,
  choices: Record<string, Choice>, importId: string | null,
): Promise<{ rows: RowCheck[]; plan: { row: GuestRow; check: RowCheck; choice: Choice | null }[] }> {
  const headers = (cells[0] ?? []).map(norm);
  const at = (r: unknown[], f: string) => (cols[f] ? norm(r[headers.indexOf(cols[f]!)]) : "");
  const out: { row: GuestRow; check: RowCheck; choice: Choice | null }[] = [];
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  const read: { line: number; cells: unknown[] }[] = [];
  cells.slice(1).forEach((r, i) => { if (r.some((v) => norm(v) !== "")) read.push({ line: i + 2, cells: r }); });

  for (const { line, cells: r } of read) {
    const problems: string[] = [];
    const notes: string[] = [];
    const name = at(r, "name");
    if (!name) problems.push("No guest name.");
    else if (name.length > 120) problems.push("A name is at most 120 characters.");
    const phone = at(r, "phone") || null;
    const badPhone = phoneProblem(phone);
    if (badPhone) problems.push(badPhone);
    const email = at(r, "email") || null;
    const badEmail = emailProblem(email);
    if (badEmail) problems.push(badEmail);
    let nationality = at(r, "nationality").toUpperCase();
    if (!nationality || ["INDIA", "INDIAN"].includes(nationality)) nationality = "IN";
    const badCountry = countryProblem(nationality);
    if (badCountry) problems.push(`Nationality: ${badCountry}`);
    const idWord = at(r, "idType");
    const idType = idWord ? ID_TYPES[key(idWord)] ?? null : null;
    if (idWord && !idType) problems.push(`"${idWord}" is not an ID type here: Aadhaar, Passport, Driving licence, Voter ID or Other.`);
    /* NEVER A WHOLE ID NUMBER (the brief; D25-37 for an Aadhaar): its last
       four, and nothing else is read, kept or sent back. */
    const last4 = at(r, "idNumber").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
    if (last4 && last4.length < 4) problems.push("An ID number needs at least its last four characters.");
    if (last4 && !idType && !idWord) problems.push("Say which ID the number is (the ID type column).");
    const dob = day(at(r, "dob"), "Date of birth", problems);
    if (dob && (dob > here.today || dob < "1900-01-01")) problems.push("The date of birth is not a past date.");
    const gstin = at(r, "gstin").toUpperCase() || null;
    const badGstin = gstinProblem(gstin);
    if (badGstin) problems.push(badGstin);
    const company = text(at(r, "company"), 200, "A company", problems);
    const ownNotes = text(at(r, "notes"), 1000, "Notes", problems);
    const address = text(at(r, "address"), 300, "An address", problems);
    const city = text(at(r, "city"), 80, "A city", problems);
    const state = text(at(r, "state"), 80, "A state", problems);
    const pincode = text(at(r, "pincode"), 12, "A pincode", problems);
    const country = text(at(r, "country"), 80, "A country", problems);

    /* One person, one row (D21-2's "one guest, one record"). */
    const pk = phone?.replace(/\D/g, "").slice(-10) || null;
    const ek = email?.toLowerCase() || null;
    if (pk && seenPhone.has(pk)) problems.push(`The same phone as row ${seenPhone.get(pk)}: one guest, one row.`);
    else if (ek && seenEmail.has(ek)) problems.push(`The same email as row ${seenEmail.get(ek)}: one guest, one row.`);
    if (pk && !seenPhone.has(pk)) seenPhone.set(pk, line);
    if (ek && !seenEmail.has(ek)) seenEmail.set(ek, line);

    /* The company and the GSTIN have no field on a guest's record; the ID's
       last four is not a document anybody here has seen. So all three go
       in the guest's notes, where the desk reads them (decided under
       D27-396), and never in the ID register. */
    const noteLine = [ownNotes, company && `Company: ${company}`, gstin && `GSTIN ${gstin}`,
      idType && last4 && `ID in ${system}: ${ID_WORD[idType]} ending ${last4}`].filter(Boolean).join(" · ") || null;
    if (noteLine && noteLine.length > 2000) problems.push("Notes, company and GSTIN together are at most 2,000 characters.");
    const docs = [address, city, state, pincode, country, dob].some((v) => v !== null)
      ? { address, city, state, pincode, country, dob } : null;

    out.push({
      row: { line, name, phone, email, nationality, documents: docs, notes: noteLine },
      check: { line, name, what: [phone, email].filter(Boolean).join(", ") || "-", action: "new", problems, notes },
      choice: choices[String(line)] ?? null,
    });
  }

  /* Who is on file already, by phone or email, in one query: the desk's
     own suggestion (D21-20, app.guest_suggestions), never decided here. */
  const { rows: hits } = await client.query<{ line: number; id: string; name: string; visits: number }>(
    `select t.line, s.guest_id::text as id, s.full_name as name, s.visits
       from unnest($1::int[], $2::text[], $3::text[]) as t(line, phone, email)
      cross join lateral app.guest_suggestions(t.phone, t.email) s
      order by t.line, s.full_name`,
    [out.map((o) => o.row.line), out.map((o) => o.row.phone), out.map((o) => o.row.email)]);
  for (const h of hits) {
    const o = out.find((x) => x.row.line === h.line)!;
    (o.check.matches ??= []).push({ id: h.id, name: h.name, visits: h.visits });
  }

  const mergedInto = new Map<string, number>();
  for (const o of out) {
    if (!o.check.matches) continue;
    o.check.action = "duplicate";
    const c = o.choice;
    if (!c) { o.check.problems.push(CHOOSE_ONE); continue; }
    if (c.action === "merge" && !o.check.matches.some((m) => m.id === c.guestId)) {
      o.check.problems.push("Merge with one of the guests listed."); continue;
    }
    if (c.action === "merge" && mergedInto.has(c.guestId)) {
      o.check.problems.push(`Row ${mergedInto.get(c.guestId)} merges into the same guest: one guest, one row.`); continue;
    }
    if (c.action === "merge") mergedInto.set(c.guestId, o.row.line);
    o.check.action = c.action === "keep" ? "new" : c.action;
  }

  /* Written only for the save, or inside the check's savepoint. */
  if (out.every((o) => o.check.problems.length === 0)) {
    for (const o of out) {
      const { row, check, choice } = o;
      if (check.action === "skip") continue;
      if (check.action === "merge" && choice?.action === "merge") {
        const { rows: [was] } = await client.query<{ phone: string | null; email: string | null; notes: string | null }>(
          "select phone, email::text, notes from guests where id = $1", [choice.guestId]);
        const filled: string[] = [];
        if (was && !was.phone && row.phone) filled.push("phone");
        if (was && !was.email && row.email) filled.push("email");
        if (was && !was.notes?.trim() && row.notes) filled.push("notes");
        /* Filled, never overwritten (book.ts's rule). */
        await client.query(
          `update guests set phone = coalesce(phone, $2), email = coalesce(email, $3::citext),
                  notes = coalesce(nullif(btrim(notes), ''), $4)
            where id = $1 and (($2::text is not null and phone is null) or ($3::text is not null and email is null)
                               or ($4::text is not null and nullif(btrim(notes), '') is null))`,
          [choice.guestId, row.phone, row.email, row.notes]);
        if (row.documents) {
          const { rowCount } = await client.query(
            `insert into guest_documents (guest_id, address_line, city, state, pincode, country, date_of_birth)
             values ($1, $2, $3, $4, $5, $6, $7::date) on conflict (guest_id) do nothing`,
            [choice.guestId, row.documents.address, row.documents.city, row.documents.state,
             row.documents.pincode, row.documents.country, row.documents.dob]);
          if (rowCount) filled.push("documents");
        }
        if (filled.length && importId) {
          await client.query(
            `insert into data_import_items (import_id, kind, row_id, line, filled) values ($1, 'guest_filled', $2, $3, $4)`,
            [importId, choice.guestId, row.line, JSON.stringify(filled)]);
        }
        continue;
      }
      const { rows: [made] } = await client.query<{ id: string }>(
        `insert into guests (full_name, phone, email, nationality, notes)
         values ($1, $2, $3, $4, $5) returning id::text`,
        [row.name, row.phone, row.email, row.nationality, row.notes]);
      if (row.documents) {
        await client.query(
          `insert into guest_documents (guest_id, address_line, city, state, pincode, country, date_of_birth)
           values ($1, $2, $3, $4, $5, $6, $7::date)`,
          [made!.id, row.documents.address, row.documents.city, row.documents.state,
           row.documents.pincode, row.documents.country, row.documents.dob]);
      }
      if (importId) {
        await client.query(
          "insert into data_import_items (import_id, kind, row_id, line) values ($1, 'guest', $2, $3)",
          [importId, made!.id, row.line]);
      }
    }
  }
  return { rows: out.map((o) => o.check), plan: out };
}

/* ── The bookings' file: bookings to come, and past stays ─────────── */

async function bookingsRun(
  client: Client, here: Here, system: string, cells: unknown[][], cols: Record<string, string>,
  importId: string | null,
): Promise<RowCheck[]> {
  const headers = (cells[0] ?? []).map(norm);
  const raw = (r: unknown[], f: string) => (cols[f] ? r[headers.indexOf(cols[f]!)] : undefined);
  const at = (r: unknown[], f: string) => norm(raw(r, f));

  const { rows: plans } = await client.query<{ code: string }>("select code from meal_plans");
  const { rows: types } = await client.query<{ id: string; name: string; code: string }>(
    "select id::text, name, code from room_types where hotel_id = $1", [here.id]);
  const { rows: sources } = await client.query<{ id: string; name: string }>(
    "select id::text, name from booking_sources where is_active");
  const { rows: methods } = await client.query<{ label: string; kind: string }>(
    "select label, kind from payment_methods where hotel_id = $1 and is_active", [here.id]);
  const { rows: rooms } = await client.query<{ id: string; number: string; room_type_id: string }>(
    "select id::text, number, room_type_id::text from rooms where hotel_id = $1 and is_active", [here.id]);
  /* What earlier imports here brought in, not undone: the same booking is
     never brought in twice - by its old reference, else by guest and dates. */
  const { rows: before } = await client.query<{ reference: string | null; guest: string; arrival: string; departure: string; at: string }>(
    `select i.reference, g.full_name as guest, r.check_in::text as arrival, r.check_out::text as departure, d.made_at::text as at
       from data_import_items i join data_imports d on d.id = i.import_id
       join reservations r on r.id = i.row_id::uuid join guests g on g.id = r.guest_id
      where d.hotel_id = $1 and d.undone_at is null and i.kind = 'booking'
     union all
     select s.reference, g.full_name, s.arrival::text, s.departure::text, d.made_at::text
       from imported_stays s join data_imports d on d.id = s.import_id join guests g on g.id = s.guest_id
      where s.hotel_id = $1 and d.undone_at is null`, [here.id]);
  const already = (ref: string | null, guest: string, a: string, dpt: string) => before.find((b) =>
    ref ? b.reference?.toLowerCase() === ref.toLowerCase()
      : b.guest.toLowerCase() === guest.toLowerCase() && b.arrival === a && b.departure === dpt);

  const out: RowCheck[] = [];
  const refs = new Map<string, number>();
  const read: { line: number; cells: unknown[] }[] = [];
  cells.slice(1).forEach((r, i) => { if (r.some((v) => norm(v) !== "")) read.push({ line: i + 2, cells: r }); });

  /* Every row read and checked first: a fault in the file stops the save. */
  const ready: { line: number; check: RowCheck; v: Record<string, unknown> }[] = [];
  for (const { line, cells: r } of read) {
    const problems: string[] = [];
    const guestName = at(r, "guestName");
    if (!guestName) problems.push("No guest name.");
    else if (guestName.length > 120) problems.push("A name is at most 120 characters.");
    const phone = at(r, "phone") || null;
    const email = at(r, "email") || null;
    const badPhone = phoneProblem(phone); if (badPhone) problems.push(badPhone);
    const badEmail = emailProblem(email); if (badEmail) problems.push(badEmail);
    const arrival = day(raw(r, "arrival"), "Arrival", problems);
    const departure = day(raw(r, "departure"), "Departure", problems);
    if (!at(r, "arrival")) problems.push("No arrival date.");
    if (!at(r, "departure")) problems.push("No departure date.");
    if (arrival && departure && departure < arrival) problems.push("The departure is before the arrival.");
    if (arrival && arrival < "2000-01-01") problems.push("The arrival is before 2000.");
    const reference = text(at(r, "reference"), 100, "A reference", problems);
    if (reference && refs.has(reference.toLowerCase())) problems.push(`The same reference as row ${refs.get(reference.toLowerCase())}.`);
    if (reference) refs.set(reference.toLowerCase(), line);
    const typeWord = at(r, "roomType");
    const roomWord = at(r, "room");
    const rateWord = at(r, "rate");
    const rate = amount(rateWord, "The rate", problems);
    const plan = (at(r, "plan") || "EP").toUpperCase();
    if (!plans.some((p) => p.code === plan)) problems.push(`"${plan}" is not a meal plan: ${plans.map((p) => p.code).join(", ")}.`);
    const adults = count(at(r, "adults"), "Adults", 1, problems);
    const children = count(at(r, "children"), "Children", 0, problems);
    const sourceWord = at(r, "source");
    const paid = amount(at(r, "advance"), "The advance", problems);
    const paidOn = day(raw(r, "advanceDate"), "The advance's date", problems);
    const methodWord = at(r, "advanceMethod");
    const method = methodWord ? methods.find((m) => m.label.toLowerCase() === methodWord.toLowerCase()) : undefined;

    const past = arrival !== null && departure !== null && arrival < here.businessDate && departure <= here.businessDate;
    const future = arrival !== null && arrival >= here.businessDate;
    if (future && paid !== null) {
      if (!paidOn) problems.push("Say the date the advance was paid.");
      else if (paidOn >= here.firstDay || paidOn > here.today) {
        problems.push(`An advance brought in is from before the hotel's first day here, ${words(here.firstDay)}. `
          + "One paid since is taken at the desk, on its day.");
      }
      if (!methodWord) problems.push("Say how the advance was paid (one of this hotel's payment methods).");
      else if (!method) problems.push(`"${methodWord}" is not one of this hotel's payment methods: ${methods.map((m) => m.label).join(", ")}.`);
      else if (method.kind === "city_ledger") problems.push(`${method.label} is not money received, so it is not an advance.`);
    }
    if (paid === null && (paidOn || methodWord) && future) problems.push("An advance's date or method with no amount.");

    const what = [arrival && departure ? `${words(arrival)} to ${words(departure)}` : null, typeWord || null,
      roomWord ? `room ${roomWord}` : null].filter(Boolean).join(", ");
    const check: RowCheck = { line, name: guestName, what: what || "-", action: past ? "stay" : "booking", problems, notes: [] };
    out.push(check);
    ready.push({ line, check, v: { guestName, phone, email, arrival, departure, reference, typeWord, roomWord, rate,
      plan, adults, children, sourceWord, paid, paidOn, method, past, future } });
  }
  if (out.some((c) => c.problems.length > 0)) return out;

  /* ── Every row the file has right: made, or refused by the hotel. ── */
  for (const { check, v } of ready) {
    const s = v as {
      guestName: string; phone: string | null; email: string | null; arrival: string; departure: string;
      reference: string | null; typeWord: string; roomWord: string; rate: number | null; plan: string;
      adults?: number; children?: number; sourceWord: string; paid: number | null; paidOn: string | null;
      method?: { label: string; kind: string }; past: boolean; future: boolean;
    };
    const refuse = (why: string) => { check.action = "refused"; check.refused = why; };
    const earlier = already(s.reference, s.guestName, s.arrival, s.departure);
    if (earlier) { refuse(`Already brought in on ${words(earlier.at.slice(0, 10))}.`); continue; }
    if (!s.past && !s.future) {
      refuse("In the house today: check the guest in at the desk instead (Walk-in), with today's figures.");
      continue;
    }

    /* The guest: the one on file the phone or email names, where exactly
       one does (the desk's own suggestion); else a new record. */
    const { rows: found } = s.phone || s.email ? await client.query<{ id: string; name: string; phone: string | null; email: string | null }>(
      `select s.guest_id::text as id, s.full_name as name, g.phone, g.email::text
         from app.guest_suggestions($1, $2) s join guests g on g.id = s.guest_id where s.suggested`,
      [s.phone, s.email]) : { rows: [] };
    const guest = found.length === 1 ? found[0]! : null;
    if (found.length > 1) check.notes.push(`More than one guest on file has this phone or email; a new guest record is made.`);
    if (guest) check.notes.push(`The same guest as ${guest.name}, by phone or email.`);

    await client.query("savepoint import_row");
    try {
      if (s.past) {
        /* HISTORY ONLY: no folio, no invoice, no revenue, no tax. */
        let guestId = guest?.id ?? null;
        if (!guestId) {
          const { rows: [g] } = await client.query<{ id: string }>(
            "insert into guests (full_name, phone, email) values ($1, $2, $3) returning id::text",
            [s.guestName, s.phone, s.email]);
          guestId = g!.id;
          if (importId) {
            await client.query("insert into data_import_items (import_id, kind, row_id, line) values ($1, 'guest', $2, $3)",
              [importId, guestId, check.line]);
          }
        }
        if (importId) {
          await client.query(
            `insert into imported_stays (hotel_id, import_id, guest_id, arrival, departure, room_type, room, reference, source, adults, children)
             values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)`,
            [here.id, importId, guestId, s.arrival, s.departure, s.typeWord.slice(0, 80) || null,
             s.roomWord.slice(0, 20) || null, s.reference, s.sourceWord.slice(0, 100) || null,
             s.adults ?? null, s.children ?? null]);
        }
        if (s.rate !== null || s.paid !== null) check.notes.push(`History only: its money stays in ${system}.`);
        await client.query("release savepoint import_row");
        continue;
      }

      const type = types.find((t) => key(t.name) === key(s.typeWord) || key(t.code) === key(s.typeWord));
      if (!s.typeWord) { refuse("No room type."); await client.query("release savepoint import_row"); continue; }
      if (!type) {
        refuse(`This hotel has no room type "${s.typeWord}": ${types.map((t) => t.name).join(", ")}.`);
        await client.query("release savepoint import_row"); continue;
      }
      const source = sources.find((x) => key(x.name) === key(s.sourceWord));
      if (s.sourceWord && !source) {
        refuse(`"${s.sourceWord}" is not on the booking sources list. Add it under Booking sources, then bring the file in again.`);
        await client.query("release savepoint import_row"); continue;
      }
      const notes = [`Brought in from ${system}${s.reference ? ` (${s.reference})` : ""}.`,
        s.rate === null ? "No rate: set it before arrival." : null].filter(Boolean).join(" ");
      const made = await makeBooking(client, {
        hotelId: here.id, guestName: guest?.name ?? s.guestName,
        ...(s.phone ? { phone: s.phone } : {}), ...(s.email ? { email: s.email } : {}),
        checkIn: s.arrival, checkOut: s.departure,
        ...(source ? { bookingSourceId: source.id } : {}),
        ...(guest ? { guestId: guest.id } : {}),
        notes,
        /* NEVER OVERBOOKED (the brief): refused and listed, as a booking
           site's is (D17-80). */
        refuseWhenFull: true,
        lines: [{ roomTypeId: type.id, mealPlan: s.plan,
                  ...(s.adults === undefined ? {} : { adults: s.adults }),
                  ...(s.children === undefined ? {} : { children: s.children }),
                  ...(s.rate === null ? { rateNotKnown: true } : { agreedRate: s.rate }) }],
      });
      if (!made.ok) {
        await client.query("rollback to savepoint import_row");
        refuse(made.reason);
        continue;
      }
      const stayId = made.reservationIds[0]!;
      const folioId = made.folioIds[0]!;
      if (s.rate === null) check.notes.push("No rate: a dash until the desk sets it, before arrival.");
      if (importId) {
        await client.query(
          "insert into data_import_items (import_id, kind, row_id, line, reference) values ($1, 'booking', $2, $3, $4)",
          [importId, stayId, check.line, s.reference]);
        if (!guest && made.guestId) {
          await client.query("insert into data_import_items (import_id, kind, row_id, line) values ($1, 'guest', $2, $3)",
            [importId, made.guestId, check.line]);
        }
        /* makeBooking fills a returning guest's empty phone or email
           (D21-20); undone with the import. */
        if (guest) {
          const filled = [!guest.phone && s.phone ? "phone" : null, !guest.email && s.email ? "email" : null].filter(Boolean);
          if (filled.length) {
            await client.query(
              `insert into data_import_items (import_id, kind, row_id, line, filled) values ($1, 'guest_filled', $2, $3, $4)
               on conflict (import_id, kind, row_id) do update
                 set filled = (select jsonb_agg(distinct f) from jsonb_array_elements(data_import_items.filled || excluded.filled) f)`,
              [importId, guest.id, check.line, JSON.stringify(filled)]);
          }
        }
      }

      /* The room, if known: held when it is this type's and free. */
      if (s.roomWord) {
        const room = rooms.find((x) => x.number.toLowerCase() === s.roomWord.toLowerCase());
        if (!room) check.notes.push(`No room ${s.roomWord} here: brought in without a room.`);
        else if (room.room_type_id !== type.id) check.notes.push(`Room ${room.number} is not a ${type.name}: brought in without a room.`);
        else {
          await client.query("savepoint import_room");
          try {
            await client.query(
              `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
               values ($1, $2, $3, $4::date, $5::date, 'arrival')`,
              [here.id, stayId, room.id, s.arrival, s.departure]);
            await client.query("release savepoint import_room");
            check.notes.push(`Room ${room.number} held for it.`);
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "23P01" && code !== "23505" && code !== "23514" && code !== "P0001") throw error;
            await client.query("rollback to savepoint import_room");
            check.notes.push(`Room ${room.number} is not free on those nights: brought in without a room.`);
          }
        }
      }

      /* THE ADVANCE: a payment on the booking's bill, dated the day it was
         paid, from before the hotel's first day - so in no drawer, no day's
         takings and no Night audit here; never an invoice. */
      if (s.paid !== null && s.method && s.paidOn) {
        const { rows: [posted] } = await client.query<{ id: string }>(
          `insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount,
                                       tax_rate, tax_amount, source_type, source_id)
           values ($1, $2, $3::date, 'payment', $4, $5, 0, 0, 'import', $6::uuid) returning id::text`,
          [here.id, folioId, s.paidOn, `Advance - ${s.method.label}, brought in from ${system}`, -s.paid, importId]);
        await client.query(
          `insert into payments (hotel_id, posting_id, method, method_label, amount, reference)
           values ($1, $2::bigint, $3, $4, $5, $6)`,
          [here.id, posted!.id, s.method.kind, s.method.label, s.paid, s.reference]);
        if (importId) {
          await client.query("insert into data_import_items (import_id, kind, row_id, line) values ($1, 'payment', $2, $3)",
            [importId, posted!.id, check.line]);
        }
        check.notes.push(`Advance ₹${s.paid.toLocaleString("en-IN")} of ${words(s.paidOn)} on its bill.`);
      }
      await client.query("release savepoint import_row");
    } catch (error) {
      /* A row the database refuses, past every check above: listed, and
         the rest still saved. The log keeps its kind, never the guest. */
      await client.query("rollback to savepoint import_row");
      console.error("[old-system import]", (error as { code?: string }).code ?? "error");
      refuse("The database refused this booking. Make it at the desk.");
    }
  }
  return out;
}

/* ── The routes ────────────────────────────────────────────────────── */

interface Body { name?: unknown; data?: unknown; system?: unknown; columns?: unknown; choices?: unknown; sendVouchers?: unknown }

function readBody(input: Body):
  { ok: true; name: string; bytes: Buffer; system: string; columns: Record<string, unknown> | null;
    choices: Record<string, Choice>; sendVouchers: boolean }
  | { ok: false; reason: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const bytes = Buffer.from(typeof input.data === "string" ? input.data : "", "base64");
  const system = typeof input.system === "string" ? input.system.trim() : "";
  if (!name || bytes.length === 0) return { ok: false, reason: "Choose the file." };
  if (name.length > 200) return { ok: false, reason: "That file's name is too long." };
  if (bytes.length > 5_000_000) return { ok: false, reason: "That file is over 5 MB. Split it into smaller files." };
  if (!system) return { ok: false, reason: "Say which system the file came from (IDS, eZee, a spreadsheet)." };
  if (system.length > 60) return { ok: false, reason: "The system's name is at most 60 characters." };
  const columns = input.columns && typeof input.columns === "object" ? input.columns as Record<string, unknown> : null;
  const choices: Record<string, Choice> = {};
  if (input.choices && typeof input.choices === "object") {
    for (const [line, c] of Object.entries(input.choices as Record<string, unknown>)) {
      const v = c as { action?: unknown; guestId?: unknown };
      if (v?.action === "keep" || v?.action === "skip") choices[line] = { action: v.action };
      else if (v?.action === "merge" && typeof v.guestId === "string" && UUID.test(v.guestId)) {
        choices[line] = { action: "merge", guestId: v.guestId };
      }
    }
  }
  /* Off unless ticked (the master, under D27-396). */
  return { ok: true, name, bytes, system, columns, choices, sendVouchers: input.sendVouchers === true };
}

/** The check and the save: one path. `save` false rolls everything back. */
async function run(subject: string, code: string, kind: string, raw: Body, save: boolean) {
  if (!isKind(kind)) return { status: 404 as const, body: { error: "No such kind of file." } };
  const input = readBody(raw);
  if (!input.ok) return { status: 409 as const, body: input };
  const cells = await fileRows(input.name, input.bytes);
  if (!Array.isArray(cells)) return { status: 409 as const, body: { ok: false, reason: cells.reason } };
  const headers = (cells[0] ?? []).map(norm);
  const rowsIn = cells.slice(1).filter((r) => r.some((v) => norm(v) !== "")).length;
  if (rowsIn === 0) return { status: 409 as const, body: { ok: false, reason: "The file has no rows under its headings." } };
  if (rowsIn > MOST_ROWS) {
    return { status: 409 as const, body: { ok: false, reason: `The file has ${rowsIn.toLocaleString("en-IN")} rows. Bring in at most ${MOST_ROWS.toLocaleString("en-IN")} at a time: split it.` } };
  }

  return withSession(subject, async (client) => {
    const here = await hotelHere(client, code);
    if (!here) return { status: 404 as const, body: { error: "No such property." } };
    if (!here.may) return { status: 403 as const, body: { ok: false, reason: IMPORT_REFUSED } };

    const { rows: last } = await client.query<{ columns: Record<string, string> }>(
      `select columns from data_imports where hotel_id = $1 and kind = $2 order by made_at desc limit 1`,
      [here.id, kind]);
    const fields = FIELDS[kind];
    const columns = matchColumns(headers, fields, input.columns, last[0]?.columns ?? {});
    const missing = fields.filter((f) => f.required && !columns[f.key]).map((f) => f.label);
    const shape = { headers, columns, fields: fields.map(({ key: k, label, required, note }) => ({ key: k, label, required: !!required, note: note ?? null })) };
    if (missing.length) {
      return { status: 200 as const, body: { ok: false, ...shape, rows: [],
        reason: `Match a column of the file to ${missing.join(" and ")}.` } };
    }

    await client.query("savepoint import_check");
    let importId: string | null = null;
    if (save) {
      const { rows: [d] } = await client.query<{ id: string }>(
        `insert into data_imports (hotel_id, kind, system, file_name, columns, rows_in, rows_refused, send_vouchers)
         values ($1, $2, $3, $4, $5, $6, 0, $7) returning id::text`,
        [here.id, kind, input.system, input.name, JSON.stringify(columns), rowsIn,
         kind === "bookings" && input.sendVouchers]);
      importId = d!.id;
    }
    const rows = kind === "guests"
      ? (await guestsRun(client, here, input.system, cells, columns, input.choices, importId)).rows
      : await bookingsRun(client, here, input.system, cells, columns, importId);

    const CHOOSE = CHOOSE_ONE;
    const faults = rows.filter((r) => r.problems.some((p) => p !== CHOOSE)).length;
    const toChoose = rows.filter((r) => r.problems.includes(CHOOSE)).length;
    const refused = rows.filter((r) => r.action === "refused" || r.action === "skip")
      .map((r) => ({ line: r.line, reason: r.refused ?? `Skipped: already on file as ${r.matches?.map((m) => m.name).join(", ")}.` }));
    const counts = {
      rows: rowsIn, faults, toChoose,
      new: rows.filter((r) => r.action === "new").length,
      merge: rows.filter((r) => r.action === "merge").length,
      skip: rows.filter((r) => r.action === "skip").length,
      bookings: rows.filter((r) => r.action === "booking").length,
      stays: rows.filter((r) => r.action === "stay").length,
      refused: rows.filter((r) => r.action === "refused").length,
      noRate: rows.filter((r) => r.action === "booking" && r.notes.some((n) => n.startsWith("No rate"))).length,
    };
    const body = { ...shape, rows, counts };

    /* A FAULT IN THE FILE SAVES NOTHING (MEMORY 243), nor a guest still to
       choose for; and a check never saves. */
    if (!save || faults > 0 || toChoose > 0) {
      await client.query("rollback to savepoint import_check");
      const reason = faults
        ? `${faults} ${faults === 1 ? "row has" : "rows have"} a fault in the file. Nothing was saved: correct the file and check it again.`
        : toChoose
          ? `${toChoose} ${toChoose === 1 ? "guest is" : "guests are"} already on file. Nothing was saved: choose keep, merge or skip for each, and check again.`
          : null;
      return { status: (save ? 409 : 200) as 200 | 409, body: { ok: reason === null, ...body, ...(reason ? { reason } : {}) } };
    }
    if (counts.new + counts.merge + counts.bookings + counts.stays === 0) {
      await client.query("rollback to savepoint import_check");
      return { status: 409 as const, body: { ok: false, ...body, reason: "Nothing in this file would be brought in. Nothing was saved." } };
    }
    await client.query("update data_imports set rows_refused = $2, refused = $3 where id = $1",
      [importId, refused.length, JSON.stringify(refused)]);
    await client.query("release savepoint import_check");
    return { status: 200 as const, body: { ok: true, importId, ...body } };
  });
}

const body = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Body>().catch(() => ({} as Body));

oldSystem.post("/:code/imports/:kind/check", async (c) => {
  const out = await run(c.get("subject"), c.req.param("code"), c.req.param("kind"), await body(c), false);
  return c.json(out.body, out.status);
});

oldSystem.post("/:code/imports/:kind", async (c) => {
  const out = await run(c.get("subject"), c.req.param("code"), c.req.param("kind"), await body(c), true);
  return c.json(out.body, out.status);
});

oldSystem.post("/:code/imports/:id/undo", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ ok: false, reason: "No such import." }, 404);
  const out = await withSession(c.get("subject"), async (client) => {
    const here = await hotelHere(client, c.req.param("code"));
    if (!here) return null;
    if (!here.may) return { ok: false as const, reason: IMPORT_REFUSED, status: 403 as const };
    const { rows } = await client.query<{ why: string | null }>(
      `select app.undo_data_import(d.id) as why from data_imports d where d.id = $1 and d.hotel_id = $2`, [id, here.id]);
    if (!rows[0]) return { ok: false as const, reason: "No such import.", status: 404 as const };
    return rows[0].why ? { ok: false as const, reason: rows[0].why, status: 409 as const } : { ok: true as const, status: 200 as const };
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  const { status, ...body } = out;
  return c.json(body, status);
});

oldSystem.get("/:code/imports", async (c) => {
  const out = await withSession(c.get("subject"), async (client) => {
    const here = await hotelHere(client, c.req.param("code"));
    if (!here) return null;
    if (!here.may) return { may: false as const, reason: IMPORT_REFUSED };
    const { rows: imports } = await client.query(
      `select d.id::text, d.kind, d.system, d.file_name as "fileName", d.rows_in as "rowsIn",
              d.rows_refused as "rowsRefused", d.refused, d.send_vouchers as "sendVouchers", d.made_at as "madeAt",
              mb.full_name as "madeBy", d.undone_at as "undoneAt", ub.full_name as "undoneBy",
              (select count(*) from data_import_items i where i.import_id = d.id and i.kind = 'guest')::int as guests,
              (select count(*) from data_import_items i where i.import_id = d.id and i.kind = 'guest_filled')::int as filled,
              (select count(*) from data_import_items i where i.import_id = d.id and i.kind = 'booking')::int as bookings,
              (select count(*) from imported_stays s where s.import_id = d.id)::int as stays,
              (select count(*) from data_import_items i where i.import_id = d.id and i.kind = 'payment')::int as advances
         from data_imports d
         left join staff mb on mb.id = d.made_by
         left join staff ub on ub.id = d.undone_by
        where d.hotel_id = $1
        order by d.made_at desc`, [here.id]);
    /* Listed for the desk until somebody sets the rate (the brief). */
    const { rows: noRate } = await client.query(
      `select r.id::text, r.reference, g.full_name as guest, r.check_in::text as arrival, rt.name as "roomType"
         from data_import_items i join data_imports d on d.id = i.import_id
         join reservations r on r.id = i.row_id::uuid join guests g on g.id = r.guest_id
         join room_types rt on rt.id = r.room_type_id
        where d.hotel_id = $1 and d.undone_at is null and i.kind = 'booking'
          and r.agreed_rate is null and r.status in ('confirmed', 'tentative')
        order by r.check_in, r.reference`, [here.id]);
    const { rows: [v] } = await client.query<{ on: boolean }>(
      `select coalesce((select s.is_on from guest_message_settings s
                         where s.hotel_id = $1 and s.kind = 'booking-voucher'), true) as on`, [here.id]);
    return { may: true as const, businessDate: here.businessDate, firstDay: here.firstDay,
             voucherOn: v?.on ?? true, imports, noRate,
             fields: Object.fromEntries(Object.entries(FIELDS).map(([k, fs]) =>
               [k, fs.map(({ key: f, label, required, note }) => ({ key: f, label, required: !!required, note: note ?? null }))])) };
  });
  if (!out) return c.json({ error: "No such property." }, 404);
  return c.json(out, out.may ? 200 : 403);
});
