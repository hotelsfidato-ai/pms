import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";
import {
  countProblem, dateProblem, emailProblem, gstinProblem, phoneProblem, priceProblem,
} from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   CONTRACTS - a company's record, and what it has agreed per hotel
   (D27-178; the owner's answers D27-184, C-1 to C-13)

     company records   the group's companies and agents, each with its
                       contract here today. Added by the owner, an
                       administrator, the GM or reception (C-7: reception
                       without credit); changed by the first three (C-6)
     contracts         one company at one hotel for a period: fixed single
                       and double rates, or a % off the day's price; an
                       agent's commission. Kept by the same three
     contract price    what a party pays for each night under the contract
                       in force on arrival (C-3): the booking page's quote,
                       from app.contract_price, the booking's own function

   Every refusal is asked before the first write (MEMORY 243). The database
   holds the same rules underneath (177): one contract in force per date, no
   price of 0, only the three may change a company or a contract.
   ══════════════════════════════════════════════════════════════════ */

export const contracts = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["corporate", "travel_agent"] as const;
const PLANS_OFFERED = ["EP", "CP", "MAP", "AP"];
const KEEPERS = "the owner, an administrator or the general manager";

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

async function keepsCompanies(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>("select app.keeps_companies() as may");
  return rows[0]?.may === true;
}

/** "1 Apr 2026": QA X-4 asked for no ISO dates in a sentence. */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const figure = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/* ── A company's record ─────────────────────────────────────────── */

export interface CompanyFields {
  name: string; kind: string; gstin: string | null;
  contactName: string | null; phone: string | null; email: string | null;
  addressLine: string | null; city: string | null; state: string | null; pincode: string | null;
  creditAllowed: boolean; creditDays: number | null; creditLimit: number | null;
}

const COMPANY_COLUMNS = `
  co.id::text, co.name, co.kind, co.gstin, co.contact_name as "contactName",
  co.phone, co.email::text as email, co.address_line as "addressLine", co.city,
  co.state, co.pincode, co.credit_allowed as "creditAllowed",
  co.credit_days as "creditDays", co.credit_limit::float8 as "creditLimit"`;
const COMPANY = `select ${COMPANY_COLUMNS} from companies co`;

/** The whole record as it will be saved, or the sentence refusing it. */
function companyProblem(c: CompanyFields): string | null {
  if (!c.name) return "A company has a name.";
  if (c.name.length > 120) return "A company's name is at most 120 characters.";
  if (!(KINDS as readonly string[]).includes(c.kind)) return "A company is a corporate account or a travel agent.";
  const wrong = gstinProblem(c.gstin) ?? phoneProblem(c.phone) ?? emailProblem(c.email);
  if (wrong) return wrong;
  if (c.pincode && !/^[1-9][0-9]{5}$/.test(c.pincode)) return "A PIN code is 6 digits, e.g. 413216.";
  for (const [v, max, what] of [[c.contactName, 120, "contact's name"], [c.addressLine, 200, "address"],
    [c.city, 80, "city"], [c.state, 80, "state"]] as const) {
    if (v && v.length > max) return `The ${what} is at most ${max} characters.`;
  }
  if (c.creditDays !== null) {
    const days = countProblem(c.creditDays, "Credit days", 1, 365);
    if (days) return days;
  }
  if (c.creditLimit !== null) {
    const limit = priceProblem(c.creditLimit, false);
    if (limit || c.creditLimit <= 0) return "A credit limit is an amount above 0, in rupees.";
  }
  return null;
}

function companyFrom(input: Partial<Record<keyof CompanyFields, unknown>>, was?: CompanyFields): CompanyFields {
  const pick = <K extends keyof CompanyFields>(k: K, read: (v: unknown) => CompanyFields[K]) =>
    input[k] === undefined && was ? was[k] : read(input[k]);
  const c: CompanyFields = {
    name: pick("name", (v) => text(v) ?? ""),
    kind: pick("kind", (v) => text(v) ?? "corporate"),
    gstin: pick("gstin", (v) => text(v)?.toUpperCase() ?? null),
    contactName: pick("contactName", text), phone: pick("phone", text), email: pick("email", text),
    addressLine: pick("addressLine", text), city: pick("city", text), state: pick("state", text),
    pincode: pick("pincode", text),
    creditAllowed: pick("creditAllowed", (v) => v === true),
    creditDays: pick("creditDays", figure), creditLimit: pick("creditLimit", figure),
  };
  /* No credit, no terms: days and a limit mean nothing without it. */
  return c.creditAllowed ? c : { ...c, creditDays: null, creditLimit: null };
}

/** C-11: one name, one GSTIN. Asked here and not by an index: an index could
    fail a deploy on rows nobody has looked at - and there are some (the demo
    loaded twice makes two "Agoda"s). So only a name or GSTIN being given is
    asked (null skips it): a duplicate already on file can still be edited,
    to tick its credit (D27-185), without first being renamed. */
async function duplicateOf(client: Client, name: string | null, gstin: string | null, id: string | null) {
  const { rows } = await client.query<{ name: string; same_gstin: boolean }>(
    `select name, ($2::text is not null and upper(gstin) = $2) as same_gstin
       from companies
      where is_active and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')
        and (($1::text is not null and lower(trim(name)) = lower($1))
             or ($2::text is not null and upper(gstin) = $2))
      limit 1`,
    [name, gstin, id]);
  const d = rows[0];
  if (!d) return null;
  return d.same_gstin
    ? `${d.name} already has GSTIN ${gstin}. Edit that company instead.`
    : `${d.name} is already on the list. Edit that company instead.`;
}

const COLUMNS = `name = $2, kind = $3, gstin = $4, contact_name = $5, phone = $6, email = $7,
  address_line = $8, city = $9, state = $10, pincode = $11, credit_allowed = $12,
  credit_days = $13, credit_limit = $14`;
const values = (c: CompanyFields) => [c.name, c.kind, c.gstin, c.contactName, c.phone, c.email,
  c.addressLine, c.city, c.state, c.pincode, c.creditAllowed, c.creditDays, c.creditLimit];

contracts.get("/:code/company-records", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const today = await businessDateFor(client, hotelId);
    /* Each with its contract in force here today, if any. */
    const { rows } = await client.query(
      `select ${COMPANY_COLUMNS}, k.name as "contractName", k.valid_to::text as "contractTo"
         from companies co
         left join contracts k
           on k.company_id = co.id and k.hotel_id = $1 and k.is_active
          and $2::date between k.valid_from and k.valid_to
        where co.is_active
        order by lower(co.name)`,
      [hotelId, today]);
    return rows;
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

contracts.post("/:code/companies", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const company = companyFrom(input);
  const wrong = companyProblem(company);
  if (wrong) return c.json(refuse(wrong), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* C-7: reception adds a company without credit; credit is the three's. */
    if (company.creditAllowed && !(await keepsCompanies(client))) {
      return refuse(`Credit is given by ${KEEPERS}. Add the company without it and ask one of them.`);
    }
    const duplicate = await duplicateOf(client, company.name, company.gstin, null);
    if (duplicate) return refuse(duplicate);
    const { rows } = await client.query<{ id: string }>(
      `insert into companies (name, kind, gstin, contact_name, phone, email, address_line,
                              city, state, pincode, credit_allowed, credit_days, credit_limit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id::text`,
      values(company));
    return { ok: true as const, id: rows[0]!.id, name: company.name };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

contracts.patch("/:code/companies/:id", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const id = c.req.param("id");
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(id)) return null;
    const { rows: was } = await client.query<CompanyFields>(`${COMPANY} where co.id = $1 and co.is_active`, [id]);
    if (!was[0]) return null;
    /* Absent is unchanged; blank clears. The whole record is checked; the
       name and GSTIN for a duplicate only when they change. */
    const company = companyFrom(input, was[0]);
    const renamed = company.name.toLowerCase() !== was[0].name.trim().toLowerCase();
    const regstin = company.gstin !== (was[0].gstin?.toUpperCase() ?? null);
    const wrong = companyProblem(company) ?? await duplicateOf(client,
      renamed ? company.name : null, regstin ? company.gstin : null, id);
    if (wrong) return refuse(wrong);
    await client.query(`update companies set ${COLUMNS} where id = $1`, [id, ...values(company)]);
    return { ok: true as const, id, name: company.name };
  });
  if (!result) return c.json({ error: "No such company." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── A company's contracts at this hotel ────────────────────────── */

contracts.get("/:code/companies/:id/contracts", async (c) => {
  const id = c.req.param("id");
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(id)) return null;
    const { rows: company } = await client.query(`${COMPANY} where co.id = $1`, [id]);
    if (!company[0]) return null;
    const { rows: list } = await client.query(
      `select k.id::text, k.name, k.valid_from::text as "validFrom", k.valid_to::text as "validTo",
              k.pricing, k.discount_percent::float8 as "discountPercent",
              k.commission_pct::float8 as "commissionPct", k.notes,
              coalesce((select json_agg(json_build_object(
                         'roomTypeId', r.room_type_id, 'mealPlan', r.meal_plan,
                         'single', r.price_single::float8, 'double', r.price_double::float8))
                          from contract_rates r where r.contract_id = k.id), '[]') as rates
         from contracts k
        where k.company_id = $1 and k.hotel_id = $2 and k.is_active
        order by k.valid_from desc`,
      [id, hotelId]);
    const { rows: roomTypes } = await client.query(
      `select id::text, name from room_types
        where hotel_id = $1 and is_active order by sort_order, name`, [hotelId]);
    const { rows: mealPlans } = await client.query(
      "select code, includes from meal_plans where code = any($1) order by array_position($1, code)",
      [PLANS_OFFERED]);
    return { company: company[0], contracts: list, roomTypes, mealPlans,
             today: await businessDateFor(client, hotelId) };
  });
  return body ? c.json(body) : c.json({ error: "No such company." }, 404);
});

interface RateInput { roomTypeId?: unknown; mealPlan?: unknown; single?: unknown; double?: unknown }
interface ContractInput {
  companyId?: unknown; name?: unknown; validFrom?: unknown; validTo?: unknown;
  pricing?: unknown; discountPercent?: unknown; commissionPct?: unknown; notes?: unknown;
  rates?: RateInput[];
}

type Contract = {
  name: string; validFrom: string; validTo: string; pricing: "rates" | "discount";
  discountPercent: number | null; commissionPct: number | null; notes: string | null;
  rates: { roomTypeId: string; mealPlan: string; single: number | null; double: number | null }[];
};

/** The contract as it will be saved, or the sentence refusing it. Asked of
    the database for what only it knows: the hotel's room types, the company,
    and any other contract in force over the same dates. */
async function contractFrom(
  client: Client, hotelId: string, companyId: string, contractId: string | null, input: ContractInput,
): Promise<Contract | { reason: string }> {
  const name = text(input.name);
  if (!name) return { reason: "Give the contract a name, e.g. the company and the year." };
  if (name.length > 80) return { reason: "A contract's name is at most 80 characters." };
  const validFrom = text(input.validFrom) ?? "";
  const validTo = text(input.validTo) ?? "";
  const badDate = dateProblem(validFrom) ?? dateProblem(validTo);
  if (badDate) return { reason: `Valid from and to: ${badDate}` };
  if (validTo < validFrom) return { reason: "A contract ends on or after the day it starts." };
  const pricing = input.pricing;
  if (pricing !== "rates" && pricing !== "discount") {
    return { reason: "Choose how the contract prices: fixed rates, or a discount off the day's rate." };
  }
  const notes = text(input.notes);
  if (notes && notes.length > 500) return { reason: "Notes are at most 500 characters." };

  const { rows: co } = await client.query<{ name: string; kind: string }>(
    "select name, kind from companies where id = $1 and is_active", [companyId]);
  if (!co[0]) return { reason: "That company is not on the list any more." };

  const commissionPct = figure(input.commissionPct);
  if (commissionPct !== null) {
    if (co[0].kind !== "travel_agent") {
      return { reason: `Commission is agreed with a travel agent; ${co[0].name} is a corporate account.` };
    }
    if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      return { reason: "Commission is a percentage from 0 to 100." };
    }
  }

  let discountPercent: number | null = null;
  const rates: Contract["rates"] = [];
  if (pricing === "discount") {
    discountPercent = figure(input.discountPercent);
    if (discountPercent === null || !Number.isFinite(discountPercent)
        || discountPercent <= 0 || discountPercent > 100) {
      return { reason: "The discount is a percentage above 0, at most 100." };
    }
  } else {
    const { rows: types } = await client.query<{ id: string }>(
      "select id::text from room_types where hotel_id = $1", [hotelId]);
    const mine = new Set(types.map((t) => t.id));
    const seen = new Set<string>();
    for (const r of input.rates ?? []) {
      const roomTypeId = String(r.roomTypeId ?? "");
      const mealPlan = String(r.mealPlan ?? "");
      if (!mine.has(roomTypeId)) return { reason: "One of those room types is not here." };
      if (!PLANS_OFFERED.includes(mealPlan)) return { reason: `${mealPlan || "That"} is not a meal plan offered.` };
      if (seen.has(`${roomTypeId}|${mealPlan}`)) return { reason: "A room type and meal plan is priced once." };
      seen.add(`${roomTypeId}|${mealPlan}`);
      const single = figure(r.single);
      const double = figure(r.double);
      for (const p of [single, double]) {
        if (p !== null && (priceProblem(p, false) || !(p > 0))) {
          return { reason: "A contract rate is an amount above 0. Leave it blank where none is agreed." };
        }
      }
      if (single !== null || double !== null) rates.push({ roomTypeId, mealPlan, single, double });
    }
    if (rates.length === 0) return { reason: "Type at least one rate, or choose a discount off the day's rate." };
  }

  /* C-3: one contract in force per date. The database's exclusion is the
     guarantee; this is the sentence. */
  const { rows: overlap } = await client.query<{ name: string; valid_from: string; valid_to: string }>(
    `select name, valid_from::text, valid_to::text from contracts
      where hotel_id = $1 and company_id = $2 and is_active
        and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')
        and daterange(valid_from, valid_to, '[]') && daterange($4::date, $5::date, '[]')
      limit 1`,
    [hotelId, companyId, contractId, validFrom, validTo]);
  if (overlap[0]) {
    const o = overlap[0];
    return { reason: `${co[0].name} already has "${o.name}" here from ${day(o.valid_from)} to `
      + `${day(o.valid_to)}. One contract is in force at a time: change its dates first.` };
  }

  return { name, validFrom, validTo, pricing, discountPercent, commissionPct, notes, rates };
}

async function saveRates(client: Client, hotelId: string, contractId: string, k: Contract) {
  await client.query("delete from contract_rates where contract_id = $1", [contractId]);
  for (const r of k.rates) {
    await client.query(
      `insert into contract_rates (hotel_id, contract_id, room_type_id, meal_plan, price_single, price_double)
       values ($1, $2, $3, $4, $5, $6)`,
      [hotelId, contractId, r.roomTypeId, r.mealPlan, r.single, r.double]);
  }
}

contracts.post("/:code/contracts", async (c) => {
  const input = await c.req.json<ContractInput>().catch(() => ({}) as ContractInput);
  const companyId = String(input.companyId ?? "");
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!A_UUID.test(companyId)) return refuse("Which company is the contract with?");
    const k = await contractFrom(client, hotelId, companyId, null, input);
    if ("reason" in k) return refuse(k.reason);
    const { rows } = await client.query<{ id: string }>(
      `insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing,
                              discount_percent, commission_pct, notes, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, app.current_user_id()) returning id::text`,
      [hotelId, companyId, k.name, k.validFrom, k.validTo, k.pricing,
       k.discountPercent, k.commissionPct, k.notes]);
    await saveRates(client, hotelId, rows[0]!.id, k);
    return { ok: true as const, id: rows[0]!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

contracts.put("/:code/contracts/:id", async (c) => {
  const input = await c.req.json<ContractInput>().catch(() => ({}) as ContractInput);
  const id = c.req.param("id");
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId || !A_UUID.test(id)) return null;
    const { rows: was } = await client.query<{ company_id: string }>(
      "select company_id::text from contracts where id = $1 and hotel_id = $2 and is_active",
      [id, hotelId]);
    if (!was[0]) return null;
    const k = await contractFrom(client, hotelId, was[0].company_id, id, input);
    if ("reason" in k) return refuse(k.reason);
    /* Bookings already made keep their stamped rate and commission; this
       changes only what the next booking is priced at. */
    await client.query(
      `update contracts set name = $2, valid_from = $3, valid_to = $4, pricing = $5,
              discount_percent = $6, commission_pct = $7, notes = $8,
              updated_by = app.current_user_id()
        where id = $1`,
      [id, k.name, k.validFrom, k.validTo, k.pricing, k.discountPercent, k.commissionPct, k.notes]);
    await saveRates(client, hotelId, id, k);
    return { ok: true as const, id };
  });
  if (!result) return c.json({ error: "No such contract here." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── What a party pays under the company's contract ─────────────────
   The booking page's quote when a company is named (D27-184): the shape of
   inventory's /tariff (a total per night, NULL with `unpriced` naming what
   is missing), plus the contract's name and, when the contract has no
   figure for this room type and plan, the sentence saying the day's price
   applies (C-4). No contract in force on arrival: the calendar's tariff,
   and `contract` is null. */
contracts.get("/:code/contract-price", async (c) => {
  const q = c.req.query();
  const adults = Number(q["adults"] ?? 1);
  const children = Number(q["children"] ?? 0);
  const wrong = (!q["roomType"] || !q["from"] || !q["to"] ? "Which room type, and for which nights?" : null)
    ?? (!A_UUID.test(q["companyId"] ?? "") ? "Which company?" : null)
    ?? dateProblem(q["from"]) ?? dateProblem(q["to"])
    ?? countProblem(adults, "Adults", 1) ?? countProblem(children, "Children", 0);
  if (wrong) return c.json(refuse(wrong), 409);
  const mealPlan = q["mealPlan"] ?? "EP";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: rt } = await client.query<{ name: string }>(
      "select name from room_types where id = $1 and hotel_id = $2", [q["roomType"], hotelId]);
    if (!rt[0]) return refuse("No such room type here.");
    const { rows: k } = await client.query<{ id: string; name: string }>(
      "select id::text, name from app.contract_in_force($1, $2, $3::date)",
      [q["companyId"], hotelId, q["from"]]);
    const contract = k[0] ?? null;

    const { rows } = await client.query<{
      night: string; total: string | null; unpriced: string | null; from_contract: boolean;
    }>(
      contract
        ? `select d::date::text as night, p.total::text, p.unpriced, p.from_contract
             from generate_series($3::date, $4::date - 1, interval '1 day') d
             cross join lateral app.contract_price($7::uuid, $1, $2, d::date, $5, $6) p`
        : `select d::date::text as night, t.total::text, t.unpriced, false as from_contract
             from generate_series($3::date, $4::date - 1, interval '1 day') d
             cross join lateral app.tariff_for($1, $2, d::date, $5, $6) t`,
      [q["roomType"], mealPlan, q["from"], q["to"], adults, children,
       ...(contract ? [contract.id] : [])]);

    const nights = rows.map((r) => ({
      night: r.night, total: r.total === null ? null : Number(r.total),
      unpriced: r.unpriced, fromContract: r.from_contract,
    }));
    const missing = [...new Set(nights.filter((n) => n.unpriced).map((n) => n.unpriced!))];
    const priced = nights[0]?.fromContract === true;
    return {
      roomType: rt[0].name,
      nights,
      total: missing.length ? null : nights.reduce((sum, n) => sum + (n.total ?? 0), 0),
      unpriced: missing.length ? missing.join(", ") : null,
      contract: contract ? { id: contract.id, name: contract.name } : null,
      note: contract && !priced
        ? `No contract rate for ${rt[0].name} · ${mealPlan}; the day's price.` : null,
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok === false ? 409 : 200);
});
