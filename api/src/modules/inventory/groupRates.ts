import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { WRITE_RULES, allows, refusalFor } from "../../roleGate.ts";
import type { Role } from "../../permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE PRICE CHANGE ACROSS PROPERTIES (D27-383 item 6)

   GET  /api/group/rate-change   what would change: each property's old and
                                 new base price, run by run, or why it is
                                 skipped. Writes nothing.
   POST /api/group/rate-change   the same question, saved: every property in
                                 one transaction, all or none.

   A PERSON'S CHANGE, WHERE THEY CHOSE (the owner's rule: the system never
   changes a price by itself). The room type is matched BY ITS NAME at each
   property - the same words, capitals and spaces aside - and shown before
   saving; a property without it, with two of that name, or where it is
   another type plus a difference, is listed and skipped, never guessed.

   Each property's write is the Rates screen's own: app.set_base_price, the
   base (one guest, the base plan) over the days, recorded with who set it
   (rates.created_by), exactly as a tapped price there is. The Rates screen's
   rule for which types take a typed base is kept: with a base room type
   chosen, a type with a difference follows it and is not typed.

   WHO: at every property named, the role must pass PUT pricing/base's rule
   (roleGate PRICE). One that does not, one the person does not work at, or
   a test hotel, and nothing is shown or saved: the refusal names it.

   The save is checked against what was shown: if any old or new price,
   match or skip differs from the preview the person saw, nothing is saved.
   ══════════════════════════════════════════════════════════════════ */

export const groupRates = new Hono<{ Variables: { subject: string } }>();

const PRICE_RULE = WRITE_RULES["PUT /api/hotels/:code/pricing/base"]!;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9]{2,10}$/;
const LONGEST = 366;

export type ChangeKind = "set" | "by" | "percent";

export interface Run { from: string; through: string; old: number | null; new: number | null }
export interface Plan {
  code: string; name: string;
  roomType: { id: string; name: string; code: string } | null;
  /** Why nothing is changed here; null when the runs are saved. */
  skipped: string | null;
  runs: Run[];
}

interface Ask {
  hotels: string[]; roomType: string; from: string; through: string;
  kind: ChangeKind | null; value: number;
}

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const days = (list: string[]) =>
  list.length <= 3 ? list.map(day).join(", ") : `${list.slice(0, 3).map(day).join(", ")} and ${list.length - 3} more`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const plusDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** What is wrong with the question, in a sentence, or null. */
function problem(a: Ask): string | null {
  if (a.hotels.length === 0) return "Choose at least one property.";
  if (a.hotels.some((c) => !CODE.test(c))) return "A property is named by its code, such as 5EL.";
  if (!ISO.test(a.from) || !ISO.test(a.through)) return "The dates must be written YYYY-MM-DD.";
  if (a.through < a.from) return "The last day must be on or after the first.";
  if ((Date.parse(a.through) - Date.parse(a.from)) / 86_400_000 >= LONGEST) return `At most ${LONGEST} days at a time.`;
  if (!a.kind) return "Say the change: a new price, or plus or minus an amount or a percent.";
  if (!Number.isFinite(a.value)) return "The change is a number.";
  if (a.kind === "set" && a.value <= 0) {
    return "A new price is more than 0. A free room is set on the property's own Rates, ticked Free.";
  }
  if (a.kind !== "set" && a.value === 0) return "A change of 0 changes nothing.";
  if (a.kind === "percent" && (a.value <= -100 || a.value > 1000)) return "A percent change is between -99 and 1000.";
  return null;
}

const newPrice = (a: Ask, old: number | null): number | null =>
  a.kind === "set" ? round2(a.value)
    : old === null ? null
    : a.kind === "by" ? round2(old + a.value)
    /* A percent rounds to the whole rupee, as the base's differences are (D27-188). */
    : Math.round(old * (1 + a.value / 100));

/** The properties, each with the person's role there; a refusal in a sentence. */
async function properties(client: Client, staffId: string, groupAdmin: boolean, codes: string[]) {
  const { rows } = await client.query<{ id: string; code: string; name: string; role: string | null; test: boolean }>(
    `select h.id::text, h.code, h.name, case when $2 then 'owner' else sh.role end as role,
            h.test_of is not null as test
       from hotels h
       left join staff_hotels sh on sh.hotel_id = h.id and sh.staff_id = $1
      where h.code = any($3) and h.is_active`,
    [staffId, groupAdmin, codes]);
  const found = new Map(rows.map((r) => [r.code, r]));
  const list: { id: string; code: string; name: string }[] = [];
  for (const code of codes) {
    const h = found.get(code);
    /* The same words for a property that does not exist: a refusal never says which do. */
    if (!h || h.role === null) return { refused: `${code} is not a property you work at, so nothing is shown or changed there.` };
    if (h.test) return { refused: `${h.name} is a test hotel: a change across properties is for real hotels only.` };
    if (!allows(PRICE_RULE, h.role as Role)) return { refused: `At ${h.name}: ${refusalFor(PRICE_RULE)}` };
    list.push({ id: h.id, code: h.code, name: h.name });
  }
  return { list };
}

/** Every room type name at these properties, and where each is (the picker's list). */
async function roomTypeNames(client: Client, hotelIds: string[]) {
  const { rows } = await client.query<{ code: string; name: string }>(
    `select h.code, btrim(rt.name) as name from room_types rt join hotels h on h.id = rt.hotel_id
      where rt.hotel_id = any($1::uuid[]) and rt.is_active
      order by rt.sort_order, rt.name, h.code`,
    [hotelIds]);
  const names = new Map<string, { name: string; at: string[] }>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const n = names.get(key) ?? names.set(key, { name: r.name, at: [] }).get(key)!;
    if (!n.at.includes(r.code)) n.at.push(r.code);
  }
  return [...names.values()];
}

/** One property's plan: the room type by name, its base each day, the new figure. */
async function planFor(client: Client, h: { id: string; code: string; name: string }, a: Ask): Promise<Plan> {
  const plan: Plan = { code: h.code, name: h.name, roomType: null, skipped: null, runs: [] };
  const { rows: types } = await client.query<{ id: string; name: string; code: string }>(
    `select id::text, name, code from room_types
      where hotel_id = $1 and is_active and lower(btrim(name)) = lower(btrim($2))`,
    [h.id, a.roomType]);
  if (types.length === 0) return { ...plan, skipped: `No room type called ${a.roomType} here: skipped.` };
  if (types.length > 1) {
    return { ...plan, skipped: `${types.length} room types here are called ${a.roomType}: change it on this property's own Rates.` };
  }
  const type = types[0]!;
  plan.roomType = type;

  /* The Rates screen's rule (Rates.tsx `offered`): with a base room type
     chosen, a type with a difference from it is not typed - it follows. */
  const { rows: basis } = await client.query<{ basis: string | null; basis_name: string | null; plan: string; differs: boolean }>(
    `select b.room_type_id::text as basis, bt.name as basis_name, coalesce(b.meal_plan, 'EP') as plan,
            exists (select 1 from rate_offsets o
                     where o.hotel_id = $1 and o.kind = 'room_type' and o.room_type_id = $2::uuid
                       and o.valid_from <= $4::date and (o.valid_to is null or o.valid_to > $3::date)) as differs
       from (select 1) one
       left join pricing_basis b on b.hotel_id = $1
       left join room_types bt on bt.id = b.room_type_id`,
    [h.id, type.id, a.from, a.through]);
  const b = basis[0]!;
  if (b.basis && b.basis !== type.id && b.differs) {
    return { ...plan, skipped: `${type.name} here is ${b.basis_name} plus a difference: change ${b.basis_name}'s price, or the difference, on this property's own Rates.` };
  }

  /* The base each day, as a booking would be quoted it (app.price_for). */
  const { rows: prices } = await client.query<{ day: string; price: string | null }>(
    `select d::date::text as day, f.price::text
       from generate_series($2::date, $3::date, interval '1 day') d
       cross join lateral app.price_for($1::uuid, $4, d::date) f
      order by d`,
    [type.id, a.from, a.through, b.plan]);
  const each = prices.map((p) => {
    const old = p.price === null ? null : Number(p.price);
    return { day: p.day, old, new: newPrice(a, old) };
  });

  const unpriced = each.filter((e) => e.new === null).map((e) => e.day);
  if (unpriced.length) {
    return { ...plan, skipped: `No price on ${days(unpriced)} to change: set a new price instead, or price those days on this property's own Rates.` };
  }
  const nothing = each.filter((e) => e.new! <= 0).map((e) => e.day);
  if (nothing.length) return { ...plan, skipped: `The new price would be 0 or less on ${days(nothing)}: skipped.` };

  for (const e of each) {
    const last = plan.runs[plan.runs.length - 1];
    if (last && last.old === e.old && last.new === e.new && plusDay(last.through) === e.day) last.through = e.day;
    else plan.runs.push({ from: e.day, through: e.day, old: e.old, new: e.new });
  }
  if (plan.runs.every((r) => r.old === r.new)) return { ...plan, skipped: "Already at these prices: nothing to change." };
  return plan;
}

const fingerprint = (plans: Plan[]) =>
  JSON.stringify(plans.map((p) => [p.code, p.roomType?.id ?? null, p.skipped, p.runs.map((r) => [r.from, r.through, r.old, r.new])]));

/** A write that failed at one property: named, so the refusal says where. */
class Failed extends Error {
  /* Longhand: the server strips types and cannot run a parameter property. */
  readonly at: string;
  readonly reason: string;
  constructor(at: string, reason: string) { super(reason); this.at = at; this.reason = reason; }
}

function askFrom(input: Record<string, unknown>): Ask {
  const hotels = Array.isArray(input["hotels"]) ? input["hotels"] : String(input["hotels"] ?? "").split(",");
  const kind = input["kind"];
  return {
    hotels: [...new Set(hotels.map((c) => String(c).trim().toUpperCase()).filter(Boolean))],
    roomType: String(input["roomType"] ?? "").trim(),
    from: String(input["from"] ?? ""),
    through: String(input["through"] ?? ""),
    kind: kind === "set" || kind === "by" || kind === "percent" ? kind : null,
    value: Number(input["value"]),
  };
}

groupRates.get("/group/rate-change", async (c) => {
  const a = askFrom(c.req.query());
  if (a.hotels.length === 0) return c.json({ ok: false, reason: "Choose at least one property." }, 400);
  if (a.hotels.some((x) => !CODE.test(x))) return c.json({ ok: false, reason: "A property is named by its code, such as 5EL." }, 400);
  const out = await withSession(c.get("subject"), async (client, session) => {
    const p = await properties(client, session.staffId, session.isGroupAdmin, a.hotels);
    if (!p.list) return { refused: p.refused };
    const roomTypes = await roomTypeNames(client, p.list.map((h) => h.id));
    /* The names alone until the question is whole: the picker's list. */
    if (!a.roomType || problem(a)) return { roomTypes, problem: a.roomType ? problem(a) : null };
    const plans: Plan[] = [];
    for (const h of p.list) plans.push(await planFor(client, h, a));
    return { roomTypes, hotels: plans };
  });
  if ("refused" in out) return c.json({ ok: false, reason: out.refused }, 403);
  return c.json(out);
});

groupRates.post("/group/rate-change", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const a = askFrom(body);
  const wrong = problem(a) ?? (a.roomType ? null : "Which room type?");
  if (wrong) return c.json({ ok: false, reason: wrong }, 400);
  const seen = Array.isArray(body["seen"]) ? (body["seen"] as Plan[]) : null;
  if (!seen) return c.json({ ok: false, reason: "Look at the prices first: nothing is saved before they are shown." }, 400);

  try {
    const out = await withSession(c.get("subject"), async (client, session) => {
      const p = await properties(client, session.staffId, session.isGroupAdmin, a.hotels);
      if (!p.list) return { status: 403 as const, reason: p.refused };
      const plans: Plan[] = [];
      for (const h of p.list) plans.push(await planFor(client, h, a));
      if (fingerprint(plans) !== fingerprint(seen)) {
        return { status: 409 as const, reason: "A price changed since you looked. Nothing was saved: look at the new prices and save again." };
      }
      /* Every property in this one transaction: a write that fails throws,
         and the rollback takes every property's back with it. */
      for (const plan of plans) {
        if (plan.skipped || !plan.roomType) continue;
        const hotel = p.list.find((h) => h.code === plan.code)!;
        for (const r of plan.runs) {
          if (r.old === r.new) continue;
          try {
            await client.query(
              "select app.set_base_price($1, $2, $3::date, $4::date, $5, null, $6)",
              [hotel.id, plan.roomType.id, r.from, plusDay(r.through), r.new, session.staffId]);
          } catch (error) {
            throw new Failed(plan.name, error instanceof Error ? error.message : String(error));
          }
        }
      }
      return {
        status: 200 as const,
        saved: plans.filter((x) => !x.skipped).map((x) => ({ code: x.code, name: x.name })),
        skipped: plans.filter((x) => x.skipped).map((x) => ({ code: x.code, name: x.name, reason: x.skipped })),
      };
    });
    if (out.status !== 200) return c.json({ ok: false, reason: out.reason }, out.status);
    return c.json({ ok: true, saved: out.saved, skipped: out.skipped });
  } catch (error) {
    if (!(error instanceof Failed)) throw error;
    return c.json({ ok: false, reason: `Nothing was saved, at any property. At ${error.at}: ${error.reason}` }, 409);
  }
});
