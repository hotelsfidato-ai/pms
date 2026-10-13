import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { runInvoices } from "../../../src/modules/guest-messaging/invoices.ts";
import { runReportEmails } from "../../../src/modules/guest-messaging/reportEmails.ts";
import { inr } from "../../../src/reportRender.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES (Settings phase 6; the owner's D27-252, D27-261)

   Each guest message switched per hotel with the reminder's timing; the
   tax invoice to the guest with its PDF, by itself and by the desk's
   button; the daily report emails after the night audit (D27-280). A stand-in receiver for
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
/** A demo day with rooms on it and no night audit of its own, audited here. */
let auditedDay: string | null = null;

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
  await sql("delete from daily_report_emails where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and about_kind in ('invoice', 'night-audit')", [hotelId]);
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const k of ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "GUEST_MESSAGES_PER_MINUTE"]) delete process.env[k];
  await sql("delete from guest_message_settings where hotel_id = $1", [hotelId]);
  await sql("delete from daily_report_emails where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1 and about_kind in ('invoice', 'night-audit')", [hotelId]);
  /* An issued tax invoice is immutable, so its bill, stay and guest stay too:
     this run's database is its own and is dropped after it. */
  await sql("delete from night_audit_runs where hotel_id = $1 and (business_date < '2001-01-01' or business_date = $2::date)",
    [hotelId, auditedDay ?? "1999-01-01"]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[gmId, deskId, outsiderId]]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [[gmId, deskId, outsiderId]]);
  await closePool();
});

/* ── 1 · The switches and the timing (Q1, Q2) ─────────────────────── */

describe("each guest message, switched per hotel (D27-261, D27-264)", () => {
  /* D27-264: the voucher is the confirmation (both ways), the invoice, the
     review request - and nothing else: no reminder, no timing. */
  it("is today's behaviour until somebody saves - the voucher and online check-in on, the invoice and the review off", async () => {
    const res = await call(gmId, "GET", "/guest-message-settings");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { messages: Record<string, unknown>[]; catchUp: unknown };
    /* D27-281: online check-in is on for every hotel until switched off.
       D27-266: the review request comes later - off, like the invoice. */
    expect(body.messages.map((m) => [m["kind"], m["isOn"]])).toEqual([
      ["booking-voucher", true], ["online-checkin", true], ["invoice", false], ["review", false],
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

  it("has online check-in on until switched off, and the desk's read says which (D27-281)", async () => {
    const read = async () => {
      const res = await call(gmId, "GET", "/guest-messages");
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { onlineCheckIn: unknown }).onlineCheckIn;
    };
    expect(await read()).toBe(true);
    expect((await call(gmId, "PUT", "/guest-message-settings/online-checkin", { isOn: false })).status).toBe(200);
    expect(await read()).toBe(false);
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

    /* D27-284: by email only - this guest has a number and agreed to
       WhatsApp, and still gets no WhatsApp. */
    await anInvoice(folioId, "P6MSG-NEW");
    await runInvoices();
    expect(received.map((m) => `${m.kind} ${m.channel}`), "one email, nothing else").toEqual(["invoice email"]);
    expect(isPdf(sent()[0]), "with its PDF").toBe(true);
    expect(sent()[0]!.data).toMatchObject({ guestName: `${TAG} Guest`, invoiceNumber: "P6MSG-NEW", total: "INR 1,050.00" });

    received = [];
    await runInvoices();
    expect(sent(), "once").toEqual([]);
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

  /* D27-313 (2): the day check's 5EL/2026-27/00001 - a guest's bill on a stay
     booked through Expedia is made out to Expedia, and it went to the guest by
     itself. Issued here through the desk's own route, so the recipient on the
     document and the sending rule are tested as one. */
  it("is not sent by itself when it is made out to a booking site, though the bill is the guest's (D27-313)", async () => {
    await call(gmId, "PUT", "/guest-message-settings/invoice", { isOn: true });
    const site = (await sql("insert into companies (name) values ($1) returning id::text as id", [`${TAG} Expedia`]))[0]!.id;
    const issue = async (reference: string, company: string | null) => {
      const [stay] = await sql(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out, adults,
                                   status, source, agreed_rate, company_id)
         select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
                app.business_date($1), app.business_date($1) + 1, 1, 'confirmed', 'direct', 1000, $4
         returning id::text as id`, [hotelId, guestId, reference, company]);
      const [bill] = await sql("insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text as id",
        [hotelId, stay!.id]);
      await sql(
        `insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category, description,
                                     amount, tax_rate, tax_amount)
         values ($1, $2, $3, app.business_date($1), 'room', 'Room night', 1000, 5, 50)`, [hotelId, bill!.id, stay!.id]);
      const res = await call(deskId, "POST", `/stays/${stay!.id}/invoice`, {});
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as { number: string; recipient: string };
    };
    const theSites = await issue("P6MSG-OTA", site);
    expect(theSites.recipient, "made out to the booking site").toBe(`${TAG} Expedia`);
    const theGuests = await issue("P6MSG-OWN", null);
    expect(theGuests.recipient).toBe(`${TAG} Guest`);

    await runInvoices();
    expect(sent().map((m) => m.data["invoiceNumber"]), "only the one made out to the guest").toEqual([theGuests.number]);

    received = [];
    const res = await call(deskId, "POST", `/invoices/${theSites.number}/send`, {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sent().map((m) => m.data["invoiceNumber"]), "the desk's Send invoice still sends it").toEqual([theSites.number]);
  });

  it("is sent by the desk's button, a company's too, by email once, under the clerk's name", async () => {
    await anInvoice(companyFolioId, "P6MSG-BTN");
    const res = await call(deskId, "POST", "/invoices/P6MSG-BTN/send", {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect(received.map((m) => m.channel), "no WhatsApp (D27-284)").toEqual(["email"]);
    expect(await sql(
      `select channel, sent_by::text from messages_sent where about_kind = 'invoice'
        and about_id = (select id::text from invoices where number = 'P6MSG-BTN') order by channel`)).toEqual([
      { channel: "email", sent_by: deskId }]);
    expect((await call(deskId, "POST", "/invoices/P6MSG-BTN/send", {})).status, "not twice").toBe(409);
    expect((await call(deskId, "POST", "/invoices/NO-SUCH/send", {})).status).toBe(404);
  });
});

/* ── 3 · Daily report emails after the night audit (D27-280) ─────── */

describe("daily report emails after the night audit (D27-280)", () => {
  const ALL = ["night-audit", "manager", "money-owed", "restaurant-stock"];
  const save = (who: string, reports: { key: string; isOn: boolean; addresses: string[] }[]) =>
    call(who, "PUT", "/report-emails", { reports });
  const audit = (day: string, completed = "now()") => sql(
    `insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
     values ($1, $2::date, 'completed', ${completed}, ${completed})`, [hotelId, day]);
  type Got = { reports: { key: string; isOn: boolean; addresses: string[] }[]; notConnected: string | null };

  it("start with the night audit report on and the rest off, and no address anywhere", async () => {
    const res = await call(gmId, "GET", "/report-emails");
    expect(res.status, await res.clone().text()).toBe(200);
    const got = (await res.json()) as Got;
    expect(got.reports.map((r) => [r.key, r.isOn, r.addresses])).toEqual([
      ["night-audit", true, []], ["manager", false, []], ["money-owed", false, []], ["restaurant-stock", false, []]]);
    expect(got.notConnected, "connected in this test").toBeNull();
  });

  it("are switched and addressed by the owner, an Administrator or the GM - and refused to reception by the server", async () => {
    expect((await save(deskId, [{ key: "manager", isOn: true, addresses: ["x@example.com"] }])).status).toBe(403);
    expect((await call(deskId, "GET", "/report-emails")).status, "nor read").not.toBe(200);
    expect(await sql("select count(*)::int as n from daily_report_emails where hotel_id = $1", [hotelId]))
      .toEqual([{ n: 0 }]);

    const res = await save(gmId, [
      { key: "manager", isOn: true, addresses: [" Owner@Example.com ", "owner@example.com", "gm@example.com"] },
      { key: "night-audit", isOn: false, addresses: [] },
    ]);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await sql(
      `select report, is_on, addresses, changed_by::text from daily_report_emails
        where hotel_id = $1 order by report`, [hotelId])).toEqual([
      { report: "manager", is_on: true, addresses: ["owner@example.com", "gm@example.com"], changed_by: gmId },
      { report: "night-audit", is_on: false, addresses: [], changed_by: gmId },
    ]);
    const got = (await (await call(gmId, "GET", "/report-emails")).json()) as Got;
    expect(got.reports.find((r) => r.key === "night-audit")!.isOn, "switched off, and it stays off").toBe(false);
  });

  it("refuse what is not an address, an unknown report, and a report twice", async () => {
    for (const reports of [
      [{ key: "manager", isOn: true, addresses: ["not an address"] }],
      [{ key: "lodging-tax", isOn: true, addresses: ["a@example.com"] }],
      [{ key: "manager", isOn: true, addresses: [] }, { key: "manager", isOn: false, addresses: [] }],
      [{ key: "manager", isOn: "yes", addresses: [] }],
    ]) {
      expect((await call(gmId, "PUT", "/report-emails", { reports })).status, JSON.stringify(reports)).toBe(400);
    }
    expect(await sql("select count(*)::int as n from daily_report_emails where hotel_id = $1", [hotelId])).toEqual([{ n: 0 }]);
  });

  it("send nothing to nobody: on with no address, or an address with the report off", async () => {
    await save(gmId, [{ key: "manager", isOn: false, addresses: ["gm@example.com"] }]);
    await audit("2000-02-01");
    const ran = await runReportEmails();
    expect(ran.due).toBe(0);
    expect(sent()).toEqual([]);
  });

  it("go once per business date, report and address, right after the audit - not for an audit before the choice", async () => {
    await audit("2000-02-02", "now() - interval '1 hour'");
    await save(gmId, [{ key: "night-audit", isOn: true, addresses: ["owner@example.com", "gm@example.com"] }]);
    await runReportEmails();
    expect(sent(), "the audit came before the addresses").toEqual([]);

    await audit("2000-02-03");
    await runReportEmails();
    expect(sent().map((m) => `${m.kind} ${m.channel} ${m.to["email"]}`).sort()).toEqual([
      "daily-report email gm@example.com", "daily-report email owner@example.com"]);
    expect(sent().every(isPdf), "each with the whole report as a PDF").toBe(true);
    expect(sent()[0]!.data).toMatchObject({ reportTitle: "Night audit report", businessDate: "03/02/2000" });
    expect(sent()[0]!.file?.name).toBe("Night-audit-report-5EL-2000-02-03.pdf");

    received = [];
    await runReportEmails();
    expect(sent(), "a retry sends nothing twice").toEqual([]);
    /* The GM corrects the closed day's record (D17-12): its audit completes again. */
    const db = new (await import("pg")).default.Client({ connectionString: SUPER });
    await db.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('app.user_id', $1, true)", [gmId]);
      await db.query("update night_audit_runs set completed_at = now() where hotel_id = $1 and business_date = '2000-02-03'", [hotelId]);
      await db.query("commit");
    } finally { await db.end(); }
    await runReportEmails();
    expect(sent(), "nor does the day audited again").toEqual([]);
    expect(await sql(
      `select count(*)::int as n from messages_sent where hotel_id = $1 and kind = 'daily-report' and status = 'sent'`,
      [hotelId])).toEqual([{ n: 2 }]);
  });

  it("carry the report's own key figures in the email, on a day with rooms on it", async () => {
    auditedDay = (await sql(
      `select d::text as d from (select distinct business_date as d from folio_postings
                                  where hotel_id = $1 and category = 'room') x
        where not exists (select 1 from night_audit_runs n where n.hotel_id = $1 and n.business_date = x.d)
        order by d desc limit 1`, [hotelId]))[0]!.d as string;
    await save(gmId, ALL.map((key) => ({ key, isOn: true, addresses: ["owner@example.com"] })));
    await audit(auditedDay);
    await runReportEmails();
    const got = new Map(sent().map((m) => [m.data["reportTitle"], m]));
    expect([...got.keys()].sort()).toEqual(["Manager report", "Money owed", "Night audit report", "Restaurant and stock"]);
    expect(sent().every(isPdf)).toBe(true);

    const figures = (title: string) => Object.fromEntries(got.get(title)!.data["keyFigures"]!.split("\n")
      .map((l) => [l.slice(0, l.indexOf(": ")), l.slice(l.indexOf(": ") + 2)]));
    const report = async (path: string) => {
      const res = await call(gmId, "GET", path);
      expect(res.status, path).toBe(200);
      return (await res.json()) as ReportDoc;
    };
    const rows = (doc: ReportDoc, key: string) => doc.sections.find((s) => s.key === key)!.rows;
    const rupees = (n: unknown) => `₹${inr(Number(n))}`;

    /* The Night audit report, as the Reports screen draws it. */
    const night = await report(`/reports/night-audit?asOn=${auditedDay}`);
    const status = rows(night, "room-status")[0]!.cells;
    const charged = rows(night, "room-charges");
    expect(charged.length, "a day with rooms charged").toBeGreaterThan(0);
    expect(figures("Night audit report")).toMatchObject({
      "Rooms occupied": `${status["occupied"]} of ${status["rooms"]}`,
      "Room revenue with tax": rupees(charged.at(-1)!.cells["rent"]),
      "Checked out": String(rows(night, "checked-out").filter((r) => r.kind === "row").length),
    });

    /* The Manager report's Today column. */
    const manager = await report(`/reports/manager?asOn=${auditedDay}`);
    const today = (key: string, label: string) => rows(manager, key).find((r) => r.cells["label"] === label)!.cells["today"];
    expect(figures("Manager report")).toMatchObject({
      "Occupancy": `${Number(today("statistics", "Occupancy Rate (%)")).toFixed(2)}%`,
      "Room revenue without tax": rupees(today("room-charges", "Total")),
      "Payments received": rupees(today("payment", "Total Payment")),
    });

    /* Money owed: the Manager report's guest ledger and the City ledger. */
    const city = await report(`/reports/city-ledger?asOn=${auditedDay}`);
    const cityTotal = rows(city, "accounts").find((r) => r.kind === "total");
    expect(figures("Money owed")).toEqual({
      "Guests owe": rupees(today("guest-ledger", "Closing Balance*")),
      "Companies owe": rupees(cityTotal ? cityTotal.cells["closing"] : 0),
    });
    expect(Object.keys(figures("Restaurant and stock"))).toEqual(
      ["Restaurant sales with tax", "Closing stock value", "Wastage", "Breakage"]);
  });
});
