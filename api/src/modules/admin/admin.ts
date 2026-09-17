import { Hono } from "hono";
import { createHash } from "node:crypto";
import { withSession } from "../../auth.ts";
import {
  ensureAccount, setAccountPassword, passwordProblem,
} from "../../identity.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   ADMINISTRATION — the writes

   Everything under /admin was READ-ONLY until this file existed. The
   screens listed staff, roles, the audit log and the properties, and
   nothing could be changed: `grep -c '<input|<form'` on the admin page
   returned 0, and there was not a single admin write endpoint.

   The database was ready the whole time — app.provision_property()
   creates a property, its room types and its rooms in one transaction,
   and pms_app could already execute it. What was missing was a door.

   TWO GUARDS, ANSWERING DIFFERENT QUESTIONS

     app.require_group_admin()       WHO is asking
     app.require_provisioning_key()  whether this DEPLOYMENT permits it

   Both run inside the database, on every structural call. A stolen
   admin session passes the first and must not pass the second, which
   is the entire reason the second exists.

   THE KEY NEVER REACHES POSTGRES. This file hashes it and sends the
   digest, so the key does not appear in a query log, a slow-query
   report, or `pg_stat_activity`.
   ══════════════════════════════════════════════════════════════════ */

export const admin = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The provisioning key for this request.
 *
 * Read from the header the admin screen sends. It is NOT read from the
 * server's environment: a key baked into the deployment would make
 * every session that reaches this API a provisioning session, which is
 * exactly the thing the key exists to prevent. A person types it, or
 * their client holds it.
 */
const keyDigest = (raw: string | undefined): string | null =>
  raw && raw.trim() ? sha256(raw.trim()) : null;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** A refusal the database raised, turned into a reason a person reads. */
function reasonFor(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e?.code) return null;
  /* 42501 insufficient_privilege — either guard. P0001 raise exception.
     23505 unique_violation — the code is taken. Everything else is a
     fault, not an answer, and belongs in the log rather than on screen. */
  if (e.code === "42501" || e.code === "P0001") return e.message ?? "Refused.";
  if (e.code === "23505") {
    return "That code is already in use by another property.";
  }
  return null;
}

/* ── Properties ───────────────────────────────────────────────────── */

admin.post("/admin/hotels", async (c) => {
  type Body = {
    code?: string; name?: string; city?: string; state?: string;
    gstin?: string; templateSet?: string; timezone?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  const city = input.city?.trim();

  if (!code) return c.json(refuse("A property needs a code."), 409);
  if (!name) return c.json(refuse("A property needs a name."), 409);
  if (!city) return c.json(refuse("Which city is it in?"), 409);

  /* The code appears in every URL, every invoice series and every
     folio reference. It is not renameable in practice, so it is worth
     refusing a bad one now rather than living with it. */
  if (!/^[A-Z0-9]{2,8}$/.test(code)) {
    return c.json(refuse(
      "A code is 2–8 letters or digits, no spaces - it appears in every " +
      "URL and every invoice number, and it cannot be changed later.",
    ), 409);
  }

  const digest = keyDigest(c.req.header("x-provisioning-key"));
  if (!digest) {
    return c.json(refuse(
      "This action needs the provisioning key. Creating a property " +
      "manufactures a whole tenant - rooms, an invoice series, a folio " +
      "namespace - so a signed-in session is not enough on its own.",
    ), 403);
  }

  try {
    const result = await withSession(c.get("subject"), async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select app.provision_property(
           p_code => $1, p_name => $2, p_city => $3, p_key_hash => $4,
           p_state => $5, p_gstin => $6, p_template_set => $7
         )::text as id`,
        [code, name, city, digest, input.state ?? null, input.gstin ?? null,
         input.templateSet ?? "standard"],
      );

      /* Room TYPES arrive from the template; ROOMS do not.
         provision_property() clones the type catalogue and stops, and
         app.bulk_create_rooms() is a separate act because a property's
         numbering is the one thing a template cannot guess. Reporting a
         room count here would have printed 0 and read like a failure. */
      const { rows: made } = await client.query<{ types: string }>(
        `select count(*)::text as types from room_types where hotel_id = $1`,
        [rows[0]!.id],
      );

      return {
        ok: true as const,
        id: rows[0]!.id,
        code, name,
        roomTypes: Number(made[0]!.types),
        rooms: 0,
        next: "Add its rooms - the property has its type catalogue but no rooms yet.",
      };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── Staff ────────────────────────────────────────────────────────── */

/* ⚠ WRITTEN AFTER THE ENDPOINTS BELOW WERE FOUND UNGUARDED.
   `provision_property` and the access grant raise from inside the
   DATABASE if the caller is not a group admin, which is why those held.
   The four routes added for §2 wrote through plain UPDATEs instead —
   and a plain UPDATE under row level security that matches nothing
   returns rowCount 0 and no error at all.

   So a receptionist calling PATCH /admin/hotels/5EL got **200 ok**, the
   property was not renamed, and the screen would have shown a saved
   change that never happened. Silently doing nothing and reporting
   success is worse than a refusal: nobody goes looking.

   Two things fix it, and both are needed. This says WHY, in a sentence,
   where a person will read it. `changedOrRefuse` makes it impossible
   for a write that touched nothing to report success — because the day
   a policy changes, the check that matters is the one on the result.  */
async function requireGroupAdmin(
  client: Client,
): Promise<{ ok: false; reason: string } | null> {
  const { rows } = await client.query<{ is_group_admin: boolean }>(
    "select is_group_admin from staff where id = app.current_user_id()",
  );
  if (rows[0]?.is_group_admin) return null;
  return refuse(
    "Only a group administrator can change properties and people. " +
    "Ask whoever holds that access.",
  );
}

/** A write that matched no row did not happen, whatever it returned. */
function changedOrRefuse(
  rowCount: number | null, what: string,
): { ok: false; reason: string } | null {
  if (rowCount && rowCount > 0) return null;
  return refuse(
    `Nothing was changed - ${what}. This is not a saved change; it is a ` +
    `write that matched nothing.`,
  );
}

/* ── Editing a property ────────────────────────────────────────────
   §2 asks for it and there was nothing. Note what is NOT editable: the
   code. It appears in every URL, every invoice number and every folio
   reference, so changing it would orphan documents a hotel has already
   given to guests and to an assessor. Creating a property refuses a bad
   code loudly for exactly this reason.
   ═══════════════════════════════════════════════════════════════════ */
/* ── Every property, closed ones included ──────────────────────────
   ⚠ WITHOUT THIS, "CLOSE" IS A ONE-WAY DOOR. `GET /api/hotels` ends
   `where is_active`, so a closed property disappears from every list
   the interface has — including the one carrying the Reopen button.
   Building close/reopen against that endpoint would have shipped a
   button that deletes a property from the screen and a reopen endpoint
   nothing could reach, which is the exact defect this session has been
   closing all day.

   Group admins only, because it also carries the GSTIN and the contact
   details of every property in the group — the thing migration 031 was
   written to stop leaking to a clerk at one hotel.
   ═══════════════════════════════════════════════════════════════════ */
admin.get("/admin/hotels", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rows } = await client.query<{
      id: string; code: string; name: string;
      city: string | null; state: string | null; gstin: string | null;
      phone: string | null; email: string | null; address_line: string | null;
      is_active: boolean; rooms: string; room_types: string | null;
      checked_in: string;
    }>(
      `select h.id::text, h.code, h.name, h.city, h.state, h.gstin,
              h.phone, h.email::text, h.address_line, h.is_active,
              (select count(*) from rooms r
                where r.hotel_id = h.id and r.is_active)::text as rooms,
              (select string_agg(rt.name, ', ' order by rt.sort_order)
                 from room_types rt
                where rt.hotel_id = h.id and rt.is_active) as room_types,
              /* What Close would refuse over, shown BEFORE the button is
                 pressed rather than as a refusal afterwards. */
              (select count(*) from reservations res
                where res.hotel_id = h.id
                  and res.status = 'checked_in')::text as checked_in
         from hotels h
        order by h.is_active desc, h.code`);

    return {
      hotels: rows.map((r) => ({
        id: r.id, code: r.code, name: r.name,
        city: r.city, state: r.state, gstin: r.gstin,
        phone: r.phone, email: r.email, addressLine: r.address_line,
        isActive: r.is_active,
        rooms: Number(r.rooms),
        /* Empty rather than null: a property with no room types is a
           property nobody has set up yet, and the screen says so. */
        roomTypes: (r.room_types ?? "").split(", ").filter(Boolean),
        checkedIn: Number(r.checked_in),
      })),
    };
  });

  if (body && "ok" in body && body.ok === false) return c.json(body, 403);
  return c.json(body);
});

/* ── One property, for whoever runs it ─────────────────────────────
   `GET /admin/hotels` is group-admin only, because it carries the
   GSTIN and contact details of every property in the group — which is
   what migration 031 was written to stop leaking to a clerk at one
   hotel. A general manager needs the same detail for THEIR hotel and
   must not get it for anybody else's, so the scope is the hotel rather
   than the caller's rank.

   The numbers are NOT here. `/statistics/snapshot` and
   `/statistics/period` already answer them, and a second implementation
   on this route would be a second answer to drift from the first — the
   shape that cost five copies of the booking-source label.
   ═══════════════════════════════════════════════════════════════════ */
admin.get("/admin/hotels/:code", async (c) => {
  try {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    await client.query("select app.require_hotel_admin($1)", [hotelId]);

    const { rows } = await client.query<{
      id: string; code: string; name: string;
      city: string | null; state: string | null; gstin: string | null;
      phone: string | null; email: string | null; address_line: string | null;
      is_active: boolean; rooms: string; room_types: string | null;
      checked_in: string;
    }>(
      `select h.id::text, h.code, h.name, h.city, h.state, h.gstin,
              h.phone, h.email::text, h.address_line, h.is_active,
              (select count(*) from rooms r
                where r.hotel_id = h.id and r.is_active)::text as rooms,
              (select string_agg(rt.name, ', ' order by rt.sort_order)
                 from room_types rt
                where rt.hotel_id = h.id and rt.is_active) as room_types,
              (select count(*) from reservations res
                where res.hotel_id = h.id
                  and res.status = 'checked_in')::text as checked_in
         from hotels h where h.id = $1`, [hotelId]);

    /* Everyone rostered HERE, whatever else they can reach. The
       property screen is about this hotel's team, so somebody who also
       works at Pune appears once, with the role they hold at this one. */
    const { rows: staff } = await client.query<{
      id: string; name: string; email: string; role: string;
      is_active: boolean; can_sign_in: boolean; is_group_admin: boolean;
      home_screen: string;
    }>(
      `select s.id::text, s.full_name as name, s.email::text, sh.role,
              s.is_active, (s.firebase_uid is not null) as can_sign_in,
              s.is_group_admin,
              /* NULL is the Dashboard - what everybody had before 087. */
              coalesce(s.home_screen, 'dashboard') as home_screen
         from staff_hotels sh join staff s on s.id = sh.staff_id
        where sh.hotel_id = $1
        order by s.is_active desc, s.full_name`, [hotelId]);

    /* What THIS caller may hand out here — an owner sees every role, a
       gm sees everything but `owner`. Sent so the picker offers exactly
       what the server will accept, rather than offering everything and
       refusing afterwards. */
    const { rows: roles } = await client.query<{ roles: string[] }>(
      "select app.grantable_roles($1) as roles", [hotelId]);

    const h = rows[0]!;
    return {
      ok: true as const,
      property: {
        id: h.id, code: h.code, name: h.name,
        city: h.city, state: h.state, gstin: h.gstin,
        phone: h.phone, email: h.email, addressLine: h.address_line,
        isActive: h.is_active,
        rooms: Number(h.rooms),
        roomTypes: (h.room_types ?? "").split(", ").filter(Boolean),
        checkedIn: Number(h.checked_in),
      },
      staff: staff.map((r) => ({
        id: r.id, name: r.name, email: r.email, role: r.role,
        isActive: r.is_active, canSignIn: r.can_sign_in,
        isGroupAdmin: r.is_group_admin, homeScreen: r.home_screen,
      })),
      grantableRoles: roles[0]!.roles,
    };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result);
  } catch (error) {
    /* `app.require_hotel_admin` RAISES. Without this the refusal a
       manager reads is "Something went wrong", which is the exact
       failure 078 was written about. */
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

admin.patch("/admin/hotels/:code", async (c) => {
  type Body = {
    name?: string; city?: string; state?: string; gstin?: string;
    phone?: string; email?: string; addressLine?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const name = input.name?.trim();
    const city = input.city?.trim();
    if (name !== undefined && !name) {
      return refuse("A property needs a name.");
    }
    if (city !== undefined && !city) {
      return refuse("Which city is it in?");
    }

    /* ⚠ THE GSTIN PRINTS ON EVERY INVOICE THIS PROPERTY ISSUES. A typo
       here is a typo on documents already in a guest's hands, so the
       shape is checked rather than trusted — fifteen characters, the
       state code first. Not a checksum: that would refuse a valid
       number if the algorithm here were subtly wrong, and refusing a
       real GSTIN is worse than accepting a malformed one somebody can
       correct. */
    const gstin = input.gstin?.trim().toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      return refuse(
        "That does not look like a GSTIN - fifteen characters, starting " +
        "with the two-digit state code. It prints on every invoice this " +
        "property issues, so it is worth checking now.",
      );
    }

    const updated = await client.query(
      `update hotels set
         name         = coalesce($2, name),
         city         = coalesce($3, city),
         state        = coalesce($4, state),
         gstin        = coalesce($5, gstin),
         phone        = coalesce($6, phone),
         email        = coalesce($7, email),
         address_line = coalesce($8, address_line)
       where id = $1`,
      [hotelId, name ?? null, city ?? null,
       input.state?.trim() || null, gstin || null,
       input.phone?.trim() || null, input.email?.trim() || null,
       input.addressLine?.trim() || null],
    );
    const nothing = changedOrRefuse(
      updated.rowCount, "that property is not one you can write to");
    if (nothing) return nothing;

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Closing and reopening a property ──────────────────────────────
   NOT the same as deleting one, which 066 already handles and which
   refuses the moment a property has traded. A hotel that has taken a
   booking must never disappear — its folios, invoices and Form C
   filings are records somebody may have to produce years later. A hotel
   that is closed for the season simply stops appearing in pickers.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/hotels/:code/:state", async (c) => {
  const state = c.req.param("state");
  if (state !== "close" && state !== "reopen") {
    return c.json(refuse("A property is closed or reopened."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (state === "close") {
      /* ⚠ A CLOSED PROPERTY WITH SOMEBODY STILL IN IT is a guest nobody
         can check out — the property vanishes from the picker and the
         folio with it. Named rather than silently allowed. */
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from reservations
          where hotel_id = $1 and status = 'checked_in'`,
        [hotelId],
      );
      if (Number(rows[0]!.n) > 0) {
        return refuse(
          `${rows[0]!.n} guest(s) are still checked in. Check them out ` +
          `first - a closed property leaves a folio nobody can reach.`,
        );
      }
    }

    const { rowCount } = await client.query(
      "update hotels set is_active = $2 where id = $1",
      [hotelId, state === "reopen"],
    );
    const nothing = changedOrRefuse(
      rowCount, "that property is not one you can write to");
    if (nothing) return nothing;

    return { ok: true as const, isActive: state === "reopen" };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Editing a person ──────────────────────────────────────────────
   Their name, their phone. NOT their email: that is what a Firebase
   account is keyed on, and changing it here without changing it there
   leaves somebody who can sign in and reaches nothing — the silent
   empty-database failure the deploy README warns about at length.
   ═══════════════════════════════════════════════════════════════════ */
admin.patch("/admin/staff/:id", async (c) => {
  type Body = { fullName?: string; phone?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const fullName = input.fullName?.trim();
  if (fullName !== undefined && !fullName) {
    return c.json(refuse("A person needs a name."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rowCount } = await client.query(
      `update staff set
         full_name = coalesce($2, full_name),
         phone     = coalesce($3, phone)
       where id = $1`,
      [c.req.param("id"), fullName ?? null, input.phone?.trim() || null],
    );
    if (!rowCount) return refuse("No such person.");
    return { ok: true as const };
  });

  return c.json(result!, "ok" in result! && result!.ok ? 200 : 409);
});

/* ── The first screen after sign-in ─────────────────────────────────
   Owner's decision, 14 September: the GM sets it for each person, and
   the person can change their own. Both go through one function each
   (087) that can touch only these columns — the GM's through
   app.may_manage_person, so a GM reaches their own staff and never a
   group administrator. */
const HOME_SCREENS = ["dashboard", "rooms", "calendar"] as const;
const ROOM_GROUPINGS = ["type", "floor"] as const;

const screenProblem = (v: unknown): string | null =>
  v === undefined || (HOME_SCREENS as readonly unknown[]).includes(v)
    ? null
    : "The first screen is Dashboard, Rooms or Calendar.";

admin.put("/admin/staff/:id/home-screen", async (c) => {
  const input = await c.req.json<{ homeScreen?: string }>()
    .catch(() => ({}) as { homeScreen?: string });
  const problem = input.homeScreen === undefined
    ? "Which screen should they start on?"
    : screenProblem(input.homeScreen);
  if (problem) return c.json(refuse(problem), 409);

  try {
    await withSession(c.get("subject"), (client) =>
      client.query("select app.set_home_screen($1, $2)",
                   [c.req.param("id"), input.homeScreen]));
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "P0002") return c.json(refuse("No such person."), 404);
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
  return c.json({ ok: true as const, homeScreen: input.homeScreen });
});

/* A person's own — the first screen and how they like the house grouped.
   Either may be sent alone; what is not sent is left as it was. */
admin.put("/me/preferences", async (c) => {
  type Body = { homeScreen?: string; roomGrouping?: string; startHereDismissed?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const problem = screenProblem(input.homeScreen)
    ?? (input.roomGrouping === undefined
        || (ROOM_GROUPINGS as readonly unknown[]).includes(input.roomGrouping)
        ? null : "Rooms group by room type or by floor.")
    ?? (input.startHereDismissed === undefined || typeof input.startHereDismissed === "boolean"
        ? null : "Put the card away, or bring it back.");
  if (problem) return c.json(refuse(problem), 409);
  if (input.homeScreen === undefined && input.roomGrouping === undefined
      && input.startHereDismissed === undefined) {
    return c.json(refuse("Nothing to change."), 409);
  }

  await withSession(c.get("subject"), async (client) => {
    if (input.homeScreen !== undefined || input.roomGrouping !== undefined) {
      await client.query("select app.set_my_preferences($1, $2)",
                         [input.homeScreen ?? null, input.roomGrouping ?? null]);
    }
    /* The Start here card (089) — the person's own, set only by them. */
    if (input.startHereDismissed !== undefined) {
      await client.query("select app.set_start_here($1)", [input.startHereDismissed]);
    }
  });
  return c.json({ ok: true as const });
});

/* ── Bringing somebody back ────────────────────────────────────────
   Deactivating existed; reactivating did not, so a person switched off
   by mistake needed somebody with database access to undo it.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/staff/:id/reactivate", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rows } = await client.query<{ uid: string | null }>(
      `update staff set is_active = true where id = $1
       returning firebase_uid as uid`,
      [c.req.param("id")],
    );
    if (!rows[0]) return refuse("No such person.");

    /* ⚠ ACTIVE WITH NO FIREBASE ACCOUNT SIGNS IN NOWHERE. Said at the
       moment it becomes true rather than discovered by the person on
       their first morning back. */
    if (!rows[0].uid) {
      return {
        ok: true as const,
        warning:
          "They are active again, but they have no sign-in account linked. " +
          "Add them in Firebase and run `npm run link-staff`, or they will " +
          "reach a sign-in page that accepts nothing.",
      };
    }
    return { ok: true as const };
  });

  return c.json(result!, "ok" in result! && result!.ok ? 200 : 409);
});

admin.get("/admin/staff", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      id: string; email: string; full_name: string; phone: string | null;
      is_group_admin: boolean; is_active: boolean; hotels: string | null;
      can_sign_in: boolean; home_screen: string;
    }>(
      /* RLS decides what comes back. A group admin sees everyone; a
         clerk sees themselves and the colleagues they share a property
         with. This query does not filter — migration 027 does. */
      /* ⚠ AND THE PHONE. `PATCH /admin/staff/:id` has always accepted
         one and this query never returned it, so an edit form would
         open with the box empty and save that emptiness over whatever
         was there. Half a round trip is worse than none. */
      `select s.id::text, s.email::text, s.full_name, s.phone,
              s.is_group_admin, s.is_active,
              /* ⚠ THE THING NOBODY COULD SEE. A staff row with no
                 firebase_uid is a person who appears on this list,
                 with a role and a property, and cannot sign in at all.
                 Until the API created accounts that was EVERY person
                 added through the screen, and the only way to find out
                 was to walk to a terminal and try. */
              (s.firebase_uid is not null) as can_sign_in,
              coalesce(s.home_screen, 'dashboard') as home_screen,
              (select string_agg(h.code || ':' || sh.role, ',' order by h.code)
                 from staff_hotels sh join hotels h on h.id = sh.hotel_id
                where sh.staff_id = s.id) as hotels
         from staff s
        order by s.is_group_admin desc, s.full_name`,
    );

    return {
      staff: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.full_name,
        phone: r.phone,
        canSignIn: r.can_sign_in,
        isGroupAdmin: r.is_group_admin,
        isActive: r.is_active,
        homeScreen: r.home_screen,
        access: (r.hotels ?? "").split(",").filter(Boolean).map((pair) => {
          const [code, role] = pair.split(":");
          return { code: code!, role: role! };
        }),
      })),
    };
  });
  return c.json(body);
});

/* ── Adding somebody who can actually sign in ──────────────────────
   ⚠ THIS ENDPOINT USED TO WRITE A ROW AND STOP. The person appeared on
   the People screen with a role and a property, walked to a terminal,
   and found a sign-in page that would never accept them — because no
   Firebase account existed and no password had ever been set. Filling
   the gap meant `npm run link-staff` in a terminal on the server after
   creating the account by hand in the console.

   The password is REQUIRED for somebody new, and that is the fix
   rather than a policy: an optional one would recreate the same hole
   for anybody who left the box empty, and they would find out at a
   terminal in front of a guest.

   A GM MAY USE THIS, for their own property. They pass `hotelCode` and
   `role`, the person is created and rostered in one act, and
   `app.require_hotel_admin` refuses a hotel they do not run. A group
   administrator may leave the hotel out and grant access separately.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/staff", async (c) => {
  type Body = {
    email?: string; name?: string; isGroupAdmin?: boolean;
    password?: string; hotelCode?: string; role?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const email = input.email?.trim().toLowerCase();
  const name = input.name?.trim();
  if (!email || !email.includes("@")) {
    return c.json(refuse("A working email address is required - it is how " +
      "they sign in."), 409);
  }
  if (!name) return c.json(refuse("What is their name?"), 409);

  const password = input.password ?? "";
  if (!password) {
    return c.json(refuse(
      "Set them a password. Without one there is no way for them to sign "
      + "in, and they will find that out standing at a terminal."), 409);
  }
  const bad = passwordProblem(password);
  if (bad) return c.json(refuse(bad), 409);

  const hotelCode = input.hotelCode?.trim().toUpperCase();
  const role = input.role?.trim();
  if (hotelCode && !role) {
    return c.json(refuse("Which role at that property?"), 409);
  }

  /* A group admin can reach every property's data. Minting one is a
     structural act, so it takes the key; an ordinary clerk does not. */
  const wantsAdmin = input.isGroupAdmin === true;
  const digest = keyDigest(c.req.header("x-provisioning-key"));
  if (wantsAdmin && !digest) {
    return c.json(refuse(
      "Making somebody a group administrator needs the provisioning key. " +
      "They would be able to reach every property.",
    ), 403);
  }

  try {
    const result = await withSession(c.get("subject"), async (client) => {
      let hotelId: string | null = null;
      if (hotelCode) {
        hotelId = await hotelFor(client, hotelCode);
        if (!hotelId) return refuse(`No property with code ${hotelCode}.`);
        /* A GM's route in. Raises for a hotel they do not run, and a
           group administrator passes it everywhere. */
        await client.query("select app.require_hotel_admin($1)", [hotelId]);

        const { rows: allowed } = await client.query<{ roles: string[] }>(
          "select app.grantable_roles($1) as roles", [hotelId]);
        if (!allowed[0]!.roles.includes(role!)) {
          return refuse(
            allowed[0]!.roles.length === 0
              ? "You cannot give anybody a role at this property."
              : `You may give: ${allowed[0]!.roles.join(", ")}.`);
        }
      } else {
        /* No hotel named, so this is the group-level act it always was. */
        await client.query("select app.require_group_admin()");
      }

      if (wantsAdmin) {
        await client.query("select app.require_provisioning_key($1)", [digest]);
      }

      /* ⚠ WHOSE ADDRESS IS THIS — ASKED BEFORE FIREBASE IS TOUCHED (088).
         `ensureAccount` adopts an account that already exists and SETS
         ITS PASSWORD. Without this, a general manager "adding" the owner's
         own email took over the owner's login: every check above passed,
         Firebase changed the password, and the refusal at the staff row
         below came too late to undo it. Live 9–15 September; found by the
         security review. The database answers, because under the caller's
         own row policies a manager cannot even see the owner's row. */
      await client.query("select app.require_claimable_address($1)", [email]);

      /* ⚠ THE ACCOUNT FIRST, THE ROW SECOND. Firebase is not in the
         transaction — nothing can roll it back — so the order is chosen
         so the survivable failure is the one that happens.

         Account then row: a failed insert leaves a Firebase account
         with no staff row. It signs in, resolves to nobody, and the
         next attempt at the same address ADOPTS it, so the state heals
         itself.

         Row then account: a failed account leaves exactly the defect
         this endpoint exists to fix — a person on the People screen
         who cannot sign in. */
      const account = await ensureAccount(email, name, password);

      const { rows } = await client.query<{ id: string; existed: boolean }>(
        /* on conflict, because a person re-invited is the common case and
           an error there teaches an admin to avoid the screen. Their
           property access is untouched — that is a separate act. */
        `insert into staff (email, full_name, is_group_admin, firebase_uid)
         values ($1, $2, $3, $4)
         on conflict (email) do update
           set full_name = excluded.full_name,
               is_active = true,
               firebase_uid = excluded.firebase_uid
         returning id::text, (xmax <> 0) as existed`,
        [email, name, wantsAdmin, account.uid],
      );

      if (hotelId) {
        await client.query(
          `insert into staff_hotels (staff_id, hotel_id, role)
           values ($1, $2, $3)
           on conflict (staff_id, hotel_id) do update set role = excluded.role`,
          [rows[0]!.id, hotelId, role]);
      }

      return {
        ok: true as const,
        id: rows[0]!.id,
        email, name,
        existed: rows[0]!.existed,
        /* Said plainly, because it changes what the manager tells them.
           An adopted account keeps whatever password it already had
           unless this call set one — and this call always sets one. */
        accountExisted: account.existed,
        ...(hotelCode ? { hotelCode, role } : {}),
      };
    });
    /* ⚠ THE STATUS FOLLOWS THE ANSWER. This was a bare `c.json(result)`,
       so a refusal from inside the session — "No property with code
       PUN", "You may give: …" — went back as 200 OK carrying
       `ok: false`. The browser's helper reads the body and coped, which
       is why nobody noticed; anything reading the status code saw a
       success. Every other route in this file answers 409. */
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── Setting somebody's password ───────────────────────────────────
   The owner's answer on 9 September: a manager resets anybody rostered
   at their own hotel, so a password forgotten on a Sunday does not
   stop somebody working.

   ⚠ WHO MAY DO IT IS THE DATABASE'S ANSWER. `app.may_set_password`
   holds for any caller — this route, a script, a later endpoint — and
   it refuses a property manager who aims at a group administrator,
   because resetting that password is how a gm becomes an owner of
   seven hotels. A check written here would protect this endpoint and
   nothing else.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/staff/:id/password", async (c) => {
  type Body = { password?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const password = input.password ?? "";
  if (!password) return c.json(refuse("What should it be?"), 409);
  const bad = passwordProblem(password);
  if (bad) return c.json(refuse(bad), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      email: string; full_name: string; uid: string | null; allowed: boolean;
    }>(
      `select s.email::text, s.full_name, s.firebase_uid as uid,
              app.may_set_password(s.id) as allowed
         from staff s where s.id = $1`,
      [c.req.param("id")]);
    if (!rows[0]) return refuse("No such person.");
    if (!rows[0].allowed) {
      return refuse(
        "You can set a password for people at a property you manage, and "
        + "for yourself. Not for a group administrator.");
    }

    /* ⚠ NO ACCOUNT YET IS THE ORDINARY CASE HERE, not an error. Anybody
       added before this endpoint existed has a staff row and no
       Firebase account at all, and this is exactly the screen somebody
       would use to fix that. `ensureAccount` creates or adopts, and the
       uid is written back — without that last step the account exists
       and resolves to nobody. */
    if (!rows[0].uid) {
      const account = await ensureAccount(
        rows[0].email, rows[0].full_name, password);
      await client.query("update staff set firebase_uid = $2 where id = $1",
        [c.req.param("id"), account.uid]);
      return { ok: true as const, linked: true };
    }

    await setAccountPassword(rows[0].uid, password);
    return { ok: true as const, linked: false };
  });

  return c.json(result!, "ok" in result! && result!.ok ? 200 : 409);
});

/* ⚠ NO "EMAIL THEM A LINK" ENDPOINT, AND THAT IS A DECISION. One was
   written and removed the same afternoon: asked how a new person gets
   a password, the owner chose a typed one — "you type one, and can
   reset it later" — over the option that offered both. Half of a
   hotel's staff have no address they read, and this deployment has no
   mail server, so a link would have been an endpoint nobody called.
   `identity.ts` keeps `passwordSetLink` for the day it is asked for.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Who may see which property ───────────────────────────────────── */

admin.post("/admin/staff/:id/access", async (c) => {
  type Body = { code?: string; role?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const role = input.role?.trim();
  if (!code) return c.json(refuse("Which property?"), 409);
  if (!role) return c.json(refuse("Which role at that property?"), 409);

  /* ⚠ THIS PASSED ANYTHING STRAIGHT THROUGH TO THE CHECK CONSTRAINT, and
     three of the roles the screen offered were not in it. Assigning
     Admin, Manager or Viewer returned

         500  "Something went wrong. Nothing was changed."

     which tells a person nothing and reads as the system being broken.
     078 gave the database and the interface one list; this asks it, so
     an unknown role is a sentence naming what IS allowed. */
  /* ⚠ THE LIST IS NOW PER HOTEL AND PER CALLER. `app.assignable_roles()`
     answers "what roles exist"; `app.grantable_roles(hotel)` answers
     "which of them may YOU hand out HERE", which is a different
     question the moment a general manager can roster their own staff.
     A gm gets everything except `owner` — see 084 for why. */
  try {
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, code);
      if (!hotelId) return refuse(`No property with code ${code}.`);

      /* Raises for a hotel this caller does not run. A group
         administrator passes everywhere; the manager of Akkalkot does
         not pass in Pune, which `app.is_manager()` would have allowed
         because it has no hotel_id in it at all. */
      await client.query("select app.require_hotel_admin($1)", [hotelId]);

      /* ⚠ TWO DIFFERENT REFUSALS, and collapsing them into one sentence
         loses the half that helps. "wizard" is a typo; "owner" is a
         real role this caller may not hand out. Both used to answer
         "You may give: …", which reads to somebody who typed a typo as
         though the system had an opinion about their authority.

         078 exists because three roles the screen offered were not in
         the constraint, and assigning one answered "Something went
         wrong". The lesson was to name what IS allowed — and naming
         what was ASKED FOR is the other half of it. */
      const { rows: lists } = await client.query<{
        exists: string[]; allowed: string[];
      }>(
        `select app.assignable_roles() as exists,
                app.grantable_roles($1) as allowed`, [hotelId]);
      const { exists, allowed } = lists[0]!;

      if (!exists.includes(role)) {
        return refuse(
          `There is no "${role}" role. You may give: ${allowed.join(", ")}.`);
      }
      if (!allowed.includes(role)) {
        return refuse(
          allowed.length === 0
            ? "You cannot give anybody a role at this property."
            : `"${role}" is not yours to give here. You may give: `
              + `${allowed.join(", ")}.`);
      }

      /* THIS ROW IS THE ISOLATION.

         `app.auth_hotel_ids()` reads staff_hotels, and every RLS policy
         on every scoped table is built on it. Writing here is what
         actually decides which property's data a person can see —
         the navigation and the route guard are the courtesy layer. */
      await client.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         values ($1, $2, $3)
         on conflict (staff_id, hotel_id) do update set role = excluded.role`,
        [c.req.param("id"), hotelId, role],
      );

      return { ok: true as const, code, role };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

admin.delete("/admin/staff/:id/access/:code", async (c) => {
  try {
    const result = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return refuse("No such property.");

      /* Taking access away is scoped exactly as giving it is. A gate on
         one and not the other is a gate. */
      await client.query("select app.require_hotel_admin($1)", [hotelId]);

      const { rowCount } = await client.query(
        "delete from staff_hotels where staff_id = $1 and hotel_id = $2",
        [c.req.param("id"), hotelId],
      );
      if (!rowCount) return refuse("They did not have access to that property.");

      return { ok: true as const };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

admin.post("/admin/staff/:id/deactivate", async (c) => {
  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      await client.query("select app.require_group_admin()");

      /* Locking yourself out is not a thing the system should help with,
         and on a single-admin deployment it is unrecoverable from the
         interface. */
      if (c.req.param("id") === session.staffId) {
        return refuse(
          "You cannot deactivate your own account. Somebody else with " +
          "administrator access has to do it.",
        );
      }

      /* Deactivated, never deleted. Their name is on folio postings,
         invoices and the audit log, and a deleted row makes every one
         of those unattributable. */
      const { rowCount } = await client.query(
        "update staff set is_active = false where id = $1 and is_active",
        [c.req.param("id")],
      );
      if (!rowCount) return refuse("That account is already inactive.");

      return { ok: true as const };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── The administrator's own dashboard ────────────────────────────── */

/**
 * Not the group dashboard.
 *
 * That one answers "how did the hotels trade" — occupancy, ADR, RevPAR.
 * This answers "who is using this system and what did they change",
 * which is a different question with a different audience, and the data
 * for it was already being written: 16 tables carry an audit trail with
 * an actor and a timestamp.
 */
admin.get("/admin/overview", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows: staff } = await client.query<{
      total: string; active: string; admins: string; unassigned: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where is_active)::text as active,
              count(*) filter (where is_group_admin)::text as admins,
              count(*) filter (
                where is_active and not is_group_admin
                  and not exists (select 1 from staff_hotels sh
                                   where sh.staff_id = staff.id)
              )::text as unassigned
         from staff`,
    );

    const { rows: hotels } = await client.query<{
      total: string; rooms: string;
    }>(
      `select count(*)::text as total,
              (select count(*) from rooms)::text as rooms
         from hotels`,
    );

    /* Fourteen days, by day. Enough to see a weekend, short enough that
       a quiet Tuesday is visible rather than averaged away. */
    const { rows: activity } = await client.query<{
      day: string; actions: string; people: string;
    }>(
      `select to_char(at::date,'YYYY-MM-DD') as day,
              count(*)::text as actions,
              count(distinct actor)::text as people
         from audit_log
        where at >= now() - interval '14 days'
        group by at::date
        order by at::date`,
    );

    const { rows: byTable } = await client.query<{
      table_name: string; action: string; n: string;
    }>(
      `select table_name, action, count(*)::text as n
         from audit_log
        where at >= now() - interval '30 days'
        group by table_name, action
        order by count(*) desc
        limit 12`,
    );

    /* Who did what, most recent first. The actor is joined rather than
       shown as a uuid: an audit trail nobody can read is a compliance
       artefact, not a tool. */
    const { rows: recent } = await client.query<{
      at: string; actor: string | null; table_name: string;
      action: string; hotel: string | null;
    }>(
      `select to_char(a.at,'DD Mon HH24:MI') as at,
              s.full_name as actor, a.table_name, a.action, h.code as hotel
         from audit_log a
         left join staff s on s.id = a.actor
         left join hotels h on h.id = a.hotel_id
        order by a.at desc
        limit 25`,
    );

    return {
      staff: {
        total: Number(staff[0]!.total),
        active: Number(staff[0]!.active),
        admins: Number(staff[0]!.admins),
        /* Somebody who can sign in and reach nothing. A real state, and
           one nobody notices without being told. */
        unassigned: Number(staff[0]!.unassigned),
      },
      properties: {
        total: Number(hotels[0]!.total),
        rooms: Number(hotels[0]!.rooms),
      },
      activity: activity.map((r) => ({
        day: r.day, actions: Number(r.actions), people: Number(r.people),
      })),
      byTable: byTable.map((r) => ({
        table: r.table_name, action: r.action, count: Number(r.n),
      })),
      recent: recent.map((r) => ({
        at: r.at,
        /* Null when a migration or the demo loader acted. Shown as a
           dash rather than invented as "System". */
        actor: r.actor,
        table: r.table_name,
        action: r.action,
        hotel: r.hotel,
      })),
    };
  });
  return c.json(body);
});
