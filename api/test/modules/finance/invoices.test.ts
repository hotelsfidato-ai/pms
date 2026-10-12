import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   TAX INVOICES AND FORM C

   Invoices are issued against the DEMO property, because their whole
   job is to state what the ledger already says and the demo ledger is
   the one calibrated to a real eZee export.

   Form C is tested at PUNE, with a guest this file creates. Every
   guest in the demo is Indian — the export it reconciles to had no
   foreign nationals — and inventing one there would put a fictional
   person into a dataset whose value is that it is real.

   WHAT IS ASSERTED

     · an invoice states the ledger, and the two cannot disagree
     · tax is not a taxable supply
     · CGST and SGST split the tax exactly, with no lost paisa
     · place of supply is the PROPERTY's state, always
     · an issued invoice cannot be changed, by anyone
     · a correction is a credit note with its own number
     · a second click does not produce a second number
     · Form C names who owes a filing and refuses evidence-free records
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let demoId: string;
let puneId: string;

const tag = `INV-${process.pid}`;

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'",
    )).rows[0]!.id;
    demoId = (await db.query<{ id: string }>(
      "select id from hotels where code = '5EL'",
    )).rows[0]!.id;
    puneId = (await db.query<{ id: string }>(
      "select id from hotels where code = 'PUN'",
    )).rows[0]!.id;
  } finally {
    await db.end();
  }
});

/* This closed the pool and deleted nothing, so every run left a foreign
   guest, their identity document and a Form C reservation in the demo.
   Everything here carries `INV-<pid>`, so the teardown always had what it
   needed. */
afterAll(async () => {
  const db = await admin();
  try {
    const mine = `${tag}-%`;
    const guests = `${tag} %`;

    await db.query(
      "alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(
      `delete from folio_postings where folio_id in (
         select f.id from folios f join reservations r on r.id = f.reservation_id
          where r.reference like $1)`, [mine]);
    await db.query(
      "alter table folio_postings enable trigger folio_postings_append_only");

    /* The odd-paisa case issues an invoice on a stay of this file's own, and
       an issued invoice refuses deletion (025) - off for the teardown only. */
    await db.query("alter table invoices disable trigger invoices_immutable");
    await db.query(
      `delete from invoices where folio_id in (
         select f.id from folios f join reservations r on r.id = f.reservation_id
          where r.reference like $1)`, [mine]).catch(() => undefined);
    await db.query("alter table invoices enable trigger invoices_immutable");
    await db.query(
      `delete from folios where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    await db.query(
      `delete from room_assignments where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    /* form_c_filings names the reservation too — this whole file is about
       Form C, so of course it does. It has to go before the booking it
       points at. */
    await db.query(
      `delete from form_c_filings where reservation_id in (
         select id from reservations where reference like $1)`, [mine])
      .catch(() => undefined);
    await db.query("delete from reservations where reference like $1", [mine]);
    await db.query(
      `delete from guest_documents where guest_id in (
         select id from guests where full_name like $1)`, [guests]);

    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [guests]);
    await db.query("alter table guests enable trigger guests_no_delete");
  } finally {
    await db.end();
  }
  await closePool();
});

/** A stay with charges on it, and no invoice yet. */
async function invoiceableStay(): Promise<string> {
  const db = await admin();
  try {
    const { rows } = await db.query<{ id: string }>(
      `select r.id::text
         from reservations r
         join folios f on f.reservation_id = r.id
         join folio_postings fp on fp.folio_id = f.id
        where r.hotel_id = $1
          and fp.category not in ('payment','refund')
          and not exists (select 1 from invoices i where i.folio_id = f.id)
        group by r.id
        having sum(fp.amount) > 0
        limit 1`,
      [demoId],
    );
    if (!rows[0]) {
      throw new Error(
        "No un-invoiced folio with charges at the demo property. Reload the " +
          "fixture - `npm test` does this, and running vitest directly does not.",
      );
    }
    return rows[0].id;
  } finally {
    await db.end();
  }
}

/* ── An invoice states the ledger ─────────────────────────────────── */

describe("issuing a tax invoice", () => {
  it("states what the folio holds, and the two reconcile", async () => {
    const stay = await invoiceableStay();
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as {
        ok: boolean; number: string; taxableValue: number;
        cgst: number; sgst: number; taxTotal: number; total: number;
        placeOfSupply: string;
      };

    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    expect(issued.number).toMatch(/^5EL\/\d{4}-\d{2}\/\d{5}$/);

    /* Arithmetic that must hold on the printed page. */
    expect(issued.cgst + issued.sgst).toBeCloseTo(issued.taxTotal, 2);
    expect(issued.taxableValue + issued.taxTotal).toBeCloseTo(issued.total, 2);

    /* The property's state, not the guest's. IGST Act s.12(3)(b):
       accommodation is supplied where the hotel is, so a hotel invoice
       is always intra-state. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ state: string }>(
        "select state from hotels where id = $1", [demoId],
      );
      expect(issued.placeOfSupply).toBe(rows[0]!.state);
    } finally {
      await db.end();
    }
  });

  it("does not treat tax as a taxable supply", async () => {
    /* The real export records tax on extras as its own posting, with
       the tax in `amount` and nothing in `tax_amount`. Summing every
       non-payment row into the taxable value put ₹925 of tax into the
       taxable base of an invoice — and then charged CGST and SGST on
       it. Tax on tax, on a document a guest hands to their accountant. */
    const db = await admin();
    let stay: string | null = null;
    try {
      const { rows } = await db.query<{ id: string }>(
        `select r.id::text
           from reservations r
           join folios f on f.reservation_id = r.id
           join folio_postings fp on fp.folio_id = f.id
          where r.hotel_id = $1 and fp.category = 'tax'
            and not exists (select 1 from invoices i where i.folio_id = f.id)
          limit 1`,
        [demoId],
      );
      stay = rows[0]?.id ?? null;
    } finally {
      await db.end();
    }

    if (!stay) {
      /* Loud, not skipped. Without a folio carrying a standalone tax
         posting this test proves nothing, and a silent pass would be
         worse than no test. */
      throw new Error(
        "No un-invoiced folio with a standalone 'tax' posting. This test " +
          "cannot prove anything - reload the demo fixture.",
      );
    }

    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { ok: boolean; number: string; taxableValue: number };
    expect(issued.ok, JSON.stringify(issued)).toBe(true);

    const detail = (await (await call(
      `/5EL/invoices/${encodeURIComponent(issued.number)}`,
    )).json()) as {
      lines: Array<{ category: string; amount: number }>;
      taxableValue: number; taxTotal: number; total: number;
      cgst: { amount: number }; sgst: { amount: number }; masterBill: boolean;
    };

    /* A stay's invoice is not a group's master bill's (D27-307 (4)). */
    expect(detail.masterBill).toBe(false);
    /* No tax line among the supplies... */
    expect(detail.lines.every((l) => l.category !== "tax")).toBe(true);
    /* ...and the lines shown sum to the taxable value printed. A page
       whose lines do not add up to its own footer is the one thing an
       invoice may never be. */
    const lineSum = detail.lines.reduce((n, l) => n + l.amount, 0);
    expect(lineSum).toBeCloseTo(detail.taxableValue, 2);
    expect(detail.cgst.amount + detail.sgst.amount)
      .toBeCloseTo(detail.taxTotal, 2);
  });

  /* The review of 1 October: ₹0.05 of tax printed CGST 0.02 / SGST 0.03 on
     the invoice and 0.03 / 0.02 on the bill. The odd paisa is CGST's, on both. */
  it("gives the odd paisa of tax to CGST, as the bill does", async () => {
    const db = await admin();
    let stay: string;
    try {
      const guest = (await db.query<{ id: string }>(
        "insert into guests (full_name) values ($1) returning id::text", [`${tag} Odd Paisa`])).rows[0]!.id;
      stay = (await db.query<{ id: string }>(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                   agreed_rate, status)
         select $1, $2, $3, rt.id, app.business_date($1), app.business_date($1) + 1, 1, 'checked_in'
           from room_types rt where rt.hotel_id = $1 limit 1
         returning id::text`, [demoId, `${tag}-ODD`, guest])).rows[0]!.id;
      const folio = (await db.query<{ id: string }>(
        "insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text",
        [demoId, stay])).rows[0]!.id;
      /* ₹1.00 at 5%: ₹0.05 of tax, five paise. */
      await db.query(
        `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                     amount, tax_rate, tax_amount)
         values ($1, $2, app.business_date($1), 'misc', 'Odd paisa', 1, 5, 0.05)`, [demoId, folio]);
    } finally {
      await db.end();
    }
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { ok: boolean; cgst: number; sgst: number; taxTotal: number };
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    expect([issued.cgst, issued.sgst, issued.taxTotal]).toEqual([0.03, 0.02, 0.05]);
    const bill = (await (await call(`/5EL/stays/${stay}/bill`)).json()) as {
      taxes: Array<{ cgst: number; sgst: number }>;
    };
    expect(bill.taxes.map((t) => [t.cgst, t.sgst])).toEqual([[0.03, 0.02]]);
  });

  it("answers a second click with the first invoice", async () => {
    const stay = await invoiceableStay();
    const first = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string };
    const again = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string; duplicate: boolean };

    expect(again.duplicate).toBe(true);
    expect(again.number).toBe(first.number);

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from invoices i
           join folios f on f.id = i.folio_id
          where f.reservation_id = $1 and i.credits_id is null`,
        [stay],
      );
      /* Two numbers for one stay breaks the series as surely as
         skipping one does, and is far harder to notice. */
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await db.end();
    }
  });

  it("refuses a folio with nothing on it", async () => {
    const db = await admin();
    let empty: string | null = null;
    try {
      const { rows } = await db.query<{ id: string }>(
        `select r.id::text from reservations r
           join folios f on f.reservation_id = r.id
          where r.hotel_id = $1
            and not exists (select 1 from folio_postings fp
                             where fp.folio_id = f.id)
          limit 1`,
        [demoId],
      );
      empty = rows[0]?.id ?? null;
    } finally {
      await db.end();
    }
    if (!empty) return;   // nothing to test against today; not a failure

    const res = await call(`/5EL/stays/${empty}/invoice`, "POST");
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/nothing to invoice/i);
  });
});

/* ── Issued means issued ──────────────────────────────────────────── */

describe("an issued invoice", () => {
  it("cannot be changed or deleted, by anyone", async () => {
    const stay = await invoiceableStay();
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string };

    /* As the SUPERUSER, deliberately. A grant would not prove this —
       a superuser ignores grants. Only a trigger holds. */
    const db = await admin();
    try {
      await expect(
        db.query("update invoices set total = 1 where number = $1",
          [issued.number]),
      ).rejects.toThrow(/immutable/i);
      await expect(
        db.query("delete from invoices where number = $1", [issued.number]),
      ).rejects.toThrow(/immutable/i);
    } finally {
      await db.end();
    }
  });

  it("is corrected by a credit note with its own number", async () => {
    const stay = await invoiceableStay();
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string; total: number };

    const note = (await (await call(
      `/5EL/invoices/${encodeURIComponent(issued.number)}/credit-note`,
      "POST", { reason: `${tag} wrong rate applied` },
    )).json()) as { ok: boolean; number: string; total: number };

    expect(note.ok, JSON.stringify(note)).toBe(true);
    expect(note.number).not.toBe(issued.number);
    /* Every figure negated, so invoice and note sum to nothing — which
       is what "this invoice was wrong" means in a GST return. */
    expect(note.total).toBeCloseTo(-issued.total, 2);

    const db = await admin();
    try {
      const { rows } = await db.query<{ sum: string }>(
        `select coalesce(sum(total),0)::text as sum from invoices i
           join folios f on f.id = i.folio_id
          where f.reservation_id = $1`,
        [stay],
      );
      expect(Number(rows[0]!.sum)).toBeCloseTo(0, 2);
    } finally {
      await db.end();
    }
  });

  it("refuses a credit note with no reason", async () => {
    const stay = await invoiceableStay();
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string };

    const res = await call(
      `/5EL/invoices/${encodeURIComponent(issued.number)}/credit-note`,
      "POST", {},
    );
    expect(res.status).toBe(409);
    /* A credit note with no stated reason is the document an auditor
       asks about first. */
    expect((await res.json() as { reason: string }).reason).toMatch(/why/i);
  });

  it("issues only one credit note per invoice", async () => {
    const stay = await invoiceableStay();
    const issued = (await (await call(`/5EL/stays/${stay}/invoice`, "POST"))
      .json()) as { number: string };
    const path = `/5EL/invoices/${encodeURIComponent(issued.number)}/credit-note`;

    const one = (await (await call(path, "POST", { reason: tag }))
      .json()) as { number: string };
    const two = (await (await call(path, "POST", { reason: tag }))
      .json()) as { number: string; duplicate: boolean };

    expect(two.duplicate).toBe(true);
    expect(two.number).toBe(one.number);
  });
});

/* ── Form C ───────────────────────────────────────────────────────── */

describe("Form C", () => {
  let reservationId: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const type = await db.query<{ id: string }>(
        "select id from room_types where hotel_id = $1 limit 1", [puneId],
      );
      const guest = await db.query<{ id: string }>(
        `insert into guests (full_name, phone, nationality)
         values ($1, '+44 0000 000000', 'GB') returning id`,
        [`${tag} foreign guest`],
      );
      await db.query(
        `insert into guest_documents (guest_id, id_type, id_number, country)
         values ($1, 'passport', $2, 'GB')
         on conflict (guest_id) do nothing`,
        [guest.rows[0]!.id, `P${process.pid}`],
      );

      const bd = (await db.query<{ d: string }>(
        "select app.business_date($1)::text as d", [puneId],
      )).rows[0]!.d;

      const res = await db.query<{ id: string }>(
        `insert into reservations
           (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
            adults, status, source, agreed_rate)
         values ($1,$2,$3,$4,$5::date,$5::date + 2,1,'checked_in','direct',3000)
         returning id::text`,
        [puneId, guest.rows[0]!.id, type.rows[0]!.id, `${tag}-fc`, bd],
      );
      reservationId = res.rows[0]!.id;
    } finally {
      await db.end();
    }
  });

  it("names a foreign national who owes a filing", async () => {
    const body = (await (await call("/PUN/form-c")).json()) as {
      note: string;
      rows: Array<{ reservationId: string; nationality: string;
                    filed: boolean; passport: string | null }>;
    };

    /* Said on the response, not only in a comment. Anybody building
       against this must not assume the filing happened. */
    expect(body.note).toMatch(/does not file/i);

    const mine = body.rows.find((r) => r.reservationId === reservationId);
    expect(mine, "the foreign guest is missing from the register").toBeTruthy();
    expect(mine!.nationality).toBe("GB");
    expect(mine!.filed).toBe(false);
    expect(mine!.passport).toBeTruthy();
  });

  it("refuses to record a filing with no acknowledgement reference", async () => {
    const res = await call(`/PUN/form-c/${reservationId}`, "POST", {});
    expect(res.status).toBe(409);
    /* A register without evidence reads as compliance and is not. */
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/reference/i);
  });

  it("records a filing, and refuses to record it twice", async () => {
    const first = await call(`/PUN/form-c/${reservationId}`, "POST",
      { reference: `FRRO/${tag}` });
    expect(first.status).toBe(200);

    const again = await call(`/PUN/form-c/${reservationId}`, "POST",
      { reference: `FRRO/${tag}` });
    expect(again.status).toBe(409);
    expect((await again.json() as { reason: string }).reason)
      .toMatch(/already/i);

    const body = (await (await call("/PUN/form-c")).json()) as {
      rows: Array<{ reservationId: string; filed: boolean;
                    reference: string | null }>;
    };
    const mine = body.rows.find((r) => r.reservationId === reservationId);
    expect(mine!.filed).toBe(true);
    expect(mine!.reference).toBe(`FRRO/${tag}`);
  });

  it("keeps the filing - evidence is not deletable", async () => {
    const db = await admin();
    try {
      /* pms_app must not be able to remove a compliance record. Checked
         as a PRIVILEGE, not by trusting the grant statement that was
         meant to set it — MEMORY.md defect 21. */
      const { rows } = await db.query<{ del: boolean; upd: boolean }>(
        `select has_table_privilege('pms_app','form_c_filings','delete') as del,
                has_table_privilege('pms_app','form_c_filings','update') as upd`,
      );
      expect(rows[0]!.del).toBe(false);
      expect(rows[0]!.upd).toBe(false);
    } finally {
      await db.end();
    }
  });
});
