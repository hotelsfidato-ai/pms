import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";

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
export const FOLIO_SELECT = `
  with live as (
    /* fp.* CARRIES reservation_id SINCE 056, so the folio's own is no longer
       selected alongside it - two columns of one name made every later
       reference ambiguous and broke this endpoint, the notification count and
       the night-audit checklist together.

       The posting's is the better answer anyway: on a master folio the folio
       has no reservation, and the posting names the stay the line is for. */
    select fp.*
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

/** The tax invoice standing on a line's bill (`fp`): issued and not
    credited - issueFolioInvoice's own question before it issues another.
    Once one stands, only a credit note corrects the bill (D27-162). */
export const STANDING_INVOICE = `(
  select i.number from invoices i
   where i.folio_id = fp.folio_id and i.credits_id is null
     and not exists (select 1 from invoices cn where cn.credits_id = i.id)
   order by i.issued_at desc limit 1)`;

/** ONE BILL'S FIGURES, by the folio rather than the stay (28 September, for
    the split bill's Settle and for a banquet function's bill, which has no
    stay). The live postings, as FOLIO_SELECT counts them; null when nothing
    live is posted - no bill is not a bill of zeros (FIN-2). */
export async function folioBalance(client: Client, folioId: string): Promise<{
  charges: number; tax: number; paid: number; balance: number;
} | null> {
  const { rows } = await client.query<{
    n: string; charges: string; tax: string; paid: string; balance: string;
  }>(
    `select count(*)::text as n,
            coalesce(sum(amount) filter (where category <> 'payment'), 0)::text as charges,
            coalesce(sum(tax_amount), 0)::text                                 as tax,
            coalesce(-sum(amount) filter (where category = 'payment'), 0)::text as paid,
            coalesce(sum(amount + tax_amount), 0)::text                        as balance
       from folio_postings fp
      where fp.folio_id = $1
        and fp.reverses_id is null
        and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)`,
    [folioId]);
  const r = rows[0]!;
  if (r.n === "0") return null;
  const two = (s: string) => Math.round(Number(s) * 100) / 100;
  return { charges: two(r.charges), tax: two(r.tax), paid: two(r.paid), balance: two(r.balance) };
}

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

    /* A STAY WITH NOTHING POSTED HAS NO BILL (FIN-2, the owner's D17-16).
       This returned a folio of zeros marked "settled", and the Bill tab
       said ₹0 Settled in green, the In house list ₹0 — a paid bill, for a
       stay nobody has billed. "No bill" is its own answer. */
    return rows[0] ? toFolio(rows[0]) : { noBill: true as const };
  });

  if (body && "noBill" in body) {
    return c.json({ error: "This stay has no bill yet.", noBill: true }, 404);
  }
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
      /* A banquet function's bill has no stay; it is not listed here
         (round E, 28 September). */
      .filter((f) => f.balance !== 0 && f.stayId !== null)
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
      folio_id: string;
      bill_to: string;
      company: string | null;
      business_date: string;
      category: string;
      description: string;
      amount: string;
      tax_amount: string;
      reverses_id: string | null;
      reversed: boolean;
      created_at: string;
      posted_by: string | null;
      day_closed: boolean;
      invoice: string | null;
    }>(
      `select fp.id::text, fp.folio_id::text, f.bill_to, co.name as company,
              fp.business_date::text, fp.category, fp.description,
              fp.amount, fp.tax_amount, fp.reverses_id::text,
              exists (select 1 from folio_postings r where r.reverses_id = fp.id) as reversed,
              fp.created_at::text,
              -- Why Edit is off for a line, before anybody types (D27-157):
              -- its day closed by the night audit, or a tax invoice on its bill.
              exists (select 1 from night_audit_runs na
                       where na.hotel_id = fp.hotel_id and na.business_date = fp.business_date
                         and na.status = 'completed') as day_closed,
              ${STANDING_INVOICE} as invoice,
              -- WHO, BY NAME: the person signed in when the line was made
              -- (101), as the Audit log names them. It printed the uuid, or
              -- "admin" for nobody. The night's room charge says "Night
              -- audit", not whoever pressed Run (the owner, 24 September).
              case when fp.source_type = 'night_audit' then 'Night audit'
                   else app.posted_by_name(fp.id) end as posted_by
         from folio_postings fp
         join folios f on f.id = fp.folio_id
         left join companies co on co.id = f.company_id
        where f.hotel_id = $1 and f.reservation_id = $2
        order by f.opened_at, fp.business_date, fp.id`,
      [hotelId, c.req.param("id")],
    );

    return rows.map((p) => ({
      id: p.id,
      /* The REAL folio, not the stay. This returned the stay id under
         the name `folioId` — harmless while every stay had exactly one
         folio, and wrong the moment one has two: the panel could not
         tell which bill a line was on, which is the only question
         split billing asks. */
      folioId: p.folio_id,
      stayId: c.req.param("id"),
      billTo: p.bill_to,
      company: p.company,
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
      /* Null where nobody was recorded (lines from before 101, bulk loads):
         the bill prints a dash, never a name nobody was. */
      user: p.posted_by,
      dayClosed: p.day_closed,
      invoice: p.invoice,
    }));
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});

/* THE BILL AS IT STANDS (D21-10) — what the desk prints and the guest's
   page shows, from ONE definition: `app.stay_bill` in migration 123. The
   hotel's own name and GSTIN, the live lines, tax by each line's own rate.
   The printed bill used to build itself in the browser with a made-up
   GSTIN and a fixed 2.5% (21 September). Row security decides whose stay
   this session may read, as for every other finance read. */
folios.get("/:code/stays/:id/bill", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ bill: unknown }>(
      `select app.stay_bill(r.id) as bill
         from reservations r
        where r.hotel_id = $1 and r.id = $2`,
      [hotelId, c.req.param("id")],
    );
    return rows[0]?.bill ?? null;
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});


/* ══════════════════════════════════════════════════════════════════
   SPLIT BILLING

   Migration 006 says it plainly: "a company pays the room while the
   guest pays their own bar tab, which is two folios on one stay. Model
   that from the start; retrofitting split billing is genuinely
   painful." The model was built. Nothing ever used it — every stay got
   exactly one folio, and `bill_to` and `company_id` were columns no
   code had ever written.

   So the commonest corporate arrangement in an Indian hotel could not
   be expressed, and the front desk settled it by issuing one bill and
   letting the company argue about the bar.

   A TRANSFER IS TWO POSTINGS, NEVER A MOVE

   The ledger is append-only and a wrong posting is REVERSED with its
   own row. Moving a charge between folios by updating `folio_id` would
   be an edit — the one thing this ledger does not permit — and it
   would silently change a folio that may already have been invoiced.

   So a transfer REVERSES the line on the folio it is leaving and posts
   a fresh one on the folio it joins. Three rows exist afterwards and
   all three are true: the charge happened, it was taken off this bill,
   it went onto that one.
   ══════════════════════════════════════════════════════════════════ */

/** Every folio on one stay, each with its own balance. */
folios.get("/:code/stays/:id/folios", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; bill_to: string; company_id: string | null;
      company: string | null; status: string; balance: string;
      lines: string;
    }>(
      `select f.id::text, f.bill_to, f.company_id::text,
              c.name as company, f.status,
              coalesce((
                select sum(fp.amount + fp.tax_amount)
                  from folio_postings fp
                 where fp.folio_id = f.id
                   and fp.reverses_id is null
                   and not exists (select 1 from folio_postings rev
                                    where rev.reverses_id = fp.id)
              ), 0)::text as balance,
              coalesce((
                select count(*) from folio_postings fp
                 where fp.folio_id = f.id
                   and fp.reverses_id is null
                   and not exists (select 1 from folio_postings rev
                                    where rev.reverses_id = fp.id)
              ), 0)::text as lines
         from folios f
         left join companies c on c.id = f.company_id
        where f.hotel_id = $1 and f.reservation_id = $2
        order by f.opened_at`,
      [hotelId, c.req.param("id")],
    );

    return rows.map((r) => ({
      id: r.id,
      billTo: r.bill_to,
      companyId: r.company_id,
      /* A company folio always names its company — the schema refuses
         one that does not — so a null here is a guest folio, not a
         missing name. The interface says "Guest", never a dash. */
      company: r.company,
      status: r.status,
      balance: Math.round(Number(r.balance) * 100) / 100,
      lines: Number(r.lines),
    }));
  });

  return body ? c.json(body) : c.json({ error: "Not found." }, 404);
});

/** Open a second folio on a stay. */
folios.post("/:code/stays/:id/folios", async (c) => {
  type Body = { billTo?: string; companyId?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const billTo = input.billTo ?? "company";
  if (billTo !== "guest" && billTo !== "company") {
    return c.json({ ok: false, reason: "Who settles this folio?" }, 409);
  }
  if (billTo === "company" && !input.companyId) {
    return c.json({ ok: false, reason: "Which company is paying?" }, 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: stay } = await client.query(
      "select 1 from reservations where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")],
    );
    if (!stay.length) return { ok: false, reason: "No such stay." };

    if (input.companyId) {
      /* Named back on refusal rather than letting the foreign key say
         23503.

         ⚠ `companies` is GROUP-level — no hotel_id, like `guests`. One
         corporate account is billable at every property in the group,
         which is the point of a group. This check filtered on a column
         that does not exist and would have refused every company at
         every property. */
      const { rows: co } = await client.query(
        "select 1 from companies where id = $1 and is_active",
        [input.companyId],
      );
      if (!co.length) {
        return { ok: false, reason: "That company is not on file." };
      }
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into folios (hotel_id, reservation_id, bill_to, company_id)
       values ($1,$2,$3,$4) returning id::text`,
      [hotelId, c.req.param("id"), billTo,
       billTo === "company" ? input.companyId : null],
    );
    return { ok: true as const, id: rows[0]!.id };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});

/** Move one charge onto another folio on the same stay. */
folios.post("/:code/postings/:id/transfer", async (c) => {
  type Body = { toFolioId?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  if (!input.toFolioId) {
    return c.json({ ok: false, reason: "Which folio does it go to?" }, 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: src } = await client.query<{
      id: string; folio_id: string; reservation_id: string;
      business_date: string; category: string; description: string;
      amount: string; tax_rate: string; tax_amount: string;
      tax_scheme: string; folio_status: string;
    }>(
      `select fp.id::text, fp.folio_id::text, f.reservation_id::text,
              fp.business_date::text, fp.category, fp.description,
              fp.amount::text, fp.tax_rate::text, fp.tax_amount::text,
              fp.tax_scheme, f.status as folio_status
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where fp.id = $1 and fp.hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    const line = src[0];
    if (!line) return { ok: false, reason: "That charge is not here." };

    /* Already reversed, or itself a reversal. Transferring either would
       put a charge on the new folio that no longer exists on the old. */
    if (line.category === "payment") {
      return {
        ok: false,
        reason: "A payment stays where it was taken. Refund it instead.",
      };
    }
    const { rows: dead } = await client.query(
      `select 1 from folio_postings
        where reverses_id = $1
           or (id = $1 and reverses_id is not null)`,
      [line.id],
    );
    if (dead.length) {
      return { ok: false, reason: "That charge has already been reversed." };
    }

    if (line.folio_id === input.toFolioId) {
      return { ok: false, reason: "It is already on that folio." };
    }

    /* The destination has to be on the SAME STAY. Without this a charge
       could be moved onto a stranger's bill, and the two folios would
       both look correct. */
    const { rows: dest } = await client.query<{ status: string }>(
      `select status from folios
        where id = $1 and hotel_id = $2 and reservation_id = $3`,
      [input.toFolioId, hotelId, line.reservation_id],
    );
    if (!dest[0]) {
      return { ok: false, reason: "That folio is not on this stay." };
    }
    if (dest[0].status !== "open") {
      return { ok: false, reason: "That folio is closed." };
    }
    if (line.folio_status !== "open") {
      return { ok: false, reason: "This folio is closed." };
    }

    /* BOTH rows land on the CURRENT business date, never the charge's
       own. D4 refuses any posting to a date the night audit has
       closed, and its message says exactly what to do: "post to the
       current date instead". It is also the right accounting — a
       closed day is closed, and a transfer agreed this morning is
       this morning's movement, not a retrospective edit of a night
       already reported. The original date rides in the description so
       the trail still reads. */
    const today = await businessDateFor(client, hotelId);
    const on = line.business_date === today
      ? line.description
      : `${line.description} (${line.business_date})`;

    /* Off this bill — a reversing row, pointed at the original, which
       is what makes the pair cancel rather than merely annotate. */
    await client.query(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, reverses_id, posted_by)
       values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,app.current_user_id())`,
      [hotelId, line.folio_id, today, line.category,
       `Transferred out - ${on}`,
       -Number(line.amount), line.tax_rate, -Number(line.tax_amount),
       line.id],
    );

    /* And onto that one. A fresh charge, not a copy of a reversed row:
       it is the same money arriving on a different account - under the
       same tax. The row above takes its tax from the line it reverses (126's
       trigger); this one is not a reversal, so it is told: VAT on alcohol
       moved to a company's folio is still VAT (D21-91). */
    const { rows: moved } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount, tax_scheme, source_type, posted_by)
       values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,'transfer',
               app.current_user_id())
       returning id::text`,
      [hotelId, input.toFolioId, today, line.category,
       `Transferred in - ${on}`,
       line.amount, line.tax_rate, line.tax_amount, line.tax_scheme],
    );

    return { ok: true as const, id: moved[0]!.id };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok ? 200 : 409);
});


/* ── Companies a bill can be addressed to ─────────────────────────────
   NOT `/:code/companies`. That endpoint answers a different question —
   revenue by ACCOUNT — and merges the `companies` table with booking
   sources under `coalesce(co.name, source)`, grouped by name with a
   SLUGGED id. Perfect for the directory screen it was written for, and
   useless for a picker: passing its id to anything expecting a company
   produces `invalid input syntax for type uuid: "fidato-hotels"`.

   Found exactly that way, by driving the split-billing dialog.

   Group-level, like `guests`: one corporate account is billable at
   every property in the group, which is the point of a group.
   ═══════════════════════════════════════════════════════════════════ */
folios.get("/:code/billing-companies", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; name: string; gstin: string | null;
    }>(
      `select id::text, name, nullif(gstin, '') as gstin
         from companies where is_active order by name`,
    );
    return rows;
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
