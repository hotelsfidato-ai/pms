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
  const withMailbox = (): Workflow => ({
    ...crs,
    nodes: crs.nodes.map((n) => n.name !== "Read the message" ? n : {
      ...n, parameters: { ...n.parameters, jsCode: n.parameters.jsCode!.replace('const FROM = "";', 'const FROM = "desk@example.test";') },
    }),
  });

  it("refuses every email until the owner names the mailbox", () => {
    const [out] = run(crs, "Read the message", { body: message({ channel: "email" }) });
    expect(out!.json).toMatchObject({ stop: true, statusCode: 503 });
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
    ["booking-confirmation", "booking_confirmation",
      ["Asha Test", "Test Hotel", "FH-5EL-2610-0001", "01/10/2026", "03/10/2026", "2", "https://example.test/g/x"]],
    ["arrival-reminder", "stay_reminder",
      ["Asha Test", "Test Hotel", "01/10/2026", "FH-5EL-2610-0001", "https://example.test/g/x"]],
    ["checkin-link", "checkin_link",
      ["Asha Test", "Test Hotel", "01/10/2026", "FH-5EL-2610-0001", "https://example.test/g/x"]],
    ["review", "review_request", ["Asha Test", "Test Hotel", "https://example.test/g/x"]],
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

  it("sends the check-in code as guest_page_code, in the body and in the copy button", () => {
    const graph = whatsapp({ kind: "guest-link-code", data: { code: "482913", reference: "R" } })["graphBody"] as Graph;
    expect(graph.template.name).toBe("guest_page_code");
    expect(graph.template.language.code).toBe("en");
    expect(graph.template.components.map((c) => c.type)).toEqual(["body", "button"]);
    expect(graph.template.components.map((c) => c.parameters[0]!.text)).toEqual(["482913", "482913"]);
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
