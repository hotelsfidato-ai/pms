// @vitest-environment node
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* A dry run of pms-send-crs.json's two Code nodes, as n8n runs them: "Read
   the message" as new Function("$input", "$getWorkflowStaticData", code), and
   "Build the voucher message" as new Function("$", "$input", code). Fake
   messages only; nothing is sent. The json's code is what the owner pastes
   (IMPORT.md, "5 October paste"). */
const flow = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pms-send-crs.json"), "utf8"));
const code = (name) => flow.nodes.find((n) => n.name === name).parameters.jsCode;
const READ = code("Read the message");
const BUILD = code("Build the voucher message");

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const read = (body, src = READ) =>
  new Function("$input", "$getWorkflowStaticData", src)({ first: () => ({ json: { body: { messageId: uuid(), ...body } } }) }, () => ({}))[0];
const build = (out) =>
  new Function("$", "$input", BUILD)(() => ({ first: () => ({ json: out.json }) }),
    { first: () => ({ json: { statusCode: 200, body: { id: "media-1" } } }) })[0].json;

const pdf = { name: "voucher.pdf", contentType: "application/pdf", base64: "JVBERi0=" };
const hotel = { id: "h1", code: "5EL", name: "5 Elements" };
const voucherData = {
  guestName: "Asha Rao", hotelName: "5 Elements", reference: "5EL-1001", checkInLong: "Mon, 6 Oct 2026",
  checkOutLong: "Wed, 8 Oct 2026", roomTypes: "1 x Deluxe", guests: "2 adults", hotelPhone: "+91 20 1234 5678",
  officePhone: "+91 22 0000 0000",
};
const voucher = (data) => ({
  channel: "whatsapp", kind: "booking-voucher", hotel, to: { phone: "9876543210" },
  from: { phoneNumberId: "1234567890" }, data, file: pdf,
});
const LINK = "https://pms.fidatohotels.com/g/AbC-12_xyz";
const ready = READ.replace("const OWN_TEMPLATE_READY = false;", "const OWN_TEMPLATE_READY = true;");
const button = { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "AbC-12_xyz" }] };
const crsFields = [["name_1", "Asha Rao"], ["hotel_id", "5EL-1001"], ["hotel", "5 Elements"], ["ck_in", "Mon, 6 Oct 2026"],
  ["ck_out", "Wed, 8 Oct 2026"], ["rm_type", "1 x Deluxe"], ["no_guest", "2 adults"], ["crs_nom", "+91 22 0000 0000"]]
  .map(([name, text]) => ({ type: "text", parameter_name: name, text }));

it("ships with the owner's template switched off", () => {
  expect(READ).toContain("const OWN_TEMPLATE_READY = false;");
  expect(ready).not.toBe(READ);
});

it("a voucher with a link, not ready yet: the CRS template, no button", () => {
  const out = read(voucher({ ...voucherData, link: LINK }));
  expect(out.json).toMatchObject({ stop: false, upload: true, to: "919876543210" });
  expect(out.json.template).toEqual({ name: "reservation_confirmation", language: { code: "en" }, body: crsFields });
  expect(build(out).graphBody.template.components.map((c) => c.type)).toEqual(["header", "body"]);
});

it("a voucher with a link, ready: booking_confirmation, eight numbered fields, the button", () => {
  const out = read(voucher({ ...voucherData, link: LINK }), ready);
  expect(out.json.template).toEqual({
    name: "booking_confirmation", language: { code: "en" }, button: "AbC-12_xyz",
    body: ["Asha Rao", "5 Elements", "5EL-1001", "Mon, 6 Oct 2026", "Wed, 8 Oct 2026", "1 x Deluxe", "2 adults", "+91 20 1234 5678"]
      .map((text) => ({ type: "text", text })),
  });
  const sent = build(out).graphBody.template;
  expect(sent.name).toBe("booking_confirmation");
  expect(sent.components).toEqual([
    { type: "header", parameters: [{ type: "document", document: { id: "media-1", filename: "voucher.pdf" } }] },
    { type: "body", parameters: out.json.template.body },
    button,
  ]);
});

it("a voucher without a link, even when ready: the CRS template, unchanged", () => {
  const out = read(voucher(voucherData), ready);
  expect(out.json.template).toEqual({ name: "reservation_confirmation", language: { code: "en" }, body: crsFields });
  expect(build(out).graphBody.template.components.some((c) => c.type === "button")).toBe(false);
});

it("a daily report: the figures as a table, the PDF attached", () => {
  const out = read({
    channel: "email", kind: "daily-report", hotel, to: { email: "gm@example.com" }, file: { ...pdf, name: "Night-audit.pdf" },
    data: { reportTitle: "Night audit report", hotelName: "5 Elements", businessDate: "05/10/2026",
      keyFigures: "Occupancy: 82%\nRoom revenue: ₹1,20,000\nA <b> figure: 3" },
  });
  expect(out.json).toMatchObject({ stop: false, email: true, to: "gm@example.com", attachments: "data",
    subject: "Night audit report - 5 Elements - 05/10/2026" });
  expect(out.binary.data.fileName).toBe("Night-audit.pdf");
  expect(out.json.text).toBe("Night audit report for 5 Elements, business date 05/10/2026.\n\n"
    + "Occupancy: 82%\nRoom revenue: ₹1,20,000\nA <b> figure: 3\n\nThe whole report is attached as a PDF.\n\n"
    + "Sent after the night audit. The owner, an Administrator or the GM changes who gets it in Settings, Messages, Daily report emails.");
  expect(out.json.html).toContain("<table");
  expect(out.json.html.match(/<tr>/g)).toHaveLength(3);
  expect(out.json.html).toContain(">Room revenue</td>");
  expect(out.json.html).toContain("A &lt;b&gt; figure");
});

it("a connection health alert", () => {
  const out = read({
    channel: "email", kind: "health-alert", hotel, to: { email: "owner@example.com" },
    data: { connection: "WhatsApp (Meta)", problem: "The last 3 messages were refused.", hotelName: "5 Elements",
      at: "05/10/2026, 10:00", lastSuccess: "", lastError: "Template not approved" },
  });
  expect(out.json).toMatchObject({ email: true, subject: "Not working: WhatsApp (Meta)", attachments: "" });
  expect(out.json.text).toBe("WhatsApp (Meta) has stopped working at 5 Elements.\n\nThe last 3 messages were refused.\n\n"
    + "Last error: Template not approved\n\nLast success: none recorded\n\n"
    + "Noticed at 05/10/2026, 10:00. Settings, Modules and connections, Connection health shows every connection.");
  expect(out.binary).toBeUndefined();
});

const confirmation = (extra) => read({
  channel: "email", kind: "booking-confirmation", hotel, to: { email: "asha@example.com" }, file: pdf,
  data: { guestName: "Asha Rao", hotelName: "5 Elements", reference: "5EL-1001", checkInText: "06/10/2026",
    checkOutText: "08/10/2026", nights: "2", ...extra },
});
const confirmationText = "Hello Asha Rao,\n\nYour stay at 5 Elements is confirmed.\n\nBooking: 5EL-1001\n\n"
  + "Check-in: 06/10/2026\n\nCheck-out: 08/10/2026 (2 nights)\n\nYour reservation voucher is attached.";

it("the voucher email with a link: the check-in line after the voucher line (D27-282)", () => {
  const out = confirmation({ link: LINK });
  expect(out.json.subject).toBe("Your booking at 5 Elements is confirmed (5EL-1001)");
  expect(out.json.text).toBe(`${confirmationText}\n\nTo save time at the desk, you can fill in your check-in details here: ${LINK}`);
  expect(out.json.html).toContain(`<a href="${LINK}" style="color:#FE611F">${LINK}</a>`);
  expect(out.json).toMatchObject({ from: "Fidato Hotels <crs@fidatohotels.com>", replyTo: "crs@fidatohotels.com", attachments: "data" });
  expect(out.json.html).not.toContain("<table");
});

it("the voucher email without a link: no check-in line", () => {
  const out = confirmation({});
  expect(out.json.text).toBe(confirmationText);
  expect(out.json.html).not.toContain("check-in details");
});

it("the check-in code on WhatsApp: guest_page_code, the code in the body and the button", () => {
  const out = read({ channel: "whatsapp", kind: "guest-link-code", hotel, to: { phone: "+91 98765 43210" },
    from: { phoneNumberId: "1234567890" }, data: { code: "482913" } });
  expect(out.json.graphBody.template).toEqual({
    name: "guest_page_code", language: { code: "en" },
    components: [
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ],
  });
});

it("the check-in code by email", () => {
  const out = read({ channel: "email", kind: "guest-link-code", hotel, to: { email: "asha@example.com" },
    data: { guestName: "Asha Rao", hotelName: "5 Elements", code: "482913", reference: "5EL-1001" } });
  expect(out.json.subject).toBe("Your check-in code for 5 Elements");
  expect(out.json.text).toBe("Hello Asha Rao,\n\nYour code is 482913\n\nIt works for 10 minutes. Do not share it with anyone.\n\nBooking: 5EL-1001");
});

it("the tax invoice by email, its PDF attached; never on WhatsApp (D27-284)", () => {
  const data = { guestName: "Asha Rao", hotelName: "5 Elements", invoiceNumber: "5EL/26-27/0042",
    invoiceDate: "06/10/2026", total: "INR 1,050.00", reference: "5EL-1001" };
  const out = read({ channel: "email", kind: "invoice", hotel, to: { email: "asha@example.com" },
    file: { ...pdf, name: "invoice.pdf" }, data });
  expect(out.json).toMatchObject({ stop: false, email: true, to: "asha@example.com", attachments: "data",
    from: "Fidato Hotels <crs@fidatohotels.com>", subject: "Your tax invoice from 5 Elements (5EL/26-27/0042)" });
  expect(out.binary.data.fileName).toBe("invoice.pdf");
  expect(out.json.text).toBe("Hello Asha Rao,\n\nYour tax invoice 5EL/26-27/0042, dated 06/10/2026, for INR 1,050.00 is attached.\n\n"
    + "Booking: 5EL-1001\n\nThank you for staying at 5 Elements.");
  expect(read({ channel: "whatsapp", kind: "invoice", hotel, to: { phone: "9876543210" },
    from: { phoneNumberId: "1234567890" }, data, file: pdf }).json)
    .toEqual({ stop: true, statusCode: 422, answer: { ok: false, error: 'No WhatsApp template for "invoice" in this workflow.' } });
});

it("refuses a message without a proper id", () => {
  const out = new Function("$input", "$getWorkflowStaticData", READ)(
    { first: () => ({ json: { body: { messageId: "x", channel: "email" } } }) }, () => ({}))[0];
  expect(out.json).toEqual({ stop: true, statusCode: 400, answer: { ok: false, error: "No message id." } });
});
