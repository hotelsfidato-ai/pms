import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { runInvoices } from "../../../src/modules/guest-messaging/invoices.ts";
import { runReportEmails } from "../../../src/modules/guest-messaging/reportEmails.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES (Settings phase 6; the owner's D27-252, D27-261)

   Each guest message switched per hotel with the reminder's timing; the
   tax invoice to the guest with its PDF, by itself and by the desk's
   button; reports by email after the night audit. A stand-in receiver for
   the CRS's n8n keeps what it was sent; nothing leaves this machine.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const SECRET = "a-secret-that-exists-only-in-this-test-run";
const TAG = "P6MSG";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

let hotelId: string;
let gmId: string;
let deskId: string;
let outsiderId: string;
let guestId: string;
let stayId: string;
let folioId: string;
let companyFolioId: string;
let server: Server;
type Sent = { kind: string; channel: string; action?: string; to: Record<string, string | null>;
  data: Record<string, string>; file?: { name: string; base64: string } };
let received: Sent[] = [];

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const sent = () => received.filter((m) => m.action !== "mark");
const isPdf = (m: Sent | undefined) =>
  Buffer.from(m?.file?.base64 ?? "", "base64").subarray(0, 5).toString("latin1") === "%PDF-";

async function person(email: string, role: string | null): Promise<string> {
  const [row] = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text as id`,
    [email, `${TAG} ${email.split("@")[0]}`, `test-uid-${email}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  if (role) await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [row!.id, hotelId, role]);
  return row!.id as string;
}

/** A tax invoice on a bill, issued at `issuedAt` (made here, not through the
    desk's route: what is under test is what happens after it exists). */
async function anInvoice(folio: string, number: string, issuedAt = "now()", credits: string | null = null) {
  const [row] = await sql(
    `insert into invoices (hotel_id, folio_id, fin_year, number, total, tax_total, taxable_value,
                           cgst_total, sgst_total, recipient_name, place_of_supply, issued_at, issued_by, credits_id, reason)
     values ($1, $2, '2026-27', $3, 1050, 50, 1000, 25, 25, $4, 'Maharashtra', ${issuedAt}, $5, $6,
             case when $6::uuid is null then null else 'A test credit note' end)
     returning id::text as id`,
    [hotelId, folio, number, `${TAG} Guest`, deskId, credits]);
  return row!.id as string;
}

beforeAll(async () => {
  hotelId = (await sql("select id::text as id from hotels where code = '5EL'"))[0]!.id;
  gmId = await person("p6msg-gm@fidato.in", "gm");
  deskId = await person("p6msg-desk@fidato.in", "front_desk");
  outsiderId = await person("p6msg-outsider@fidato.in", null);
  guestId = (await sql(
    "insert into guests (full_name, phone, email) values ($1, '9876501234', 'p6msg.guest@example.test') returning id::text as id",
    [`${TAG} Guest`]))[0]!.id;
  stayId = (await sql(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out, adults,
                               status, source, agreed_rate, whatsapp_agreed)
     select $1, $2, (select id from room_types where hotel_id = $1 limit 1), 'P6MSG-1',
            (now() at time zone 'Asia/Kolkata')::date + 3, (now() at time zone 'Asia/Kolkata')::date + 5,
            1, 'confirmed', 'direct', 1000, true
     returning id::text as id`, [hotelId, guestId]))[0]!.id;
  folioId = (await sql("insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text as id",
    [hotelId, stayId]))[0]!.id;
  const company = (await sql("insert into companies (name) values ($1) returning id::text as id", [`${TAG} Co`]))[0]!.id;
  companyFolioId = (await sql(
    "insert into folios (hotel_id, reservation_id, bill_to, company_id) values ($1, $2, 'company', $3) returning id::text as id",
    [hotelId, stayId, company]))[0]!.id;

  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers["x-fidato-secret"] !== SECRET) { res.writeHead(401).end(); return; }
      received.push(JSON.parse(raw));
      res.writeHead(200).end("sent");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

beforeEach(async () => {
  received = [];
  process.env["CRS_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["CRS_N8N_SECRET"] = SECRET;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["GUEST_MESSAGES_PER_MINUTE"] = "50";
  await sql("delete from guest_message_settings where hotel_id = $1", [hotelId]);
  await sql("delete from report_emails where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and about_kind in ('invoice', 'night-audit')", [hotelId]);
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const k of ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "GUEST_MESSAGES_PER_MINUTE"]) delete process.env[k];
  await sql("delete from guest_message_settings where hotel_id = $1", [hotelId]);
  await sql("delete from report_emails where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and about_kind in ('invoice', 'night-audit')", [hotelId]);
  /* An issued tax invoice is immutable, so its bill, stay and guest stay too:
     this run's database is its own and is dropped after it. */
  await sql("delete from night_audit_runs where hotel_id = $1 and business_date < '2001-01-01'", [hotelId]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[gmId, deskId, outsiderId]]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [[gmId, deskId, outsiderId]]);
  await closePool();
});

/* ── 1 · The switches and the timing (Q1, Q2) ─────────────────────── */

describe("each guest message, switched per hotel (D27-261, D27-264)", () => {
  /* D27-264: the voucher is the confirmation (both ways), the invoice, the
     review request - and nothing else: no reminder, no timing. */
  it("is today's behaviour until somebody saves - the voucher and the review on, the invoice off", async () => {
    const res = await call(gmId, "GET", "/guest-message-settings");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { messages: Record<string, unknown>[]; catchUp: unknown };
    expect(body.messages.map((m) => [m["kind"], m["isOn"]])).toEqual([
      ["booking-voucher", true], ["invoice", false], ["review", true],
    ]);
    expect(body.messages.some((m) => "daysBefore" in m || "sendFrom" in m), "no timing").toBe(false);
    expect(body.catchUp, "shown, not changed").toEqual({ from: "09:00", until: "21:00" });
  });

  it("is switched by the people who set the hotel up, and not by reception", async () => {
    expect((await call(deskId, "PUT", "/guest-message-settings/booking-voucher", { isOn: false })).status).toBe(403);
    const res = await call(gmId, "PUT", "/guest-message-settings/booking-voucher", { isOn: false });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await sql("select is_on, changed_by::text from guest_message_settings where hotel_id = $1 and kind = 'booking-voucher'",
      [hotelId])).toEqual([{ is_on: false, changed_by: gmId }]);
  });

  it("has no reminder, no separate confirmation and no check-in code to switch", async () => {
    for (const kind of ["arrival-reminder", "booking-confirmation", "check-in-code"]) {
      expect((await call(gmId, "PUT", `/guest-message-settings/${kind}`, { isOn: false })).status, kind).toBe(404);
    }
    expect((await call(gmId, "PUT", "/guest-message-settings/review", {})).status, "on or off, said").toBe(400);
  });

  it("is asked by the sweep: the voucher goes both ways while on, and neither way when off", async () => {
    const owed = async () => (await sql(
      `select kind, channel from app.guest_messages_owed(null, 3, '10:00', '00:00', '23:59', $1)
        where reservation_id = $2 order by kind, channel`, [hotelId, stayId]));
    expect((await owed()).map((r) => `${r.kind} ${r.channel}`)).toEqual([
      "booking-confirmation email", "booking-voucher whatsapp"]);

    await call(gmId, "PUT", "/guest-message-settings/booking-voucher", { isOn: false });
    expect(await owed()).toEqual([]);
  });
});

/* ── 2 · The tax invoice (D27-252; Q3 to Q6) ─────────────────────── */

describe("the tax invoice to the guest, with its PDF", () => {
  it("is not sent by itself until switched on, and then only invoices issued after", async () => {
    await anInvoice(folioId, "P6MSG-OLD", "now() - interval '1 hour'");
    await runInvoices();
    expect(sent(), "off: nothing").toEqual([]);

    expect((await call(gmId, "PUT", "/guest-message-settings/invoice", { isOn: true })).status).toBe(200);
    await runInvoices();
    expect(sent(), "issued before the switch: never by itself").toEqual([]);

    await anInvoice(folioId, "P6MSG-NEW");
    await runInvoices();
    expect(sent().map((m) => `${m.kind} ${m.channel}`).sort()).toEqual(["invoice email", "invoice whatsapp"]);
    expect(sent().every(isPdf), "each with its PDF").toBe(true);
    expect(sent()[0]!.data).toMatchObject({ guestName: `${TAG} Guest`, invoiceNumber: "P6MSG-NEW", total: "INR 1,050.00" });

    received = [];
    await runInvoices();
    expect(sent(), "once each way").toEqual([]);
  });

  it("is not sent by itself for a company's bill, nor ever as a credit note", async () => {
    await call(gmId, "PUT", "/guest-message-settings/invoice", { isOn: true });
    await anInvoice(companyFolioId, "P6MSG-CO");
    const original = await anInvoice(folioId, "P6MSG-CR", "now() - interval '1 minute'");
    await anInvoice(folioId, "P6MSG-CN", "now()", original);
    await runInvoices();
    expect(sent().map((m) => m.data["invoiceNumber"]), "neither the company's, nor the credited one, nor the note").toEqual([]);

    const note = await call(deskId, "POST", "/invoices/P6MSG-CN/send", {});
    expect(note.status).toBe(409);
    expect(((await note.json()) as { reason: string }).reason).toBe("A credit note is not sent to the guest.");
  });

  it("is sent by the desk's button, a company's too, each way once, under the clerk's name", async () => {
    await anInvoice(companyFolioId, "P6MSG-BTN");
    const res = await call(deskId, "POST", "/invoices/P6MSG-BTN/send", {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sent().map((m) => m.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(await sql(
      `select channel, sent_by::text from messages_sent where about_kind = 'invoice'
        and about_id = (select id::text from invoices where number = 'P6MSG-BTN') order by channel`)).toEqual([
      { channel: "email", sent_by: deskId }, { channel: "whatsapp", sent_by: deskId }]);
    expect((await call(deskId, "POST", "/invoices/P6MSG-BTN/send", {})).status, "not twice").toBe(409);
    expect((await call(deskId, "POST", "/invoices/NO-SUCH/send", {})).status).toBe(404);
  });
});

/* ── 3 · Reports by email after the night audit (Q7) ─────────────── */

describe("reports by email after the night audit", () => {
  it("are chosen from the six, for the hotel's own people only", async () => {
    const got = (await (await call(gmId, "GET", "/report-emails")).json()) as {
      reports: { key: string }[]; people: { id: string }[];
    };
    expect(got.reports.map((r) => r.key)).toEqual(
      ["night-audit", "manager", "city-ledger", "no-show", "lodging-tax", "monthly-occupancy"]);
    expect(got.people.map((p) => p.id)).toContain(deskId);
    expect(got.people.map((p) => p.id), "not somebody from no hotel of ours").not.toContain(outsiderId);

    expect((await call(gmId, "PUT", "/report-emails", { chosen: [{ report: "manager", staffId: outsiderId }] })).status).toBe(400);
    expect((await call(deskId, "PUT", "/report-emails", { chosen: [] })).status).toBe(403);
    expect((await call(gmId, "PUT", "/report-emails", { chosen: [{ report: "manager", staffId: gmId }] })).status).toBe(200);
    expect(await sql("select report, staff_id::text from report_emails where hotel_id = $1", [hotelId]))
      .toEqual([{ report: "manager", staff_id: gmId }]);
  });

  it("go once, as PDF, to each chosen person's own email after a completed audit - not for one before the choice", async () => {
    await sql(`insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
               values ($1, '2000-01-01', 'completed', now() - interval '1 hour', now() - interval '1 hour')`, [hotelId]);
    await call(gmId, "PUT", "/report-emails", { chosen: [{ report: "manager", staffId: gmId }] });
    await runReportEmails();
    expect(sent(), "the audit came before the choice").toEqual([]);

    await sql(`insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
               values ($1, '2000-01-02', 'completed', now(), now())`, [hotelId]);
    await runReportEmails();
    expect(sent().map((m) => `${m.kind} ${m.channel} ${m.to["email"]}`)).toEqual(["report email p6msg-gm@fidato.in"]);
    expect(isPdf(sent()[0])).toBe(true);
    expect(sent()[0]!.data).toMatchObject({ reportTitle: "Manager summary" });

    received = [];
    await runReportEmails();
    expect(sent(), "once").toEqual([]);
  });
});
