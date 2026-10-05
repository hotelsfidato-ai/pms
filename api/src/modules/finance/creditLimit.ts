import type { Client } from "../../db.ts";
import { inr } from "../../reportRender.ts";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY OVER ITS CREDIT LIMIT (the owner's D27-275 part 5)

   credit_limit was shown and never asked (177). A booking or a charge
   billed to a company is now refused where what the company owes now plus
   this amount is over its limit: "<Company> is over its credit limit by
   ₹x." What it owes is the group's, as the limit is (the owner's D27-279):
   app.company_owes (203), the City ledger's closing balance for it summed
   over every hotel, one number through a definer. No limit set (NULL):
   nothing is asked.

   The owner, an administrator or the GM may allow it with a reason. The
   allowance is a row of credit_limit_allowances (199), audited, so it is
   in the activity log under their name. The database asks the role too
   (its insert policy, app.manages_hotel).

   ⚠ CALL IT LAST AMONG THE CALLER'S REFUSALS. An allowance is a write, and
   a refusal returned after a write keeps the write (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export type OverLimit = { reason: string; needs: "credit-limit" };

export async function overCreditLimit(
  client: Client, hotelId: string, companyId: string | null, amount: number,
  allow: { reason?: string | undefined; title: string },
): Promise<OverLimit | null> {
  if (!companyId || !(amount > 0)) return null;
  const { rows: [co] } = await client.query<{ name: string; over: string | null }>(
    `select co.name, (app.company_owes(co.id) + $2::numeric - co.credit_limit)::text as over
       from companies co where co.id = $1`,
    [companyId, amount]);
  if (!co || co.over === null || !(Number(co.over) > 0)) return null;

  const said = `${co.name} is over its credit limit by ₹${inr(Number(co.over))}.`;
  if (allow.reason === undefined) return { reason: said, needs: "credit-limit" };
  if (!allow.reason.trim()) return { reason: `${said} Say why it is allowed.`, needs: "credit-limit" };
  const { rows: [may] } = await client.query<{ yes: boolean }>(
    "select app.manages_hotel($1) as yes", [hotelId]);
  if (!may?.yes) {
    return {
      reason: `${said} Allowing it is for the owner, an administrator or the general manager. Ask one of them.`,
      needs: "credit-limit",
    };
  }
  await client.query(
    `insert into credit_limit_allowances (hotel_id, company_id, title, amount, over_by, reason)
     values ($1, $2, $3, $4, $5, $6)`,
    [hotelId, companyId, `${co.name}: ${allow.title}`, amount, co.over, allow.reason.trim()]);
  return null;
}
