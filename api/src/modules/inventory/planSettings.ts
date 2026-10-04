import { Hono } from "hono";
import { withSession } from "../../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   RATE PLANS' SETTINGS, AND MEAL PLANS BY DAY (P3; D27-251, D27-258)

     GET  /:code/plan-settings                         each plan's On/Off, place and sources; meal days
     PUT  /:code/plan-settings/order                   { plans: [{ roomTypeId, mealPlan }] } in order
     PUT  /:code/plan-settings/:roomTypeId/:mealPlan   { isActive?, sources? } - sources [] = every source
     PUT  /:code/meal-days/:mealPlan                { breakfast, lunch, dinner } ⊂ arrival/stay/departure

   A rate plan is a room type on a meal plan, and its PRICE is 090/162's
   alone (one price system, D27-251) - nothing here prices anything. Off
   means not offered for new bookings; prices and bookings stay. A plan
   with no sources chosen is sold by every source. No row = On, unsaid.
   ══════════════════════════════════════════════════════════════════ */

export const planSettings = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS = ["arrival", "stay", "departure"];

planSettings.get("/:code/plan-settings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows: h } = await client.query<{ id: string }>(
      "select id from hotels where code = upper($1)", [c.req.param("code")]);
    if (!h[0]) return null;
    const { rows: plans } = await client.query<{
      room_type_id: string; meal_plan: string; is_active: boolean | null; position: number | null; sources: string[];
    }>(
      `select k.room_type_id::text, k.meal_plan, s.is_active, s.position,
              coalesce(array_agg(p.booking_source_id::text) filter (where p.id is not null), '{}') as sources
         from (select room_type_id, meal_plan from rate_plan_settings where hotel_id = $1
               union select room_type_id, meal_plan from rate_plan_sources where hotel_id = $1) k
         left join rate_plan_settings s on s.room_type_id = k.room_type_id and s.meal_plan = k.meal_plan
         left join rate_plan_sources p on p.room_type_id = k.room_type_id and p.meal_plan = k.meal_plan
        group by k.room_type_id, k.meal_plan, s.is_active, s.position`, [h[0].id]);
    const { rows: days } = await client.query<{
      meal_plan: string; breakfast: string[]; lunch: string[]; dinner: string[];
    }>("select meal_plan, breakfast, lunch, dinner from hotel_meal_days where hotel_id = $1", [h[0].id]);
    return {
      plans: plans.map((p) => ({
        roomTypeId: p.room_type_id, mealPlan: p.meal_plan,
        isActive: p.is_active ?? true, position: p.position ?? 0, sources: p.sources,
      })),
      mealDays: days.map((d) => ({ mealPlan: d.meal_plan, breakfast: d.breakfast, lunch: d.lunch, dinner: d.dinner })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

planSettings.put("/:code/plan-settings/order", async (c) => {
  const input = await c.req.json<{ plans?: unknown }>().catch(() => ({}) as { plans?: unknown });
  const plans = Array.isArray(input.plans) ? input.plans as { roomTypeId?: unknown; mealPlan?: unknown }[] : [];
  if (plans.length === 0 || plans.length > 500
      || !plans.every((p) => typeof p.roomTypeId === "string" && A_UUID.test(p.roomTypeId)
                            && typeof p.mealPlan === "string" && /^[A-Z]{2,4}$/.test(p.mealPlan))) {
    return c.json(refuse("Send the plans in their new order."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const { rows: h } = await client.query<{ id: string }>(
      "select id from hotels where code = upper($1)", [c.req.param("code")]);
    if (!h[0]) return null;
    await client.query(
      `insert into rate_plan_settings (hotel_id, room_type_id, meal_plan, position)
       select $1, rt.id, o.plan, o.n
         from unnest($2::uuid[], $3::text[]) with ordinality o(type_id, plan, n)
         join room_types rt on rt.id = o.type_id and rt.hotel_id = $1
       on conflict (room_type_id, meal_plan) do update set position = excluded.position`,
      [h[0].id, plans.map((p) => p.roomTypeId), plans.map((p) => p.mealPlan)]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

planSettings.put("/:code/plan-settings/:roomTypeId/:mealPlan", async (c) => {
  const input = await c.req.json<{ isActive?: unknown; sources?: unknown }>()
    .catch(() => ({}) as { isActive?: unknown; sources?: unknown });
  const typeId = c.req.param("roomTypeId");
  const plan = c.req.param("mealPlan").toUpperCase();
  const sources = input.sources === undefined ? undefined
    : Array.isArray(input.sources) && input.sources.every((s) => typeof s === "string" && A_UUID.test(s))
      ? input.sources as string[] : null;
  if (!A_UUID.test(typeId) || sources === null
      || (input.isActive !== undefined && typeof input.isActive !== "boolean")) {
    return c.json(refuse("Say whether the plan is offered, and which sources sell it."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const { rows: h } = await client.query<{ id: string }>(
      "select id from hotels where code = upper($1)", [c.req.param("code")]);
    if (!h[0]) return null;
    const { rows: ok } = await client.query<{ type: boolean; plan: boolean }>(
      `select exists (select 1 from room_types where id = $1 and hotel_id = $3) as type,
              exists (select 1 from meal_plans where code = $2) as plan`, [typeId, plan, h[0].id]);
    if (!ok[0]!.type || !ok[0]!.plan) return refuse("That room type or meal plan is not at this property.");
    if (typeof input.isActive === "boolean") {
      await client.query(
        `insert into rate_plan_settings (hotel_id, room_type_id, meal_plan, is_active)
         values ($1, $2, $3, $4)
         on conflict (room_type_id, meal_plan) do update set is_active = excluded.is_active`,
        [h[0].id, typeId, plan, input.isActive]);
    }
    if (sources) {
      await client.query("delete from rate_plan_sources where room_type_id = $1 and meal_plan = $2", [typeId, plan]);
      if (sources.length > 0) {
        await client.query(
          `insert into rate_plan_sources (hotel_id, room_type_id, meal_plan, booking_source_id)
           select $1, $2, $3, b.id from booking_sources b where b.id = any($4::uuid[])`,
          [h[0].id, typeId, plan, sources]);
      }
    }
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

planSettings.put("/:code/meal-days/:mealPlan", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const pick = (k: string) => Array.isArray(input[k]) && (input[k] as unknown[]).every((d) => DAYS.includes(d as string))
    ? [...new Set(input[k] as string[])] : null;
  const [breakfast, lunch, dinner] = [pick("breakfast"), pick("lunch"), pick("dinner")];
  if (!breakfast || !lunch || !dinner) {
    return c.json(refuse("For each meal, the days it is served: arrival, stay or departure."), 409);
  }
  const plan = c.req.param("mealPlan").toUpperCase();
  const result = await withSession(c.get("subject"), async (client) => {
    const { rows: h } = await client.query<{ id: string }>(
      "select id from hotels where code = upper($1)", [c.req.param("code")]);
    if (!h[0]) return null;
    const { rows: known } = await client.query("select 1 from meal_plans where code = $1", [plan]);
    if (!known[0]) return refuse("There is no such meal plan.");
    await client.query(
      `insert into hotel_meal_days (hotel_id, meal_plan, breakfast, lunch, dinner)
       values ($1, $2, $3, $4, $5)
       on conflict (hotel_id, meal_plan) do update
         set breakfast = excluded.breakfast, lunch = excluded.lunch, dinner = excluded.dinner`,
      [h[0].id, plan, breakfast, lunch, dinner]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
