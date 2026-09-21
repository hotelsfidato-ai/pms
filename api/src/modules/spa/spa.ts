import { Hono } from "hono";
import type { Context, Next } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import { postCharge } from "../finance/index.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   THE SPA

   The owner's D17-54 and D18-6, behind the switch migration 115 made.
   Treatments, a day diary, and a bill settled at the spa or put on the
   room.

   THE GUARD THAT MATTERS is that one therapist is not in two places at
   once, and it lives in `app.book_spa_appointment`, not here — the same
   reason 060 gives for the hall: the screen is not the only caller. The
   guest's own page books a treatment too (D18-6), and two callers doing
   this arithmetic twice is how two systems come to disagree about who is
   busy. The refusal NAMES the appointment standing in the way.

   AND NOTHING HERE WRITES A PRICE NOBODY TYPED. A treatment with no price
   is UNPRICED — a dash on the screen, never a zero — and an unpriced
   appointment cannot be closed, because closing it is the moment money is
   taken or put on a bill.

   A TIME BELONGS TO THE PROPERTY (113, root MEMORY 297). Every time in
   and out of here goes through `app.hotel_moment` and `app.hotel_clock`.
   Nothing in this file builds a timestamp itself.
   ══════════════════════════════════════════════════════════════════ */

export const spa = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}


/* ══════════════════════════════════════════════════════════════════
   WHO MAY DO WHAT — on the server

   THE OWNER'S ANSWER, 18 September, asked because D18-8 says "reception
   and housekeeping" for laundry and spa together while the spa brief says
   reception: **reception books and closes; housekeeping sees the diary
   and cannot touch it.** No new role, and nothing added to the shared
   permissions matrix.

   ⚠ A COPY of the rule the menu applies in `src/modules/spa/nav.ts`. The
   server does not import the website's code, so the two are held together
   by `api/test/modules/spa/spa.test.ts`, which fails the moment they
   differ. A hidden screen is still a URL anybody can type (MEMORY 250,
   263) — hiding the diary from a chef is tidiness; refusing the POST is
   the enforcement.

   The role is read the way the website reads it: a group administrator
   counts as the owner everywhere, and anybody else holds the role their
   `staff_hotels` row gives them AT THIS HOTEL and no other. The predicate
   is a copy of admin's `holdsRoleHere`, which its front door does not
   export — the same way admin's own file copies the front desk's
   `hotelIdFor`.
   ══════════════════════════════════════════════════════════════════ */

/** Sees the diary. Housekeeping looks and does not touch (the owner, 18 Sep). */
export const SPA_READ_ROLES: readonly string[] =
  ["owner", "admin", "gm", "hotel_manager", "front_desk", "housekeeping"];

/** Takes and closes a booking. Reception's job, and the floor above it. */
export const SPA_BOOK_ROLES: readonly string[] =
  ["owner", "admin", "gm", "hotel_manager", "front_desk"];

/** Sets the price list and the therapists. Who sets prices, INV-5. */
export const SPA_LIST_ROLES: readonly string[] = ["owner", "admin", "gm"];

/* Rule 6: say who CAN, so the person knows whom to ask. */
const READ_REFUSED =
  "The spa diary is open to reception, housekeeping, the manager, an "
  + "administrator and the owner. Ask one of them.";
const BOOK_REFUSED =
  "Taking a spa booking is for reception, the manager, an administrator or "
  + "the owner. Ask one of them.";
const LIST_REFUSED =
  "The treatment list is set by the owner, an administrator or the general "
  + "manager. Ask one of them.";

/* ⚠ 403 IS "YOU MAY NOT", 409 IS "THAT CANNOT BE DONE", and the two are not
   interchangeable. The first version of this file answered 409 when
   housekeeping tried to book, because the role refusal and the clash refusal
   were the same shape on the way out — so a screen could not tell "ask your
   manager" from "that hour is taken", and neither could anybody reading a log.
   Its own test caught it. `forbidden` keeps them apart all the way to the
   status line. */
const forbidden = (reason: string) => ({ forbidden: true as const, reason });
type Refusal = { ok: false; reason: string } | { forbidden: true; reason: string };
const statusFor = (r: Refusal | { ok: true }) =>
  ("forbidden" in r ? 403 : "ok" in r && r.ok ? 200 : 409) as 200 | 403 | 409;

async function holdsRoleHere(
  client: Client, hotelId: string, roles: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select ('owner' = any($2::text[]) and exists (
              select 1 from staff s
               where s.id = app.current_user_id() and s.is_active and s.is_group_admin
            ))
         or exists (
              select 1 from staff_hotels sh
                join staff s on s.id = sh.staff_id
               where sh.staff_id = app.current_user_id()
                 and sh.hotel_id = $1
                 and s.is_active
                 and sh.role = any($2::text[])
            ) as may`,
    [hotelId, roles],
  );
  return rows[0]?.may === true;
}


/* ── The module gate ──────────────────────────────────────────────
   HIDING A SCREEN IS NOT DISABLING IT — 041's own words, and the same
   shape banquet uses. The navigation stops showing the spa where the
   switch is off and these routes refuse it, independently, because a
   hidden entry is still a URL anybody can type. */
async function moduleGate(
  c: Context<{ Variables: { subject: string } }>,
  next: Next,
) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);

  const allowed = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{ enabled: boolean }>(
      `select app.module_enabled($1, 'spa') as enabled`, [hotelId]);
    return rows[0]!.enabled;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "This property has no spa. Turn it on in the property's settings if "
      + "that is wrong."), 403);
  }
  await next();
}

spa.use("/:code/spa", moduleGate);
spa.use("/:code/spa/*", moduleGate);


/* ══════════════════════════════════════════════════════════════════
   THE PRICE LIST
   ══════════════════════════════════════════════════════════════════ */

/* ── What this property sells ─────────────────────────────────────
   Retired treatments come too, marked, because the list is also the
   screen somebody puts one back from. */
spa.get("/:code/spa/treatments", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_READ_ROLES))) {
      return "refused" as const;
    }

    const { rows } = await client.query<{
      id: string; name: string; minutes: number;
      price: string | null; is_active: boolean; notes: string | null;
    }>(
      `select id::text, name, minutes, price::text, is_active, notes
         from spa_treatments
        where hotel_id = $1
        order by sort_order, name`,
      [hotelId],
    );

    return {
      treatments: rows.map((r) => ({
        id: r.id, name: r.name, minutes: r.minutes,
        /* NULL STAYS NULL ALL THE WAY TO THE SCREEN. Coercing it to 0
           here would turn "nobody has priced this" into "this is free"
           three layers away from anyone who could notice — 060's words,
           and the reason they are repeated is that it keeps happening. */
        price: r.price === null ? null : Number(r.price),
        isActive: r.is_active, notes: r.notes,
      })),
    };
  });

  if (body === null) return c.json({ error: "No such property." }, 404);
  if (body === "refused") return c.json(forbidden(READ_REFUSED), 403);
  return c.json(body);
});

/* ── Adding one ───────────────────────────────────────────────────
   NO PRICE IS REQUIRED and none is invented. A treatment entered
   without one is unpriced until somebody types a figure. */
spa.post("/:code/spa/treatments", async (c) => {
  const input = await c.req.json<{
    name?: string; minutes?: number; price?: number | null; notes?: string;
  }>().catch(() => ({}) as { name?: string; minutes?: number; price?: number | null; notes?: string; });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* ASKED BEFORE THE WRITE. A refusal below an insert keeps the insert
       (root MEMORY 243). */
    if (!(await holdsRoleHere(client, hotelId, SPA_LIST_ROLES))) {
      return forbidden(LIST_REFUSED);
    }

    const name = input.name?.trim();
    if (!name) return refuse("A treatment needs a name.");
    if (!input.minutes || input.minutes <= 0) {
      return refuse("How long does it take? The diary places a booking by "
        + "its length.");
    }
    if (input.price !== undefined && input.price !== null && input.price < 0) {
      return refuse("A price cannot be less than nothing.");
    }

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into spa_treatments (hotel_id, name, minutes, price, notes)
         values ($1, $2, $3, $4, $5) returning id::text`,
        [hotelId, name, input.minutes, input.price ?? null,
         input.notes?.trim() || null],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string } | undefined;
      if (e?.code === "23505") {
        return refuse(`This property already sells a "${name}".`);
      }
      throw error;
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result, statusFor(result));
});

/* ── Changing one, and taking it off the list ─────────────────────
   NOTHING IS DELETED. A treatment leaves by going inactive, so a
   booking that already happened still names what it was. */
spa.patch("/:code/spa/treatments/:id", async (c) => {
  const input = await c.req.json<{
    name?: string; minutes?: number; price?: number | null;
    isActive?: boolean; notes?: string | null;
  }>().catch(() => ({}) as { name?: string; minutes?: number; price?: number | null; isActive?: boolean; notes?: string | null; });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_LIST_ROLES))) {
      return forbidden(LIST_REFUSED);
    }
    if (input.price !== undefined && input.price !== null && input.price < 0) {
      return refuse("A price cannot be less than nothing.");
    }
    if (input.minutes !== undefined && (!input.minutes || input.minutes <= 0)) {
      return refuse("How long does it take? The diary places a booking by "
        + "its length.");
    }

    /* `coalesce($n, column)` would make it impossible to UNPRICE something
       — null would read as "leave it alone". The key being PRESENT is the
       instruction, so each field says whether it was sent. */
    const { rows } = await client.query<{ id: string }>(
      `update spa_treatments
          set name      = case when $3::boolean then $4::text    else name      end,
              minutes   = case when $5::boolean then $6::int     else minutes   end,
              price     = case when $7::boolean then $8::numeric else price     end,
              is_active = case when $9::boolean then $10::boolean else is_active end,
              notes     = case when $11::boolean then $12::text  else notes     end
        where id = $1 and hotel_id = $2
        returning id::text`,
      [c.req.param("id"), hotelId,
       input.name !== undefined, input.name?.trim() ?? null,
       input.minutes !== undefined, input.minutes ?? null,
       "price" in input, input.price ?? null,
       input.isActive !== undefined, input.isActive ?? null,
       "notes" in input, input.notes?.trim() || null],
    );
    if (!rows[0]) return "missing" as const;
    return { ok: true as const, id: rows[0].id };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such treatment." }, 404);
  return c.json(result, statusFor(result));
});


/* ══════════════════════════════════════════════════════════════════
   THE THERAPISTS

   A NAME, NOT AN ACCOUNT (D18-8: no therapist logins, no new roles).
   A list rather than a text box, because the whole guard is "this
   person is already busy" and that cannot be asked of a string
   somebody typed two ways.
   ══════════════════════════════════════════════════════════════════ */

spa.get("/:code/spa/therapists", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_READ_ROLES))) {
      return "refused" as const;
    }
    const { rows } = await client.query<{
      id: string; name: string; is_active: boolean;
    }>(
      `select id::text, name, is_active from spa_therapists
        where hotel_id = $1 order by sort_order, name`,
      [hotelId],
    );
    return {
      therapists: rows.map((r) => ({
        id: r.id, name: r.name, isActive: r.is_active,
      })),
    };
  });

  if (body === null) return c.json({ error: "No such property." }, 404);
  if (body === "refused") return c.json(forbidden(READ_REFUSED), 403);
  return c.json(body);
});

spa.post("/:code/spa/therapists", async (c) => {
  const input = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_LIST_ROLES))) {
      return forbidden(LIST_REFUSED);
    }
    const name = input.name?.trim();
    if (!name) return refuse("A therapist needs a name.");

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into spa_therapists (hotel_id, name) values ($1, $2)
         returning id::text`,
        [hotelId, name],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string } | undefined;
      if (e?.code === "23505") {
        return refuse(`${name} is already on this property's list.`);
      }
      throw error;
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result, statusFor(result));
});

/* Somebody leaves; their past appointments stay exactly as they were. */
spa.patch("/:code/spa/therapists/:id", async (c) => {
  const input = await c.req.json<{ name?: string; isActive?: boolean }>()
    .catch(() => ({}) as { name?: string; isActive?: boolean });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_LIST_ROLES))) {
      return forbidden(LIST_REFUSED);
    }
    const { rows } = await client.query<{ id: string }>(
      `update spa_therapists
          set name      = case when $3::boolean then $4::text    else name      end,
              is_active = case when $5::boolean then $6::boolean else is_active end
        where id = $1 and hotel_id = $2
        returning id::text`,
      [c.req.param("id"), hotelId,
       input.name !== undefined, input.name?.trim() ?? null,
       input.isActive !== undefined, input.isActive ?? null],
    );
    if (!rows[0]) return "missing" as const;
    return { ok: true as const, id: rows[0].id };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such therapist." }, 404);
  return c.json(result, statusFor(result));
});


/* ══════════════════════════════════════════════════════════════════
   THE DAY DIARY
   ══════════════════════════════════════════════════════════════════ */

/* Every active therapist over a window, with whatever is in it. A
   therapist with nothing booked comes back with an empty list, because
   "who is free" is the question somebody is actually asking. */
spa.get("/:code/spa", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_READ_ROLES))) {
      return "refused" as const;
    }

    /* The property's own day, not the server's — the diary opens on the
       business date and nothing here reads `new Date()` for it. */
    const businessDate = await businessDateFor(client, hotelId);
    const from = c.req.query("from") ?? businessDate;
    const to = c.req.query("to") ?? from;

    const { rows } = await client.query<{
      therapist_id: string; therapist_name: string;
      appointment_id: string | null; status: string | null;
      starts_at: string | null; ends_at: string | null;
      treatment: string | null; minutes: number | null;
      guest_name: string | null; room_number: string | null;
      agreed_amount: string | null; settlement: string | null;
    }>(
      `select therapist_id::text, therapist_name, appointment_id::text, status,
              app.hotel_clock($1, starts_at) as starts_at,
              app.hotel_clock($1, ends_at)   as ends_at,
              treatment, minutes, guest_name, room_number,
              agreed_amount::text, settlement
         from app.spa_diary($1, $2::date, $3::date)`,
      [hotelId, from, to],
    );

    const therapists = new Map<string, {
      id: string; name: string;
      appointments: Array<Record<string, unknown>>;
    }>();

    for (const r of rows) {
      if (!therapists.has(r.therapist_id)) {
        therapists.set(r.therapist_id,
          { id: r.therapist_id, name: r.therapist_name, appointments: [] });
      }
      if (!r.appointment_id) continue;   // an empty day, deliberately kept
      therapists.get(r.therapist_id)!.appointments.push({
        id: r.appointment_id,
        status: r.status,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        treatment: r.treatment,
        minutes: r.minutes,
        guestName: r.guest_name,
        room: r.room_number,
        amount: r.agreed_amount === null ? null : Number(r.agreed_amount),
        settlement: r.settlement,
      });
    }

    return { businessDate, from, to, therapists: [...therapists.values()] };
  });

  if (body === null) return c.json({ error: "No such property." }, 404);
  if (body === "refused") return c.json(forbidden(READ_REFUSED), 403);
  return c.json(body);
});

/* ── Taking a booking ─────────────────────────────────────────────
   The desk, from a telephone call (D18-6). The guard is in the
   database; this route carries the sentence it wrote. */
spa.post("/:code/spa/appointments", async (c) => {
  const input = await c.req.json<{
    stayId?: string; treatmentId?: string; therapistId?: string;
    startsAt?: string;
  }>().catch(() => ({}) as { stayId?: string; treatmentId?: string; therapistId?: string; startsAt?: string; });

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_BOOK_ROLES))) {
      return forbidden(BOOK_REFUSED);
    }

    if (!input.stayId) return refuse("Which guest is this for?");
    if (!input.treatmentId) return refuse("Which treatment?");
    if (!input.therapistId) return refuse("Which therapist?");
    if (!input.startsAt) return refuse("What time?");

    /* THE STAY IS THIS PROPERTY'S, AND IT IS A STAY THAT CAN STILL BE
       BILLED. A treatment booked against a cancelled booking is a
       charge with nowhere to go, and a checked-out guest's folio is
       closed — finance's own words when it refuses a posting. */
    const { rows: stay } = await client.query<{ status: string }>(
      `select status from reservations where hotel_id = $1 and id = $2`,
      [hotelId, input.stayId],
    );
    if (!stay[0]) return refuse("That booking is not at this property.");
    if (stay[0].status === "cancelled") {
      return refuse("That booking was cancelled.");
    }
    if (stay[0].status === "checked_out") {
      return refuse("That guest has checked out.");
    }

    try {
      const { rows } = await client.query<{ id: string }>(
        `select app.book_spa_appointment($1, $2, $3, $4, $5, $6)::text as id`,
        [hotelId, input.stayId, input.treatmentId, input.therapistId,
         input.startsAt, session.staffId],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      /* The database already wrote the sentence, and it names the
         therapist, the guest and the treatment standing in the way.
         Replacing it with "unavailable" here would throw away the only
         actionable half — 060's rule, and banquet's. */
      const e = error as { message?: string } | undefined;
      return refuse(e?.message ?? "That appointment could not be taken.");
    }
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result, statusFor(result));
});

/* ── Cancelling ───────────────────────────────────────────────────
   A cancellation says why. The reason is the thing somebody asks
   about a month later — the rule the banquet cancellation and the
   folio adjustment both follow. */
spa.post("/:code/spa/appointments/:id/cancel", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "Why is it cancelled? This is the line somebody asks about."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await holdsRoleHere(client, hotelId, SPA_BOOK_ROLES))) {
      return forbidden(BOOK_REFUSED);
    }

    const { rows } = await client.query<{ id: string }>(
      `update spa_appointments
          set status = 'cancelled', cancel_reason = $3,
              cancelled_by = $4, cancelled_at = now()
        where id = $1 and hotel_id = $2 and status = 'booked'
        returning id::text`,
      [c.req.param("id"), hotelId, reason, session.staffId],
    );
    if (!rows[0]) {
      /* Which of the two it is, because "no" without a reason sends
         somebody back to the same button. */
      const { rows: found } = await client.query<{ status: string }>(
        `select status from spa_appointments where id = $1 and hotel_id = $2`,
        [c.req.param("id"), hotelId],
      );
      if (!found[0]) return "missing" as const;
      return refuse(found[0].status === "cancelled"
        ? "That appointment was already cancelled."
        : "That treatment has been given and closed. Reverse the charge "
          + "on the bill instead.");
    }
    return { ok: true as const, id: rows[0].id };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such appointment." }, 404);
  return c.json(result, statusFor(result));
});

/* ══════════════════════════════════════════════════════════════════
   CLOSING A TREATMENT — onto the room bill (D18-22)

   The owner, 19 September, answering the question this chat asked on the
   18th — which door records money taken AT the spa — by removing it: a
   treatment goes on the room bill, the spa needs no connection of its
   own for money, and "settled at the spa" is set aside for later. So
   there is ONE branch here and the route takes no choice. When settling
   at the spa is built, it is a parameter added to this route, not a
   second route.

   THROUGH FINANCE'S DOOR. `postCharge` with the spa's OWN tax rule
   (D18-21): a property that has not set one cannot bill a treatment, and
   finance answers with the sentence naming where GST is set rather than
   aborting the transaction. `category: "Spa"` puts it in the Extra
   Charges report's Spa row.

   THE TABLE ALREADY INSISTS ON THE REST (migration 119): closed means
   settled and settled means closed; a closed one names who and when; a
   posting belongs only to a room settlement. So a half-done close cannot
   be written even by mistake.

   A TREATMENT AGREED AT ₹0 IS CLOSED WITH NO LINE ON THE BILL. Zero is a
   real answer — somebody decided it was free — and finance rightly
   refuses "a charge of nothing". Refusing to close it would leave a free
   treatment open in the diary for ever. It is recorded as settled to the
   room with no posting, which the table allows.

   THE ROW IS LOCKED FIRST, so two clerks closing the same treatment at
   once cannot both post it. */
spa.post("/:code/spa/appointments/:id/close", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* D18-21: reception books AND closes; housekeeping only sees. */
    if (!(await holdsRoleHere(client, hotelId, SPA_BOOK_ROLES))) {
      return forbidden(BOOK_REFUSED);
    }

    const { rows } = await client.query<{
      status: string; agreed_amount: string | null; reservation_id: string;
      treatment: string; therapist: string; starts_at: string;
    }>(
      `select a.status, a.agreed_amount::text, a.reservation_id::text,
              t.name as treatment, th.name as therapist,
              app.hotel_clock(a.hotel_id, a.starts_at) as starts_at
         from spa_appointments a
         join spa_treatments t  on t.id  = a.treatment_id
         join spa_therapists th on th.id = a.therapist_id
        where a.id = $1 and a.hotel_id = $2
          for update of a`,
      [c.req.param("id"), hotelId],
    );
    const a = rows[0];
    if (!a) return "missing" as const;

    /* Every refusal is ABOVE the first write (MEMORY 243). */
    if (a.status === "cancelled") {
      return refuse("That appointment was cancelled, so there is nothing to charge.");
    }
    if (a.status === "completed") {
      return refuse("That treatment is already closed and on the bill.");
    }
    if (a.agreed_amount === null) {
      return refuse("This treatment has no price, so it cannot go on a bill. "
        + "Price it under Treatments first.");
    }

    let postingId: string | null = null;
    if (Number(a.agreed_amount) > 0) {
      /* The property's own clock, as a clerk would read it: 27/08/2026 11:00
         (D17-77). Sliced from the string app.hotel_clock wrote — nothing
         here builds a Date. */
      const [y, m, d] = a.starts_at.slice(0, 10).split("-");
      const when = `${d}/${m}/${y} ${a.starts_at.slice(11, 16)}`;

      const posted = await postCharge(client, hotelId, a.reservation_id, {
        description: `Spa: ${a.treatment} with ${a.therapist}, ${when}`.slice(0, 240),
        amount: Number(a.agreed_amount),
        category: "Spa",
        taxKind: "spa",
      });
      if (!posted.ok) return refuse(posted.reason);
      postingId = posted.id;
    }

    await client.query(
      `update spa_appointments
          set status = 'completed', settlement = 'room',
              closed_by = $3, closed_at = now(), posting_id = $4,
              updated_at = now()
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId, session.staffId, postingId],
    );
    return { ok: true as const, id: c.req.param("id"), postingId };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such appointment." }, 404);
  return c.json(result, statusFor(result));
});
