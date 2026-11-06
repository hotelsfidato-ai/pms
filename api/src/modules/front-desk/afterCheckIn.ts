import { Hono } from "hono";
import { withSession, type Session } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { dateProblem } from "../../validate.ts";
import { can, type Role } from "../../permissions.ts";
import { cancelStaleKeys } from "../room-systems/index.ts";
import { changePaymentMethod, changeStayRate, reverseFolioCharge } from "../finance/index.ts";
import { cancelBooking } from "../reservations/index.ts";
import { amendBooking, voidBooking } from "./operations.ts";

/* ══════════════════════════════════════════════════════════════════
   AFTER CHECK-IN: THE GM UNDOES, CANCELS, VOIDS AND CHANGES; THE FRONT
   DESK ASKS (the owner's D27-397, 6 November; migration 262)

   "We need an option where the GM doesn't have the lock, which is there for
   the reception and the front desk, but not for the GM. It's an option in
   the settings." The switch is Front desk rules' "The GM may undo a
   check-in" (hotels.gm_may_undo_check_in), on at every hotel:

     owner, Admin    always, switch or not
     GM              while the switch is on
     the front desk  (anybody else who may change a booking) asks the GM,
                     while the switch is on
     switch off      the old lock for the GM and the front desk

   UNDO CHECK-IN puts the booking back to confirmed, arriving, with a reason
   kept on it (its audit row says who and when). Refused, in a sentence that
   says what to do, when a charge on the bill is not reversed, when a foreign
   guest's Form C has been submitted, or when a Night audit has closed the
   arrival day. What it does to each thing check-in wrote is in the CHANGELOG
   (D27-397): the check-in's own first night is reversed by the undo, so the
   next check-in or the audit charges it again; the room stays the booking's
   and shows vacant and dirty; a key cut stops.

   CANCEL AND VOID on a guest in house are the undo and then the booking's
   own cancel or void, in one transaction: a refusal of either takes back
   both (a savepoint).

   THE FRONT DESK ASKS (the restaurant's way, D27-363): a stay_requests row
   and an approval of kind 'stay_request' in the GM's inbox and bell. The
   GM, the owner or an Admin approves - never the one who asked - and
   approving DOES it, as them, through the very functions the menu uses, so
   every check is asked again at that moment. A refusal leaves both waiting.

   POST /:code/stays/:id/undo-check-in    { reason }
   POST /:code/stays/:id/cancel-in-house  { reason, waive?, dryRun? }
   POST /:code/stays/:id/requests         { kind, reason, checkIn?, rate?, postingId?, method? }
   ══════════════════════════════════════════════════════════════════ */

export const afterCheckIn = new Hono<{ Variables: { subject: string } }>();

type Act = { ok: true } | { ok: false; reason: string };
const refuse = (reason: string) => ({ ok: false as const, reason });
const rupees = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Switch off, or a role nobody gave this: the old lock, and why. */
export const ARRIVED =
  "Undoing a check-in is off at this hotel (Settings, Front desk rules), so a guest who has arrived is checked out instead.";
/** The front desk, while the switch is on. */
export const ASK_THE_GM =
  "After check-in this is the GM's. Ask the GM: the request goes to their Approvals.";

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** This person's role here, as the website reads it: a group administrator
    is the owner everywhere. And the hotel's switch. */
async function roleAt(client: Client, hotelId: string, staffId: string) {
  const { rows: [r] } = await client.query<{ role: string | null; on: boolean }>(
    `select case when s.is_group_admin then 'owner'
                 else (select sh.role from staff_hotels sh
                        where sh.staff_id = s.id and sh.hotel_id = $1) end as role,
            (select h.gm_may_undo_check_in from hotels h where h.id = $1) as on
       from staff s where s.id = $2`, [hotelId, staffId]);
  return { role: (r?.role ?? null) as Role | null, on: r?.on === true };
}

const THE_THREE: readonly string[] = ["owner", "admin", "gm"];

/** May this person undo a check-in here - and so cancel or void a guest in
    house: yes, ask the GM, or no (the switch). */
export async function undoRight(client: Client, hotelId: string, staffId: string): Promise<"yes" | "ask" | "no"> {
  const { role, on } = await roleAt(client, hotelId, staffId);
  if (role === "owner" || role === "admin") return "yes";
  if (!on || !role) return "no";
  if (role === "gm") return "yes";
  return can(role, "edit", "reservation") ? "ask" : "no";
}

/** Every refusal of an undo, before anything is written: null when it may go. */
export async function undoProblem(client: Client, hotelId: string, stayId: string): Promise<string | null> {
  const { rows: [s] } = await client.query<{
    status: string; arrival: string; closed: boolean; form_c: string | null;
    charge: string | null; amount: string | null;
  }>(
    `select r.status, to_char(r.check_in, 'DD Mon') as arrival,
            /* The arrival day, or any day since, closed by a Night audit. */
            exists (select 1 from night_audit_runs na
                     where na.hotel_id = r.hotel_id and na.status = 'completed'
                       and na.business_date >= r.check_in) as closed,
            /* Form C (Form III) on arrival, reported to the FRRO (guests/formC.ts). */
            (select string_agg(f.reference, ', ') from form_c_filings f
              where f.reservation_id = r.id and f.kind = 'arrival') as form_c,
            c.description as charge, c.amount as amount
       from reservations r
       /* A live charge on the stay's bill, or its own line on its group's:
          anything but the money taken and the check-in's own first night,
          which the undo reverses itself. */
       left join lateral (
         select fp.description, (fp.amount + fp.tax_amount)::text as amount
           from folio_postings fp
           join folios f on f.id = fp.folio_id
          where (f.reservation_id = r.id or fp.reservation_id = r.id)
            and fp.category not in ('payment', 'refund')
            and fp.reverses_id is null
            and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)
            and not (fp.category = 'room' and fp.source_type is not distinct from 'check_in')
          order by fp.id
          limit 1) c on true
      where r.hotel_id = $1 and r.id = $2`, [hotelId, stayId]);
  if (!s) return "No such booking.";
  if (s.status !== "checked_in") return "Only a guest in house has a check-in to undo.";
  if (s.closed) {
    return `The arrival day, ${s.arrival}, has been closed by a Night audit, so the check-in stays. `
      + "Check the guest out instead.";
  }
  if (s.form_c) {
    return `This guest's Form C was submitted to the FRRO (${s.form_c}). The PMS cannot take back a report `
      + "to the FRRO, so the check-in stays. Check the guest out instead.";
  }
  if (s.charge) {
    return `${s.charge} (${rupees(Number(s.amount))}) is still on the bill. Reverse it on the bill first; `
      + "payments stay on the bill as an advance.";
  }
  return null;
}

/** THE UNDO, in the caller's transaction. Every refusal before the first
    write; the reversal of the check-in's own night is the only write that can
    refuse (a tax invoice on the bill), and a savepoint takes it back.
    `keys: false`: the caller stops the room's key cards itself, once its own
    act has gone through (a cancel or a void). */
export async function undoCheckIn(
  client: Client, session: Session, hotelId: string, stayId: string, reason: string,
  opts: { keys?: boolean } = {},
): Promise<Act> {
  const why = reason.trim();
  if (!why || why.length > 300) return refuse("Say why the check-in is undone. It stays on the booking.");
  await client.query("select 1 from reservations where id = $1 and hotel_id = $2 for update", [stayId, hotelId]);
  const problem = await undoProblem(client, hotelId, stayId);
  if (problem) return refuse(problem);

  await client.query("savepoint undo_check_in");
  /* The first night the check-in posted (D27-204), and nothing else: reversed
     as the undo's, which the next check-in and the audit do not count as a
     night charged (night-audit/roomNight.ts). */
  const { rows: nights } = await client.query<{ id: string }>(
    `select fp.id::text from folio_postings fp
       join folios f on f.id = fp.folio_id
      where (f.reservation_id = $1 or fp.reservation_id = $1)
        and fp.category = 'room' and fp.source_type = 'check_in' and fp.reverses_id is null
        and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)`, [stayId]);
  for (const n of nights) {
    const done = await reverseFolioCharge(client, hotelId, n.id, `check-in undone: ${why}`,
      { reservationId: stayId }, "check_in_undo");
    if (!done.ok) {
      await client.query("rollback to savepoint undo_check_in");
      return refuse(`The check-in's room charge cannot be taken off: ${done.reason}`);
    }
  }
  /* Confirmed, arriving. The reason on the booking - its audit row says who
     and when, as "ID not captured - why" does. An early arrival's record goes
     with the arrival it recorded. Status first: the room's occupancy follows
     it (129). */
  await client.query(
    `update reservations
        set status = 'confirmed', early_checkin_at = null, early_checkin_reason = null,
            early_checkin_by = null,
            notes = concat_ws(' · ', nullif(notes, ''), $3::text)
      where id = $1 and hotel_id = $2`,
    [stayId, hotelId, `Check-in undone - ${why}`]);
  /* The room stays the booking's, vacant and dirty: the guest may have had the
     key, and slept in it. */
  await client.query(
    `update rooms rm set housekeeping_status = 'dirty'
       from room_assignments ra
      where ra.reservation_id = $1 and ra.released_at is null and ra.room_id = rm.id
        and ra.from_date <= app.business_date($2)
        and rm.housekeeping_status <> 'out_of_service'`, [stayId, hotelId]);
  await client.query("release savepoint undo_check_in");
  if (opts.keys !== false) await cancelStaleKeys(client, hotelId, stayId);
  void session;
  return { ok: true };
}

/** A guest in house cancelled: the undo, then the booking's own cancel - its
    terms, the waiver the owner, an Admin or the GM may give. One transaction;
    `dryRun` writes nothing (what the terms would charge, for the dialog). */
async function cancelInHouse(
  client: Client, session: Session, hotelId: string, stayId: string,
  ask: { reason: string; waive: boolean; dryRun: boolean },
) {
  const right = await undoRight(client, hotelId, session.staffId);
  if (right !== "yes") return refuse(right === "ask" ? ASK_THE_GM : ARRIVED);
  await client.query("savepoint cancel_in_house");
  const undone = await undoCheckIn(client, session, hotelId, stayId,
    ask.dryRun ? "-" : `Cancelled: ${ask.reason}`, { keys: false });
  if (!undone.ok) {
    await client.query("rollback to savepoint cancel_in_house");
    return undone;
  }
  const done = await cancelBooking(client, hotelId, stayId, session.staffId, ask);
  if (ask.dryRun || !done.ok) {
    await client.query("rollback to savepoint cancel_in_house");
    return done;
  }
  await client.query("release savepoint cancel_in_house");
  await cancelStaleKeys(client, hotelId, stayId);
  return done;
}

/* ── The menu's acts ──────────────────────────────────────────────── */

afterCheckIn.post("/:code/stays/:id/undo-check-in", async (c) => {
  const input = await c.req.json<{ reason?: unknown }>().catch(() => ({}) as { reason?: unknown });
  const reason = typeof input.reason === "string" ? input.reason : "";
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const right = await undoRight(client, hotelId, session.staffId);
    if (right !== "yes") return refuse(right === "ask" ? ASK_THE_GM : ARRIVED);
    return undoCheckIn(client, session, hotelId, c.req.param("id"), reason);
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

afterCheckIn.post("/:code/stays/:id/cancel-in-house", async (c) => {
  const input = await c.req.json<{ reason?: unknown; waive?: unknown; dryRun?: unknown }>()
    .catch(() => ({}) as { reason?: unknown; waive?: unknown; dryRun?: unknown });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const dryRun = input.dryRun === true;
  if (!reason && !dryRun) {
    return c.json(refuse("Why is it cancelled? It stays on the booking, e.g. “Guest changed plans”."), 409);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return cancelInHouse(client, session, hotelId, c.req.param("id"), { reason, waive: input.waive === true, dryRun });
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The front desk asks the GM ───────────────────────────────────── */

const KINDS = {
  undo_check_in: "Undo the check-in",
  cancel: "Cancel the booking",
  void: "Void the booking",
  arrival: "Change the arrival",
  rate: "Change the rate",
  payment_method: "Change how a payment was taken",
} as const;
type Kind = keyof typeof KINDS;
/** The three that unmake the arrival: the switch decides who asks. */
const UNDOES: readonly Kind[] = ["undo_check_in", "cancel", "void"];

afterCheckIn.post("/:code/stays/:id/requests", async (c) => {
  const input = await c.req.json().catch(() => ({})) as {
    kind?: unknown; reason?: unknown; checkIn?: unknown; rate?: unknown; postingId?: unknown; method?: unknown;
  };
  const kind = input.kind as Kind;
  if (!Object.hasOwn(KINDS, String(kind))) return c.json(refuse("Ask the GM for one of the things after check-in."), 409);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 300) return c.json(refuse("Say why, for the GM."), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");
    const { rows: [stay] } = await client.query<{
      id: string; status: string; reference: string; guest: string; room: string | null; check_in: string;
    }>(
      `select r.id::text, r.status, r.reference, g.full_name as guest, app.stay_room(r.id) as room,
              r.check_in::text
         from reservations r join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and r.id::text = $2`, [hotelId, stayId]);
    if (!stay) return refuse("No such booking.");

    const { role } = await roleAt(client, hotelId, session.staffId);
    if (UNDOES.includes(kind)) {
      if (stay.status !== "checked_in") return refuse("Only a guest in house is asked about here.");
      const right = await undoRight(client, hotelId, session.staffId);
      if (right === "no") return refuse(ARRIVED);
      if (right === "yes") return refuse("You may do this yourself, from the guest's menu.");
      const problem = await undoProblem(client, hotelId, stayId);
      if (problem) return refuse(problem);
    } else if (role && THE_THREE.includes(role)) {
      return refuse("You may do this yourself.");
    }

    const details: Record<string, unknown> = {};
    let what: string = KINDS[kind];
    let amount: number | null = null;
    if (kind === "arrival") {
      if (stay.status !== "checked_in") return refuse("Only a guest in house is asked about here.");
      const day = typeof input.checkIn === "string" ? input.checkIn : "";
      const wrong = dateProblem(day);
      if (wrong) return refuse(wrong);
      if (day === stay.check_in) return refuse("That is the arrival already.");
      details["checkIn"] = day;
      what = `Change the arrival from ${stay.check_in} to ${day}`;
    } else if (kind === "rate") {
      const rate = Math.round(Number(input.rate) * 100) / 100;
      if (!(rate > 0)) return refuse("A rate is more than zero.");
      if (!["confirmed", "checked_in"].includes(stay.status)) return refuse("Only a booking to come or a guest in house changes rate.");
      details["rate"] = rate;
      amount = rate;
      what = `Change the rate to ${rupees(rate)} a night`;
    } else if (kind === "payment_method") {
      const postingId = typeof input.postingId === "string" && /^\d+$/.test(input.postingId) ? input.postingId : null;
      const method = typeof input.method === "string" ? input.method.trim() : "";
      if (!postingId || !method) return refuse("Which payment, and how was it really paid?");
      const { rows: [p] } = await client.query<{ amount: string; label: string }>(
        `select (-fp.amount)::text as amount, coalesce(pay.method_label, pay.method) as label
           from folio_postings fp
           join folios f on f.id = fp.folio_id
           join payments pay on pay.posting_id = fp.id
          where f.hotel_id = $1 and f.reservation_id = $2::uuid and fp.id = $3::bigint
            and fp.category = 'payment' and fp.reverses_id is null
            and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)`,
        [hotelId, stay.id, postingId]);
      if (!p) return refuse("No such payment on this bill.");
      if (p.label === method) return refuse(`It was taken by ${p.label} already.`);
      details["postingId"] = postingId;
      details["method"] = method;
      amount = Number(p.amount);
      what = `Change how ${rupees(amount)} was paid: ${p.label} to ${method}`;
    }
    const summary = `${what} - ${stay.guest}, room ${stay.room ?? "-"}, ${stay.reference}`;

    const { rows: [dup] } = await client.query(
      "select 1 from stay_requests where reservation_id = $1 and kind = $2 and status = 'pending'", [stay.id, kind]);
    if (dup) return refuse("This is already with the GM.");
    /* Somebody must be there to decide, or nothing is written (MEMORY 243). */
    const { rows: [rule] } = await client.query(
      "select 1 from approval_rules where hotel_id = $1 and kind = 'stay_request' and is_active", [hotelId]);
    if (!rule) return refuse("Nobody is set to approve these at this hotel. Call the GM.");

    const { rows: [r] } = await client.query<{ id: string }>(
      `insert into stay_requests (hotel_id, reservation_id, kind, details, summary, reason, requested_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id::text`,
      [hotelId, stay.id, kind, JSON.stringify(details), summary, reason, session.staffId]);
    const { rows: [a] } = await client.query<{ id: string | null }>(
      "select app.request_approval($1, 'stay_request', 'stay_requests', $2::uuid, $3, $4, $5)::text as id",
      [hotelId, r!.id, `${summary}. Why: ${reason}`, amount, session.staffId]);
    if (!a?.id) throw new Error("A request was written with no approval: the rule went away under it.");
    await client.query("update stay_requests set approval_id = $2 where id = $1", [r!.id, a.id]);
    return { ok: true as const, id: r!.id };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/** The request behind an approval, done as the approver (routes/approvals.ts
    calls this through the service's front door before it marks the approval
    approved). A refusal leaves both waiting. */
export async function performStayRequest(
  client: Client, session: Session, hotelId: string, requestId: string,
): Promise<Act> {
  const { rows: [r] } = await client.query<{
    reservation_id: string; kind: Kind; details: Record<string, unknown>; reason: string; status: string;
  }>(
    `select reservation_id::text, kind, details, reason, status
       from stay_requests where id::text = $1 and hotel_id = $2 for update`, [requestId, hotelId]);
  if (!r) return refuse("No such request.");
  if (r.status !== "pending") return refuse(`This request was ${r.status} already.`);
  const why = `${r.reason} (asked, approved)`;
  const stayId = r.reservation_id;
  let done: { ok: boolean; reason?: string };
  if (r.kind === "undo_check_in") {
    const right = await undoRight(client, hotelId, session.staffId);
    done = right === "yes" ? await undoCheckIn(client, session, hotelId, stayId, why) : refuse(ARRIVED);
  } else if (r.kind === "cancel") {
    done = await cancelInHouse(client, session, hotelId, stayId, { reason: why, waive: false, dryRun: false });
  } else if (r.kind === "void") {
    done = await voidBooking(client, session, hotelId, stayId, why);
  } else if (r.kind === "arrival") {
    done = await amendBooking(client, session, hotelId, stayId, { checkIn: String(r.details["checkIn"]) });
  } else if (r.kind === "rate") {
    done = await changeStayRate(client, hotelId, stayId, Number(r.details["rate"]), why);
  } else {
    done = await changePaymentMethod(client, hotelId, stayId,
      String(r.details["postingId"]), String(r.details["method"]), why);
  }
  if (!done.ok) return refuse(done.reason ?? "Not done.");
  await client.query(
    "update stay_requests set status = 'approved', decided_by = $2, decided_at = now() where id::text = $1",
    [requestId, session.staffId]);
  return { ok: true };
}

/** The request behind an approval, rejected with the approver's note. */
export async function rejectStayRequest(client: Client, session: Session, requestId: string, note: string): Promise<void> {
  await client.query(
    `update stay_requests set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
      where id::text = $1 and status = 'pending'`,
    [requestId, session.staffId, note]);
}
