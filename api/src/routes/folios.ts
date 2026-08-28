import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   FOLIOS — derived from the ledger, never stored

   A folio has no balance column, here or in the in-memory store it
   replaces. The balance is the sum of the live postings, and a wrong
   posting is REVERSED rather than edited — so the arithmetic is
   always over what actually happened, not over what somebody last
   decided the total was.

   This has to move with `stays`, not after it: a folio is keyed by
   its reservation id. Swapping stays alone would have left the
   interface asking the store for postings under a Postgres uuid it
   has never seen, and every folio would have read zero — silently.
   ══════════════════════════════════════════════════════════════════ */

export const folios = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

interface FolioRow {
  stay_id: string;
  room_charges: string;
  extra_charges: string;
  tax: string;
  discount: string;
  payments: string;
  balance: string;
}

/*
 * `reverses_id` marks the REVERSING entry; the original is found by
 * being pointed at. Both are excluded, which is what makes a reversal
 * cancel rather than merely annotate.
 */
const FOLIO_SELECT = `
  with live as (
    select fp.*, f.reservation_id
      from folio_postings fp
      join folios f on f.id = fp.folio_id
     where f.hotel_id = $1
       and fp.reverses_id is null
       and not exists (
         select 1 from folio_postings rev
          where rev.reverses_id = fp.id
       )
  )
  select l.reservation_id                                   as stay_id,
         /* The store lumps every positive charge into roomCharges and
            reports extraCharges as 0. Reproduced exactly, because CP9
            is a change of TRANSPORT: a figure that moves here cannot
            be told apart from a query that is wrong. Splitting them
            properly is a separate, visible change. */
         coalesce(sum(l.amount) filter (where l.category <> 'payment'
                                          and l.amount > 0), 0)::text as room_charges,
         '0'::text                                          as extra_charges,
         coalesce(sum(l.tax_amount), 0)::text               as tax,
         coalesce(-sum(l.amount) filter (where l.category <> 'payment'
                                           and l.amount < 0), 0)::text as discount,
         coalesce(-sum(l.amount) filter (where l.category = 'payment'), 0)::text as payments,
         coalesce(sum(l.amount + l.tax_amount), 0)::text     as balance
    from live l
   group by l.reservation_id
`;

const toFolio = (r: FolioRow) => {
  const balance = Math.round(Number(r.balance) * 100) / 100;
  return {
    stayId: r.stay_id,
    roomCharges: Number(r.room_charges),
    extraCharges: Number(r.extra_charges),
    tax: Number(r.tax),
    discount: Number(r.discount),
    payments: Number(r.payments),
    balance,
    status: balance === 0 ? "settled" : "open",
  };
};

/** One folio. Returns null rather than an empty one for an unknown stay. */
folios.get("/:code/stays/:id/folio", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The reservation must exist and be visible, or an unknown id
       would come back as a folio of zeros — which reads as "settled"
       and is the wrong answer to "does this guest owe anything". */
    const { rows: exists } = await client.query(
      "select 1 from reservations where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")],
    );
    if (!exists.length) return null;

    const { rows } = await client.query<FolioRow>(
      `${FOLIO_SELECT} having l.reservation_id = $2`,
      [hotelId, c.req.param("id")],
    );

    /* A stay with no postings has an empty folio, not no folio. */
    return rows[0]
      ? toFolio(rows[0])
      : {
          stayId: c.req.param("id"),
          roomCharges: 0, extraCharges: 0, tax: 0,
          discount: 0, payments: 0, balance: 0, status: "settled",
        };
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});

/** Every folio carrying a balance — overpayments included, as negatives. */
folios.get("/:code/folios", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<FolioRow>(FOLIO_SELECT, [hotelId]);

    /* Money owed OUTWARD sorts first. Nobody chases a refund they are
       owed, so it is the balance most easily lost. */
    return rows
      .map(toFolio)
      .filter((f) => f.balance !== 0)
      .sort((a, b) => a.balance - b.balance);
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** The ledger itself, for the folio panel. */
folios.get("/:code/stays/:id/postings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string;
      business_date: string;
      category: string;
      description: string;
      amount: string;
      tax_amount: string;
      reverses_id: string | null;
      reversed: boolean;
      created_at: string;
      posted_by: string | null;
    }>(
      `select fp.id::text, fp.business_date::text, fp.category, fp.description,
              fp.amount, fp.tax_amount, fp.reverses_id::text,
              exists (select 1 from folio_postings r where r.reverses_id = fp.id) as reversed,
              fp.created_at::text, fp.posted_by::text
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2
        order by fp.business_date, fp.id`,
      [hotelId, c.req.param("id")],
    );

    return rows.map((p) => ({
      id: p.id,
      folioId: c.req.param("id"),
      businessDate: p.business_date,
      category: p.category,
      description: p.description,
      amount: Number(p.amount),
      tax: Number(p.tax_amount),
      kind:
        p.category === "payment" ? "payment"
          : p.reverses_id ? "reversal"
          : "charge",
      ...(p.reverses_id ? { reversalOf: p.reverses_id } : {}),
      reversed: p.reversed,
      createdAt: p.created_at,
      user: p.posted_by ?? "admin",
    }));
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});
