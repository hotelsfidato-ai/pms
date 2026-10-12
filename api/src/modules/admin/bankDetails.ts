import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   A HOTEL'S BANK DETAILS (the owner's D27-215, 1 October; migration 169)

   Printed on the booking voucher when set (app.guest_voucher reads them
   through its definer); the block is left out when not. Set in Settings,
   on Taxes and billing.

     GET     /:code/bank-details   whoever manages that hotel
     PUT     /:code/bank-details   the same
     DELETE  /:code/bank-details   the same

   WHO: the hotel's owner, GM or Admin, or a group administrator -
   app.manages_hotel, asked here and by the table's own policy. The role
   gate asks the room-setup grant on the writes first (roleGate.ts,
   BANK_DETAILS). Nobody else even READS them: reception has no use for an
   account number, so a read by anybody else is refused, not answered
   "none".

   WHAT is decided before `withSession` opens (MEMORY 243): each field has
   its sentence. An account number is digits; an IFSC is its shape. Not a
   checksum and not a bank lookup - a real account must never be refused
   by a rule this file got subtly wrong.

   EVERY CHANGE IS RECORDED by the table's audit trigger, and that record
   is what the group owner's bell reads (D27-216, routes/notifications.ts).
   ══════════════════════════════════════════════════════════════════ */

export const bankDetails = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const NO_SUCH = { error: "No such property." };
const NOT_YOURS = refuse(
  "A hotel's bank details are seen and changed by its owner, general manager or Admin, "
  + "or by a group administrator. Ask one of them.");

/** The hotel, for somebody who manages it; "refused" for somebody who works
    there and does not; null for anybody else (they cannot see it at all). */
async function managed(client: Client, code: string): Promise<string | "refused" | null> {
  const { rows } = await client.query<{ id: string; manages: boolean }>(
    "select id::text, coalesce(app.manages_hotel(id), false) as manages from hotels where code = upper($1)",
    [code]);
  if (!rows[0]) return null;
  return rows[0].manages ? rows[0].id : "refused";
}

bankDetails.get("/:code/bank-details", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (hotelId === null || hotelId === "refused") return hotelId;
    /* The name through app.colleague_name, not a join to staff: a GM cannot read
       the group owner's staff row, and the join gave them null (ADM-22, MEMORY 283). */
    const { rows } = await client.query<{
      account_name: string; account_number: string; bank_name: string; branch: string | null;
      ifsc: string; upi_id: string | null; changed_at: string; changed_by: string | null;
    }>(
      `select b.account_name, b.account_number, b.bank_name, b.branch, b.ifsc, b.upi_id,
              b.changed_at::text, app.colleague_name(b.changed_by, b.hotel_id) as changed_by
         from hotel_bank_details b
        where b.hotel_id = $1`, [hotelId]);
    const b = rows[0];
    return {
      bank: b ? {
        accountName: b.account_name, accountNumber: b.account_number, bankName: b.bank_name,
        branch: b.branch, ifsc: b.ifsc, upi: b.upi_id, changedAt: b.changed_at, changedBy: b.changed_by,
      } : null,
    };
  });
  if (found === null) return c.json(NO_SUCH, 404);
  return found === "refused" ? c.json(NOT_YOURS, 403) : c.json(found);
});

bankDetails.put("/:code/bank-details", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const typed = (key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");
  const over = (what: string, value: string, most: number) =>
    value.length > most ? `${what} is ${value.length} characters. The most is ${most}.` : null;

  const accountName = typed("accountName");
  const accountNumber = typed("accountNumber").replace(/\s/g, "");
  const bankName = typed("bankName");
  const branch = typed("branch");
  const ifsc = typed("ifsc").toUpperCase();
  const upi = typed("upi");

  const wrong =
    !accountName ? "Whose name is the account in? It prints on the voucher."
    : over("The account name", accountName, 100)
    ?? (!/^[0-9]{9,18}$/.test(accountNumber) ? "An account number is 9 to 18 digits." : null)
    ?? (!bankName ? "Which bank is the account with?" : null)
    ?? over("The bank's name", bankName, 100)
    ?? over("The branch", branch, 100)
    ?? (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)
      ? "An IFSC is eleven characters: four letters, a zero, then six letters or digits." : null)
    ?? (upi && !/^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]+$/.test(upi) ? "A UPI ID looks like name@bank." : null);
  if (wrong) return c.json(refuse(wrong), 409);

  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (hotelId === null || hotelId === "refused") return hotelId;
    await client.query(
      `insert into hotel_bank_details
         (hotel_id, account_name, account_number, bank_name, branch, ifsc, upi_id, changed_by)
       values ($1, $2, $3, $4, $5, $6, $7, app.current_user_id())
       on conflict (hotel_id) do update
          set account_name = excluded.account_name, account_number = excluded.account_number,
              bank_name = excluded.bank_name, branch = excluded.branch, ifsc = excluded.ifsc,
              upi_id = excluded.upi_id, changed_by = excluded.changed_by, changed_at = now()`,
      [hotelId, accountName, accountNumber, bankName, branch || null, ifsc, upi || null]);
    return "saved" as const;
  });
  if (done === null) return c.json(NO_SUCH, 404);
  return done === "refused" ? c.json(NOT_YOURS, 403) : c.json({ ok: true });
});

bankDetails.delete("/:code/bank-details", async (c) => {
  const done = await withSession(c.get("subject"), async (client) => {
    const hotelId = await managed(client, c.req.param("code"));
    if (hotelId === null || hotelId === "refused") return hotelId;
    await client.query("delete from hotel_bank_details where hotel_id = $1", [hotelId]);
    return "removed" as const;
  });
  if (done === null) return c.json(NO_SUCH, 404);
  return done === "refused" ? c.json(NOT_YOURS, 403) : c.json({ ok: true });
});
