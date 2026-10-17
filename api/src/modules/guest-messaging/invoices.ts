import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { withUser, type Client } from "../../db.ts";
import { canSend, messageIdFor, send, NOT_CONNECTED, type Message, type SendResult } from "../../sending.ts";
import { inr } from "../../reportRender.ts";
import { invoiceFacts } from "../finance/index.ts";
import { invoiceBrand, invoiceFile } from "./invoiceDocument.ts";
import { isTestHotelId } from "../../testHotels.ts";
import { claimTurn, MOST_ATTEMPTS, perSweep, NOT_OWED } from "./jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TAX INVOICE TO THE GUEST, WITH ITS PDF (D27-252, D27-261, D27-284)

   By itself: once a hotel switches "Invoice" on (Settings → Messages), every
   tax invoice issued after that - made out to the GUEST, for a stay - goes to
   that guest BY EMAIL ONLY, where there is an address (D27-284: no WhatsApp,
   no Meta template; `invoicesOwed` keeps only the function's email rows). One
   made out to an OTA, an agent or a company is not sent by itself (Q5;
   D27-313 (2): the function asks who the invoice is made out to, not the
   bill's bill_to alone), and a credit note never (Q6). One message, sent once, three tries (app.guest_invoices_owed,
   migration "messages and reports").

   POST /api/hotels/:code/invoices/:number/send - the desk's "Send invoice":
   that one invoice by email if not sent yet, under the clerk's name; whether
   the hotel's switch is on or not, and a company's too (Q5). Never a credit
   note.

   THE SWEEP SENDS AS THE CLERK WHO ISSUED IT: the invoice's facts are read
   under that person's own session (finance's `invoiceFacts`, the screen's
   own query), so nothing is read that its issuer could not read.
   ponytail: an invoice with no issuer is not sent by itself - the button
   sends it.
   ══════════════════════════════════════════════════════════════════ */

export interface OwedInvoice {
  invoiceId: string; number: string; channel: "whatsapp" | "email"; issuedBy: string | null;
  hotel: { id: string; code: string; name: string; phone: string | null };
  reservationId: string; reference: string;
  guest: { name: string; phone: string | null; email: string | null };
}

export async function invoicesOwed(
  client: Client, hotelId: string | null, invoiceId: string | null = null,
): Promise<OwedInvoice[]> {
  const { rows } = await client.query<Record<string, string>>(
    `select invoice_id::text, number, channel, issued_by::text, hotel_id::text, hotel_code,
            hotel_name, hotel_phone, reservation_id::text, reference, guest_name, guest_phone, guest_email
       from app.guest_invoices_owed($1, $2::uuid, $3::uuid)
      where channel = 'email'`,
    [MOST_ATTEMPTS, hotelId, invoiceId]);
  return rows.map((r) => ({
    invoiceId: r["invoice_id"]!, number: r["number"]!, channel: r["channel"] as "whatsapp" | "email",
    issuedBy: r["issued_by"] ?? null,
    hotel: { id: r["hotel_id"]!, code: r["hotel_code"]!, name: r["hotel_name"]!, phone: r["hotel_phone"] ?? null },
    reservationId: r["reservation_id"]!, reference: r["reference"]!,
    guest: { name: r["guest_name"]!, phone: r["guest_phone"] ?? null, email: r["guest_email"] ?? null },
  }));
}

/** The message: named facts for the template and the email, and the PDF. */
export async function invoiceMessage(client: Client, owed: OwedInvoice): Promise<Message | null> {
  const facts = await invoiceFacts(client, owed.hotel.id, owed.number);
  if (!facts) return null;
  return {
    id: messageIdFor("invoice", owed.invoiceId, owed.channel),
    channel: owed.channel,
    kind: "invoice",
    hotel: owed.hotel,
    to: { name: owed.guest.name, phone: owed.guest.phone, email: owed.guest.email },
    data: {
      guestName: owed.guest.name,
      hotelName: owed.hotel.name,
      invoiceNumber: owed.number,
      invoiceDate: (facts.issuedAt ?? "").split(",")[0] || "-",
      total: `INR ${inr(facts.total)}`,
      reference: owed.reference,
    },
    /* D27-296: never sent from a test hotel (sending.ts refuses), and its
       PDF is marked even so. */
    file: await invoiceFile(facts, await isTestHotelId(client, owed.hotel.id), await invoiceBrand(client, owed.hotel.id)),
    about: { kind: "invoice", id: owed.invoiceId },
    sentBy: null,
  };
}

/** One invoice, one way: the turn, the question again, then the one door out. */
async function sendOne(
  client: Client, owed: OwedInvoice, sentBy: { id: string; name: string } | null,
): Promise<SendResult> {
  await claimTurn(client, "invoice", `${owed.invoiceId}:${owed.channel}`);
  const still = (await invoicesOwed(client, owed.hotel.id, owed.invoiceId))
    .some((o) => o.channel === owed.channel);
  if (!still) return { ok: false, reason: NOT_OWED };
  const message = await invoiceMessage(client, owed);
  if (!message) return { ok: false, reason: "That invoice could not be read." };
  return send(client, { ...message, sentBy });
}

export interface InvoiceSweep { due: number; sent: number }

/** The sweep's pass: the invoices owed by themselves, each sent as its issuer. */
export async function runInvoices(
  asNobody: <T>(fn: (c: Client) => Promise<T>) => Promise<T> = (fn) => withUser("", fn),
  asPerson: <T>(staffId: string, fn: (c: Client) => Promise<T>) => Promise<T> = (id, fn) => withUser(id, fn),
): Promise<InvoiceSweep> {
  const result: InvoiceSweep = { due: 0, sent: 0 };
  const pace = perSweep();
  if (!canSend() || pace === null) return result;
  const owed = await asNobody((c) => invoicesOwed(c, null));
  result.due = owed.length;
  for (const o of owed.filter((x) => x.issuedBy).slice(0, pace)) {
    try {
      const answer = await asPerson(o.issuedBy!, (c) => sendOne(c, o, null));
      if (answer.ok) result.sent += 1;
    } catch (error) {
      console.error("[guest-messaging] could not send invoice", o.number,
        error instanceof Error ? error.message : error);
    }
  }
  return result;
}

export const invoiceSends = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

invoiceSends.post("/:code/invoices/:number{.+}/send", async (c) => {
  if (!canSend()) return c.json(refuse(NOT_CONNECTED), 503);
  const result = await withSession(c.get("subject"), async (client, session) => {
    const { rows } = await client.query<{ id: string; hotel_id: string; is_note: boolean }>(
      `select i.id::text, i.hotel_id::text, i.credits_id is not null as is_note
         from invoices i join hotels h on h.id = i.hotel_id
        where h.code = upper($1) and i.number = $2`,
      [c.req.param("code"), c.req.param("number")]);
    const invoice = rows[0];
    if (!invoice) return null;
    if (invoice.is_note) return refuse("A credit note is not sent to the guest.");
    const owed = await invoicesOwed(client, invoice.hotel_id, invoice.id);
    if (owed.length === 0) {
      return refuse("It has gone to the guest by email already, or the guest has no email address.");
    }
    const failed: string[] = [];
    for (const o of owed) {
      const answer = await sendOne(client, o, { id: session.staffId, name: session.fullName });
      if (!answer.ok) failed.push(answer.reason);
    }
    return failed.length ? refuse(failed.join(" ")) : { ok: true as const };
  });
  if (!result) return c.json({ error: "No such invoice." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
