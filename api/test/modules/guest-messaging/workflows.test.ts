import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ══════════════════════════════════════════════════════════════════
   THE TWO N8N WORKFLOWS, RUN WITHOUT N8N (D27-168)

   deploy/n8n/pms-send-m2r.json and pms-send-crs.json are files the owner
   imports; nothing here reaches a server. Since 30 September (D27-186)
   the CRS's workflow sends every guest message and the other is not used
   for now; it is kept tested for the day it is. Their decisions are all in Code
   nodes, so each node's own code is run here against a stand-in for what
   n8n hands it - made-up guests, made-up numbers - and what it decides is
   checked: a retry is not sent twice, the lead the guest's reply will
   land on is the one marked booked, and a name typed by a person is text
   in an email, never HTML.
   ══════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;
interface Item { json: Json; binary?: Json }
interface N8nNode { name: string; type: string; parameters: { jsCode?: string } }
interface Workflow { nodes: N8nNode[]; connections: Record<string, { main: { node: string }[][] }> }

const load = (file: string): Workflow => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../../../deploy/n8n/${file}`, import.meta.url)), "utf8"));
const m2r = load("pms-send-m2r.json");
const crs = load("pms-send-crs.json");

/** One Code node, run the way n8n runs it: `$input`, `$("node")`, and the
    workflow's static data, which survives between executions. */
function run(
  wf: Workflow, name: string, input: Json,
  { earlier = {}, memory = {} }: { earlier?: Record<string, Json>; memory?: Json } = {},
): Item[] {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node?.parameters.jsCode) throw new Error(`no Code node "${name}"`);
  const $input = { first: () => ({ json: input }) };
  const $ = (other: string) => ({ first: () => ({ json: earlier[other] }) });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("$input", "$", "$getWorkflowStaticData", node.parameters.jsCode);
  return fn($input, $, () => memory) as Item[];
}

const ID = "3f2c9a1e-0b7d-4c55-9e21-6a7d8e9f0a1b";
const message = (over: Json = {}): Json => ({
  messageId: ID, action: "send", channel: "whatsapp", kind: "arrival-reminder",
  from: { phoneNumberId: "100000000000001" },
  hotel: { code: "5EL", name: "Test Hotel" },
  to: { name: "Asha Test", phone: "98765 43210", email: "asha@example.com" },
  data: { guestName: "Asha Test", hotelName: "Test Hotel", checkInText: "01/10/2026",
    checkOutText: "03/10/2026", nights: "2", reference: "FH-5EL-2610-0001", link: "https://example.test/g/x" },
  ...over,
});

describe("the market-to-revenue workflow (WhatsApp)", () => {
  it("is wired: every node the code names exists, and each stop reaches the answer", () => {
    const names = new Set(m2r.nodes.map((n) => n.name));
    for (const n of m2r.nodes) {
      for (const [, other] of (n.parameters.jsCode ?? "").matchAll(/\$\("([^"]+)"\)/g)) {
        expect(names.has(other!), `${n.name} names ${other}`).toBe(true);
      }
    }
    expect(m2r.connections["Stop here?"]!.main[0]![0]!.node).toBe("Answer the PMS");
    expect(m2r.connections["Remember it"]!.main[0]![0]!.node).toBe("Answer the PMS");
  });

  it("answers a retry of a message it sent already, and sends nothing", () => {
    const memory: Json = { sent: { [ID]: Date.now() } };
    const [out] = run(m2r, "Read the message", { body: message() }, { memory });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 200, answer: { ok: true, duplicate: true } });
  });

  it("still marks on a retry: a mark is never 'already sent'", () => {
    const memory: Json = { sent: { [ID]: Date.now() } };
    const [out] = run(m2r, "Read the message", { body: message({ action: "mark" }) }, { memory });
    expect(out!.json["stop"]).toBe(false);
    expect(out!.json["graphBody"], "a mark sends no template").toBeNull();
  });

  it("builds the template from the PMS's facts, never an empty parameter", () => {
    const [out] = run(m2r, "Read the message",
      { body: message({ data: { ...(message().data as Json), link: "" } }) });
    const graph = out!.json["graphBody"] as { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(graph.to, "a 10-digit Indian number gains 91").toBe("919876543210");
    expect(graph.template.name).toBe("stay_reminder");
    expect(graph.template.components[0]!.parameters.map((p) => p.text))
      .toEqual(["Asha Test", "Test Hotel", "01/10/2026", "FH-5EL-2610-0001", "-"]);
  });

  it("puts the check-in code in the body and in the copy button", () => {
    const [out] = run(m2r, "Read the message",
      { body: message({ kind: "guest-link-code", data: { code: "482913", reference: "R" } }) });
    const graph = out!.json["graphBody"] as { template: { name: string; components: Json[] } };
    expect(graph.template.name).toBe("guest_page_code");
    expect(JSON.stringify(graph.template.components.map((c) => c["type"]))).toBe('["body","button"]');
    expect(JSON.stringify(graph.template.components)).toContain("482913");
  });

  /* D27-186: the two live hotels, by the leads app's own ids. */
  it("knows the two live hotels by the leads app's ids", () => {
    const appId = (code: string) => (run(m2r, "Read the message",
      { body: message({ action: "mark", hotel: { code, name: "?" } }) })[0]!.json["hotel"] as { id: string } | undefined)?.id;
    expect(appId("AMR")).toBe("amrapali-kolhapur");
    expect(appId("GLM")).toBe("grand-lucent-mathura");
  });

  it("refuses a hotel it has no id for, rather than marking the guest under another", () => {
    const [out] = run(m2r, "Read the message", { body: message({ hotel: { code: "XYZ", name: "?" } }) });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 422 });
  });

  const read = run(m2r, "Read the message", { body: message() })[0]!.json;
  const lead = (res: Json) => run(m2r, "Which lead", res, { earlier: { "Read the message": read } })[0]!.json;

  it("marks the lead the guest's reply will land on, as the inbound routing names it", () => {
    expect(lead({ statusCode: 200, body: { fields: { shared: { booleanValue: true } } } })["conversationId"])
      .toBe("100000000000001__919876543210");
    expect(lead({ statusCode: 200, body: { fields: { hotelId: { stringValue: "five-elements-akkalkot" } } } })["conversationId"])
      .toBe("five-elements-akkalkot__919876543210");
    expect(lead({ statusCode: 404, body: {} })["conversationId"]).toBe("UNASSIGNED__919876543210");
    expect(() => lead({ statusCode: 500, body: "down" }), "a failed lookup is loud").toThrow(/failed/);
  });

  const which = lead({ statusCode: 200, body: { fields: { shared: { booleanValue: true } } } });
  const mark = (res: Json) => (run(m2r, "Mark as booked", res, { earlier: { "Which lead": which } })[0]!
    .json["commitBody"] as { writes: Json[] }).writes;

  it("makes a new guest a BOOKED lead, only if nobody made it first", () => {
    const [write] = mark({ statusCode: 404, body: {} });
    expect(write!["currentDocument"]).toEqual({ exists: false });
    const fields = (write!["update"] as { fields: Record<string, { stringValue?: string }> }).fields;
    expect(fields["status"]!.stringValue).toBe("BOOKED");
    expect(fields["bookingRef"]!.stringValue).toBe("FH-5EL-2610-0001");
    expect(fields["hotelId"]!.stringValue).toBe("five-elements-akkalkot");
    expect(fields["contactPhone"]!.stringValue).toBe("+919876543210");
    expect(Object.keys(fields), "no money the PMS never sent").not.toContain("bookingValue");
  });

  it("books an existing lead, and leaves an already booked one's status alone", () => {
    const [open] = mark({ statusCode: 200, body: { fields: { status: { stringValue: "CONTACTED" } } } });
    expect(open!["updateMask"]).toEqual({ fieldPaths: ["status", "bookingRef"] });
    const [booked] = mark({ statusCode: 200, body: { fields: { status: { stringValue: "BOOKED" } } } });
    expect(booked!["updateMask"]).toEqual({ fieldPaths: ["bookingRef"] });
  });

  it("remembers a message only once WhatsApp took it", () => {
    const earlier = { "After the mark": { messageId: ID, markProblem: null } };
    const memory: Json = {};
    const [refused] = run(m2r, "Remember it", { statusCode: 400, body: { error: { message: "bad template" } } }, { earlier, memory });
    expect(refused!.json).toMatchObject({ statusCode: 502 });
    expect(memory["sent"], "a refusal is tried again for real").toBeUndefined();
    const [took] = run(m2r, "Remember it", { statusCode: 200, body: {} }, { earlier, memory });
    expect(took!.json).toMatchObject({ statusCode: 200, answer: { ok: true } });
    expect(Object.keys(memory["sent"] as Json)).toEqual([ID]);
  });
});

describe("the CRS workflow (every guest message, D27-186)", () => {
  /* The file with one line of "Read the message" changed. */
  const edited = (from: string, to: string): Workflow => ({
    ...crs,
    nodes: crs.nodes.map((n) => n.name !== "Read the message" ? n : {
      ...n, parameters: { ...n.parameters, jsCode: n.parameters.jsCode!.replace(from, to) },
    }),
  });
  const withMailbox = (): Workflow => ({
    ...crs,
    nodes: crs.nodes.map((n) => n.name !== "Read the message" ? n : {
      ...n, parameters: { ...n.parameters, jsCode: n.parameters.jsCode!.replace('const FROM = "";', 'const FROM = "desk@example.test";') },
    }),
  });

  /* D27-266: the owner's live settings, carried in the file. */
  it("sends from the CRS's mailbox, and the voucher by the CRS's reservation_confirmation", () => {
    const [mail] = run(crs, "Read the message", { body: message({ channel: "email", kind: "booking-confirmation" }) });
    expect(mail!.json).toMatchObject({ stop: false, email: true,
      from: "Fidato Hotels <crs@fidatohotels.com>", replyTo: "crs@fidatohotels.com" });
    const [read] = run(crs, "Read the message", { body: voucher() });
    expect((read!.json["template"] as { name: string }).name).toBe("reservation_confirmation");
  });

  it("refuses every email when the mailbox is emptied", () => {
    const [out] = run(edited('const FROM = "Fidato Hotels <crs@fidatohotels.com>";', 'const FROM = "";'),
      "Read the message", { body: message({ channel: "email" }) });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 503 });
  });

  it("writes the voucher email with no check-in line when no link came (online check-in off)", () => {
    const body = message({ channel: "email", kind: "booking-confirmation" }) as { data: Json };
    delete body.data["link"];
    const [mail] = run(crs, "Read the message", { body });
    expect(String(mail!.json["text"])).not.toContain("check-in details");
  });

  it("writes the email itself, with a typed name as text and never HTML", () => {
    const [out] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "booking-confirmation",
      data: { ...(message().data as Json), guestName: "<b>Asha</b>" },
    }) });
    expect(out!.json["to"]).toBe("asha@example.com");
    expect(out!.json["subject"]).toContain("FH-5EL-2610-0001");
    expect(out!.json["html"]).toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(out!.json["html"]).not.toContain("<b>");
    expect(out!.json["attachments"], "no document, no attachment").toBe("");
  });

  it("attaches the document the PMS sends, and says the voucher is attached", () => {
    const [out] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "booking-confirmation",
      file: { name: "Voucher.pdf", contentType: "application/pdf", base64: "JVBERg==" },
    }) });
    expect(out!.json["attachments"]).toBe("data");
    expect(out!.binary).toEqual({ data: { data: "JVBERg==", mimeType: "application/pdf", fileName: "Voucher.pdf" } });
    expect(out!.json["text"]).toContain("Your reservation voucher is attached.");
  });

  /* D27-172 V2: a short letter in the CRS's colours; the link clickable,
     made so only after the line was escaped. */
  it("writes the letter in the CRS's colours with the guest's link clickable", () => {
    const [out] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "booking-confirmation" }) });
    const html = String(out!.json["html"]);
    expect(html).toContain("#FE611F");
    expect(html).toContain('<a href="https://example.test/g/x"');
    expect(out!.json["text"], "no file, no word of one").not.toContain("attached");
  });

  /* D27-207: the check-in code by email, to the address the PMS names. */
  it("writes the check-in code's email, the code in the letter and not in the subject", () => {
    const [out] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "guest-link-code",
      data: { code: "482913", reference: "FH-5EL-2610-0001", guestName: "<b>Asha</b>", hotelName: "Test Hotel" },
    }) });
    expect(out!.json["stop"]).toBe(false);
    expect(out!.json["to"]).toBe("asha@example.com");
    expect(out!.json["subject"]).toBe("Your check-in code for Test Hotel");
    expect(out!.json["text"]).toContain("Your code is 482913");
    expect(out!.json["text"]).toContain("10 minutes");
    expect(out!.json["html"], "a typed name is text").toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(out!.json["attachments"]).toBe("");
  });

  type Graph ={ to: string; template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] } };
  const whatsapp = (over: Json) => run(crs, "Read the message", { body: message(over) })[0]!.json;

  /* One Meta template per kind, in English, its fields in the template's
     own order (docs/go-live/whatsapp-templates.md, IMPORT.md). */
  it.each([
    ["review", "review_request", ["Asha Test", "Test Hotel", "https://example.test/g/x"]],
    /* The owner's live code keeps checkin-link (the 5 October paste); the PMS
       has not sent that kind since D27-264, so the path is dead but harmless. */
    ["checkin-link", "checkin_link", ["Asha Test", "Test Hotel", "01/10/2026", "FH-5EL-2610-0001", "https://example.test/g/x"]],
  ])("sends %s on WhatsApp as the %s template", (kind, template, fields) => {
    const out = whatsapp({ kind });
    const graph = out["graphBody"] as Graph;
    expect(out["graphUrl"], "from the one number the PMS names").toBe("https://graph.facebook.com/v23.0/100000000000001/messages");
    expect(graph.to).toBe("919876543210");
    expect(graph.template.name).toBe(template);
    expect(graph.template.language.code).toBe("en");
    expect(graph.template.components.map((c) => c.type)).toEqual(["body"]);
    expect(graph.template.components[0]!.parameters.map((p) => p.text)).toEqual(fields);
  });

  /* D27-264: fewer messages - the voucher is the confirmation, the check-in
     link is in its PDF, and there is no reminder. Their templates and emails
     are gone, so anything still asking for them is refused in a sentence. */
  it.each(["booking-confirmation", "arrival-reminder"])(
    "refuses %s on WhatsApp: its template is not used (D27-264)", (kind) => {
      expect(whatsapp({ kind })).toMatchObject({ stop: true, statusCode: 422, answer: { ok: false } });
    });

  it("keeps the voucher's email and the live code's check-in-link email, and has no reminder email (D27-264)", () => {
    const [voucherMail] = run(withMailbox(), "Read the message", { body: message({ channel: "email", kind: "booking-confirmation" }) });
    expect(voucherMail!.json).toMatchObject({ stop: false, email: true });
    const [linkMail] = run(withMailbox(), "Read the message", { body: message({ channel: "email", kind: "checkin-link" }) });
    expect(linkMail!.json).toMatchObject({ stop: false, email: true,
      subject: "Your check-in page for Test Hotel (FH-5EL-2610-0001)" });
    const [reminder] = run(withMailbox(), "Read the message", { body: message({ channel: "email", kind: "arrival-reminder" }) });
    expect(reminder!.json).toMatchObject({ stop: true, statusCode: 422 });
  });

  it("sends the check-in code as guest_page_code, in the body and in the copy button", () => {
    const graph = whatsapp({ kind: "guest-link-code", data: { code: "482913", reference: "R" } })["graphBody"] as Graph;
    expect(graph.template.name).toBe("guest_page_code");
    expect(graph.template.language.code).toBe("en");
    expect(graph.template.components.map((c) => c.type)).toEqual(["body", "button"]);
    expect(graph.template.components.map((c) => c.parameters[0]!.text)).toEqual(["482913", "482913"]);
  });

  /* D27-235 (2.2), D27-241: the voucher PDF on WhatsApp, by the CRS's own
     approved template - uploaded to Meta first, then sent as its document,
     with the template's eight NAMED fields from the PMS's facts. */
  const voucher = (data: Json = {}) => message({
    kind: "booking-voucher",
    file: { name: "Voucher-FH-5EL-2610-0001.pdf", contentType: "application/pdf",
      base64: Buffer.from("%PDF-1.4 made up").toString("base64") },
    data: { guestName: "Asha Test", reference: "FH-5EL-2610-0001", hotelName: "Test Hotel",
      checkInLong: "01 Oct 2026", checkOutLong: "03 Oct 2026", roomTypes: "1 x Deluxe",
      guests: "2 adults", officePhone: "-", ...data },
  });
  it("refuses the WhatsApp voucher when its template's name is emptied", () => {
    const [out] = run(edited('const VOUCHER_TEMPLATE = "reservation_confirmation";', 'const VOUCHER_TEMPLATE = "";'),
      "Read the message", { body: voucher() });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 503, answer: { ok: false } });
  });

  it("uploads the voucher PDF to Meta first, then sends the CRS template with it and the eight named fields", () => {
    const [read] = run(crs, "Read the message", { body: voucher() });
    expect(read!.json).toMatchObject({
      stop: false, email: false, upload: true,
      mediaUrl: "https://graph.facebook.com/v23.0/100000000000001/media",
    });
    expect((read!.binary as Json)["data"]).toMatchObject({
      mimeType: "application/pdf", fileName: "Voucher-FH-5EL-2610-0001.pdf" });

    const [built] = run(crs, "Build the voucher message", { statusCode: 200, body: { id: "MEDIA-1" } },
      { earlier: { "Read the message": read!.json } });
    expect(built!.json).toMatchObject({ stop: false, graphUrl: "https://graph.facebook.com/v23.0/100000000000001/messages" });
    const graph = built!.json["graphBody"] as { to: string; template: { name: string; language: { code: string }; components: Json[] } };
    expect(graph.to).toBe("919876543210");
    expect(graph.template.name).toBe("reservation_confirmation");
    expect(graph.template.language.code).toBe("en");
    expect(graph.template.components).toEqual([
      { type: "header", parameters: [{ type: "document", document: { id: "MEDIA-1", filename: "Voucher-FH-5EL-2610-0001.pdf" } }] },
      { type: "body", parameters: [
        { type: "text", parameter_name: "name_1", text: "Asha Test" },
        { type: "text", parameter_name: "hotel_id", text: "FH-5EL-2610-0001" },
        { type: "text", parameter_name: "hotel", text: "Test Hotel" },
        { type: "text", parameter_name: "ck_in", text: "01 Oct 2026" },
        { type: "text", parameter_name: "ck_out", text: "03 Oct 2026" },
        { type: "text", parameter_name: "rm_type", text: "1 x Deluxe" },
        { type: "text", parameter_name: "no_guest", text: "2 adults" },
        { type: "text", parameter_name: "crs_nom", text: "-" },
      ] },
    ]);
  });

  it("refuses a voucher with no PDF, and answers the PMS when Meta refused the upload", () => {
    const [noFile] = run(crs, "Read the message", { body: { ...voucher(), file: null } });
    expect(noFile!.json).toMatchObject({ stop: true, statusCode: 422 });
    const [read] = run(crs, "Read the message", { body: voucher() });
    const [refused] = run(crs, "Build the voucher message", { statusCode: 400, body: { error: { message: "Bad file" } } },
      { earlier: { "Read the message": read!.json } });
    expect(refused!.json).toMatchObject({ stop: true, statusCode: 502, answer: { ok: false } });
  });

  it("is wired: the voucher goes through the upload to the send, a refused upload straight to the answer", () => {
    const next = (from: string, i = 0) => (crs.connections[from]?.main[i] ?? []).map((t) => t.node);
    expect(next("Email?", 1)).toEqual(["Upload first?"]);
    expect(next("Upload first?", 0)).toEqual(["Upload PDF to Meta"]);
    expect(next("Upload first?", 1)).toEqual(["Send on WhatsApp"]);
    expect(next("Upload PDF to Meta")).toEqual(["Build the voucher message"]);
    expect(next("Build the voucher message")).toEqual(["Uploaded?"]);
    expect(next("Uploaded?", 0)).toEqual(["Send on WhatsApp"]);
    expect(next("Uploaded?", 1)).toEqual(["Answer the PMS"]);
  });

  /* D27-284: the tax invoice by email only, with the PDF - no WhatsApp, no
     Meta template; a report by email to one of the hotel's people. */
  const pdf = { name: "Invoice-5EL-2026-27-0001.pdf", contentType: "application/pdf",
    base64: Buffer.from("%PDF-1.4 made up").toString("base64") };
  const invoice = (over: Json = {}) => message({
    kind: "invoice", file: pdf,
    data: { guestName: "Asha Test", hotelName: "Test Hotel", invoiceNumber: "5EL/2026-27/0001",
      invoiceDate: "03 Oct 2026", total: "INR 1,050.00", reference: "FH-5EL-2610-0001" },
    ...over,
  });

  it("refuses the invoice on WhatsApp: there is no template for it (D27-284)", () => {
    expect(whatsapp(invoice())).toMatchObject({ stop: true, statusCode: 422, answer: { ok: false } });
  });

  it("writes the invoice's email with the PDF attached, and the daily report's with its key figures (D27-280)", () => {
    const [mail] = run(withMailbox(), "Read the message", { body: invoice({ channel: "email" }) });
    expect(mail!.json).toMatchObject({ stop: false, email: true, attachments: "data", to: "asha@example.com" });
    expect(mail!.json["subject"]).toBe("Your tax invoice from Test Hotel (5EL/2026-27/0001)");
    expect(mail!.json["text"]).toContain("Your tax invoice 5EL/2026-27/0001, dated 03 Oct 2026, for INR 1,050.00 is attached.");

    const [report] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "daily-report", file: pdf, to: { email: "owner@example.com" },
      data: { reportTitle: "Night audit report", hotelName: "Test Hotel", businessDate: "02/10/2026",
        keyFigures: "Rooms occupied: 12 of 18\nRoom revenue with tax: ₹1,23,456.00\nMoney <taken>: -" } }) });
    expect(report!.json).toMatchObject({ stop: false, to: "owner@example.com", attachments: "data",
      subject: "Test Hotel daily reports - 2 Oct 2026" });
    expect(report!.json["text"], "a single report from before D27-371: its title from reportTitle")
      .toContain("Night audit report\n\nRooms occupied");
    expect(report!.json["text"]).toContain("Rooms occupied: 12 of 18\nRoom revenue with tax: ₹1,23,456.00");
    const html = String(report!.json["html"]);
    expect(html).toMatch(/<td[^>]*>Room revenue with tax<\/td><td[^>]*>₹1,23,456.00<\/td>/);
    expect(html, "a figure is text, never markup").toContain("Money &lt;taken&gt;");
  });

  it("marks a day's reports sent again after a cancel as Corrected, in the subject and at the top (D27-390)", () => {
    const pdf = { name: "Night-audit-report-5EL-2026-10-02.pdf", contentType: "application/pdf",
      base64: Buffer.from("%PDF-1.4 made up").toString("base64") };
    const [report] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "daily-report", file: pdf, to: { email: "owner@example.com" },
      data: { reportTitle: "Night audit report", hotelName: "Test Hotel", businessDate: "02/10/2026", corrected: "yes",
        keyFigures: "Night audit report\nRooms occupied: 12 of 18" } }) });
    expect(report!.json["subject"]).toBe("Corrected: Test Hotel daily reports - 2 Oct 2026");
    expect(String(report!.json["text"]).split("\n")[0])
      .toBe("Corrected: this day's night audit was cancelled and run again. These reports replace the ones sent before.");
  });

  it("writes any report's email: the note, its facts as a table, a day still open, or by schedule (D27-383 item 5)", () => {
    const xlsx = { name: "5EL-manager-2026-11-05.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: Buffer.from("PK made up").toString("base64") };
    const [byHand] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "report", file: xlsx, to: { email: "owner@example.com" },
      data: { hotelName: "Test Hotel", reportTitle: "Manager report", period: "As on 05/11/2026",
        facts: "As on Date: 05/11/2026\nCurrency: INR", sentBy: "Asha Test", note: "For <b>Monday</b>",
        openDay: "06/11/2026" } }) });
    expect(byHand!.json).toMatchObject({ stop: false, to: "owner@example.com", attachments: "data",
      subject: "Test Hotel: Manager report - As on 05/11/2026" });
    const text = String(byHand!.json["text"]);
    expect(text.split("\n\n")[0]).toBe("A note from Asha Test: For <b>Monday</b>");
    expect(text).toContain("As on Date: 05/11/2026\nCurrency: INR");
    expect(text).toContain("The night audit has not closed 6 Nov 2026 yet: the figures for that day may still change.");
    expect(text).toContain("Sent by Asha Test from the PMS.");
    expect(String(byHand!.json["html"]), "a typed note is text, never markup").toContain("For &lt;b&gt;Monday&lt;/b&gt;");
    expect(byHand!.binary?.["data"], "the Excel file attached as it came").toMatchObject(
      { mimeType: xlsx.contentType, fileName: xlsx.name });

    const [scheduled] = run(withMailbox(), "Read the message", { body: message({
      channel: "email", kind: "report", file: pdf, to: { email: "owner@example.com" },
      data: { hotelName: "Test Hotel", reportTitle: "Voids", period: "31/01/2000 to 06/02/2000",
        facts: "From: 31/01/2000\nTo: 06/02/2000", schedule: "every Sunday" } }) });
    const words = String(scheduled!.json["text"]);
    expect(scheduled!.json["subject"]).toBe("Test Hotel: Voids - 31/01/2000 to 06/02/2000");
    expect(words.split("\n\n")[0]).toBe("Voids for Test Hotel, 31/01/2000 to 06/02/2000.");
    expect(words).toContain("Sent by schedule, every Sunday.");
    expect(words).not.toContain("night audit has not closed");
  });

  it("refuses a kind it has no template for, in a sentence", () => {
    expect(whatsapp({ kind: "bill" })).toMatchObject({ stop: true, statusCode: 422, answer: { ok: false } });
  });

  it("answers a retry of a message it sent already, and sends nothing", () => {
    const memory = { sent: { [ID]: Date.now() } };
    const [out] = run(withMailbox(), "Read the message", { body: message({ channel: "email" }) }, { memory });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 200, answer: { duplicate: true } });
    const [code] = run(crs, "Read the message", { body: message({ kind: "guest-link-code", data: { code: "482913" } }) }, { memory });
    expect(code!.json, "a check-in code too").toMatchObject({ stop: true, statusCode: 200, answer: { duplicate: true } });
  });

  it("remembers an email only once it went", () => {
    const earlier = { "Read the message": { messageId: ID } };
    const memory: Json = {};
    const [failed] = run(crs, "Remember it", { error: { message: "SMTP said no" } }, { earlier, memory });
    expect(failed!.json).toMatchObject({ statusCode: 502 });
    expect(memory["sent"]).toBeUndefined();
    const [went] = run(crs, "Remember it", { accepted: ["asha@example.com"] }, { earlier, memory });
    expect(went!.json).toMatchObject({ statusCode: 200 });
    expect(Object.keys(memory["sent"] as Json)).toEqual([ID]);
  });
});
