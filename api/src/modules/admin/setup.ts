import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { commissioningChecks } from "./commissioning.ts";

/* ══════════════════════════════════════════════════════════════════
   SET UP THIS HOTEL (the owner's D27-311, 13 October)

   Eighteen steps that walk a hotel to go-live, in the owner's order. The
   screens are the website's; this file is what each step's state IS.

     GET  /:code/setup            every step's state, and `ready`
     PUT  /:code/setup/:step      { choice: completed | later | remind | clear,
                                    remindOn?: YYYY-MM-DD }

   DONE IS DERIVED, NEVER STORED. Each step asks the hotel's own rows the
   question its screen settles - the commissioning checks for the first
   five (commissioning.ts, asked, not copied) and the same kind of question
   for the rest. A step whose done-ness the PMS can always see is
   `automatic`: a hand "Completed" is refused there. A step it cannot always
   see (the front desk's times start filled in; a hotel may rightly have no
   discounts or cancellation terms: charging nothing is a valid choice) is
   marked Completed by hand - and where its data DOES show it done (a discount
   set, terms made, a report going out), it is done without the hand.
   "Done" wins over any stored later or remind.

   WHAT IS STORED (hotel_setup_steps, migration "setting up a hotel"): only
   a choice the data cannot show - completed by hand, later, remind on a day -
   with who and when. "clear" deletes it.

   THE BELL (the core's routes/notifications.ts) asks `setupReminders` below:
   a step whose reminder day has come, still not done - derived in the bell's
   own read, never a stored message.

   WHO: the hotel's owner, GM or Admin, or a group administrator. The role
   gate asks first (roleGate.ts: GET `setting` view, PUT room setup edit -
   both exactly those three); app.manages_hotel here and the table's own
   policy ask again.
   ══════════════════════════════════════════════════════════════════ */

/** The steps, in the owner's order. 1-5 must be done before the first
    booking, 6-13 before opening, 14-17 are optional, 18 is the summary. */
export const STEP_IDS = [
  "profile", "taxes", "room-types", "rooms", "prices",
  "payments", "front-desk", "cancellation", "charges", "booking-sources", "people", "messages", "modules",
  "branding", "policies", "lists", "connections",
  "go-live",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export type StepState = "done" | "todo" | "later" | "remind";

/** One step, as GET /api/hotels/:code/setup answers it. */
export interface SetupStep {
  id: StepId;
  state: StepState;
  /** True: done-ness is derived, and a hand Completed is refused. */
  automatic: boolean;
  /** What is still missing, in plain words; null when done or when the PMS cannot tell. */
  detail: string | null;
  /** YYYY-MM-DD, while the choice is "remind". */
  remindOn: string | null;
  /** Who chose later, remind or completed, and when (ISO). */
  by: string | null;
  at: string | null;
}

/** GET /api/hotels/:code/setup. `ready`: steps 1-5 all done. */
export interface Setup {
  steps: SetupStep[];
  ready: boolean;
}

/** The body of PUT /api/hotels/:code/setup/:step. */
export interface SetupChoice {
  choice: "completed" | "later" | "remind" | "clear";
  remindOn?: string;
}

/** The words for each step: the bell's title says "Setup: <title>" and the
    summary names what is missing. THE PAGE'S OWN LIST is the website's
    setup/steps.ts; setupWizard.test.tsx holds the two to the same words. */
export const STEP_TITLES: Record<StepId, string> = {
  "profile": "Hotel profile",
  "taxes": "Taxes",
  "room-types": "Room types",
  "rooms": "Rooms",
  "prices": "Prices",
  "payments": "Payment methods and bank details",
  "front-desk": "Front desk times and rules",
  "cancellation": "Cancellation terms",
  "charges": "Charges, discounts and commission",
  "booking-sources": "Booking sources",
  "people": "People and roles",
  "messages": "Guest messages and daily reports",
  "modules": "Modules",
  "branding": "Logo, photos and highlights",
  "policies": "Group and house policies",
  "lists": "The lists",
  "connections": "Connections",
  "go-live": "Ready to go live",
};

const MUST: readonly StepId[] = ["profile", "taxes", "room-types", "rooms", "prices"];

/** What the PMS sees: `done` from the rows; `automatic` when it can always
    tell. `detail` says what is missing where it can. */
type Seen = { done: boolean; automatic: boolean; detail: string | null };

const missing = (parts: string[]) =>
  parts.length === 0 ? null : `Still missing: ${parts.join(", ")}.`;

async function seen(client: Client, hotelId: string): Promise<Record<StepId, Seen>> {
  const { hotel, checks, figures } = await commissioningChecks(client, hotelId);
  const ok = (id: string) => checks.find((x) => x.id === id)?.done ?? false;

  const { rows: [x] } = await client.query<{
    bank: boolean; paying: boolean; charges: boolean; reports: boolean;
    logo: boolean; photo: boolean; highlight: boolean; connected: boolean;
  }>(
    `select
       exists (select 1 from hotel_bank_details where hotel_id = $1) as bank,
       exists (select 1 from payment_methods where hotel_id = $1 and is_active) as paying,
       exists (select 1 from inclusions where hotel_id = $1 and is_active)
         or exists (select 1 from room_promotions where hotel_id = $1 and is_active)
         or exists (select 1 from booking_source_rates where hotel_id = $1 and commission_pct is not null)
         or exists (select 1 from hotels where id = $1
                     and (early_checkin_charge is not null or late_checkout_charge is not null)) as charges,
       exists (select 1 from daily_report_emails
                where hotel_id = $1 and is_on and cardinality(addresses) > 0) as reports,
       exists (select 1 from hotel_logos where hotel_id = $1) as logo,
       exists (select 1 from hotel_photos where hotel_id = $1) as photo,
       exists (select 1 from hotel_texts where hotel_id = $1) as highlight,
       exists (select 1 from channel_hotels where hotel_id = $1)
         or exists (select 1 from crs_hotels where hotel_id = $1)
         or exists (select 1 from market_rate_settings where hotel_id = $1 and is_on) as connected`,
    [hotelId]);

  const auto = (done: boolean, detail: string | null): Seen =>
    ({ done, automatic: true, detail: done ? null : detail });
  /* Ticks itself when its rows show it; otherwise only a hand can say. */
  const byHand = (done = false, detail: string | null = null): Seen =>
    ({ done, automatic: false, detail: done ? null : detail });

  /* A test hotel carries no GSTIN by design (its documents are TEST, NOT VALID:
     D27-296 (8)), so its profile does not ask for one. A real hotel does.
     Asked once, in commissioningChecks, whose list leaves it out too. */
  const { test } = figures;

  const profile = [
    ...(test ? [] : !hotel.gstin ? ["the GSTIN"]
      : figures.placeholderGstin ? ["a real GSTIN (the one set is a dummy)"] : []),
    ...(!hotel.address ? ["the address"] : []),
    ...(!hotel.phone ? ["the phone"] : []),
    ...(!hotel.email ? ["the email"] : []),
  ];
  const s: Omit<Record<StepId, Seen>, "go-live"> = {
    "profile": auto((test || ok("gstin")) && ok("contact"), missing(profile)),
    "taxes": auto(ok("tax-rules"), "No GST rule for rooms yet."),
    "room-types": auto(ok("room-types"), "No room types yet."),
    "rooms": auto(ok("rooms"), "No rooms yet."),
    "prices": auto(ok("tariffs"), figures.types === 0 ? "No room types yet."
      : `${figures.unpriced} of ${figures.types} room types have no price.`),
    "payments": auto(x!.bank && x!.paying, missing([
      ...(!x!.paying ? ["a way of paying that is switched on"] : []),
      ...(!x!.bank ? ["the bank details"] : []),
    ])),
    "front-desk": byHand(),
    "cancellation": byHand(ok("cancellation"), "No cancellation terms yet."),
    "charges": byHand(x!.charges),
    "booking-sources": byHand(),
    "people": auto(ok("staff"), "Nobody has been given this hotel yet."),
    "messages": byHand(x!.reports),
    "modules": byHand(),
    "branding": byHand(x!.logo && x!.photo && x!.highlight),
    "policies": byHand(),
    "lists": byHand(),
    "connections": byHand(x!.connected),
  };
  const notYet = MUST.filter((id) => !s[id as Exclude<StepId, "go-live">].done);
  return {
    ...s,
    "go-live": auto(notYet.length === 0,
      `Before the first booking: ${notYet.map((id) => STEP_TITLES[id]).join(", ")}.`),
  };
}

type Stored = { step: string; choice: "completed" | "later" | "remind"; remind_on: string | null;
                by: string | null; at: Date };

async function stored(client: Client, hotelId: string): Promise<Map<string, Stored>> {
  /* The name through app.colleague_name, not a join to staff: a GM cannot
     read the group owner's staff row, and the join gave them null (MEMORY 283). */
  const { rows } = await client.query<Stored>(
    `select st.step, st.choice, st.remind_on::text, app.colleague_name(st.chosen_by, st.hotel_id) as by,
            st.chosen_at as at
       from hotel_setup_steps st
      where st.hotel_id = $1`, [hotelId]);
  return new Map(rows.map((r) => [r.step, r]));
}

/** Every step's state for one hotel - what GET answers and the bell reads. */
export async function setupOf(client: Client, hotelId: string): Promise<Setup> {
  const [sees, chosen] = [await seen(client, hotelId), await stored(client, hotelId)];
  const steps = STEP_IDS.map((id): SetupStep => {
    const see = sees[id];
    const c = chosen.get(id);
    const handDone = !see.automatic && c?.choice === "completed";
    const state: StepState = see.done || handDone ? "done"
      : c?.choice === "later" ? "later" : c?.choice === "remind" ? "remind" : "todo";
    return {
      id, state, automatic: see.automatic,
      detail: state === "done" ? null : see.detail,
      remindOn: c?.choice === "remind" ? c.remind_on : null,
      by: c?.by ?? null,
      at: c ? c.at.toISOString() : null,
    };
  });
  return { steps, ready: steps.filter((x) => MUST.includes(x.id)).every((x) => x.state === "done") };
}

/** The reminders whose day has come at this hotel (its own date), for the
    bell. Empty for anybody who does not manage the hotel: the table's
    policy shows them nothing. */
export async function setupReminders(client: Client, hotelId: string): Promise<SetupStep[]> {
  /* One cheap question first: the bell is read all day, the steps rarely. */
  const { rows: [due] } = await client.query<{ today: string; n: number }>(
    `select ((now() at time zone h.timezone)::date)::text as today,
            (select count(*)::int from hotel_setup_steps st
              where st.hotel_id = h.id and st.choice = 'remind'
                and st.remind_on <= (now() at time zone h.timezone)::date) as n
       from hotels h where h.id = $1`, [hotelId]);
  if (!due?.n) return [];
  return (await setupOf(client, hotelId)).steps
    .filter((x) => x.state === "remind" && x.remindOn! <= due.today);
}

/* ── The routes ─────────────────────────────────────────────────── */

export const setup = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });
const NO_SUCH = refuse("No such property.");
const NOT_YOURS = refuse(
  "A hotel is set up by its owner, general manager or Admin, or by a group administrator. Ask one of them.");

/** The hotel, for somebody who manages it; "refused" for somebody who works
    there and does not; null for anybody else (they cannot see it at all). */
async function managed(client: Client, code: string): Promise<{ id: string; today: string } | "refused" | null> {
  const { rows } = await client.query<{ id: string; manages: boolean; today: string }>(
    `select id::text, coalesce(app.manages_hotel(id), false) as manages,
            ((now() at time zone timezone)::date)::text as today
       from hotels where code = upper($1)`,
    [code]);
  if (!rows[0]) return null;
  return rows[0].manages ? { id: rows[0].id, today: rows[0].today } : "refused";
}

setup.get("/:code/setup", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    const hotel = await managed(client, c.req.param("code"));
    if (hotel === null || hotel === "refused") return hotel;
    return setupOf(client, hotel.id);
  });
  if (found === null) return c.json(NO_SUCH, 404);
  return found === "refused" ? c.json(NOT_YOURS, 403) : c.json(found);
});

/* A calendar day that exists: 2026-02-30 is refused, not rolled into March. */
const realDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

setup.put("/:code/setup/:step", async (c) => {
  const step = c.req.param("step") as StepId;
  const input = await c.req.json<Partial<SetupChoice>>().catch(() => ({}) as Partial<SetupChoice>);
  const choice = input.choice;
  const remindOn = typeof input.remindOn === "string" ? input.remindOn : "";

  if (!(STEP_IDS as readonly string[]).includes(step)) return c.json(refuse("There is no such step."), 404);
  if (step === "go-live") {
    return c.json(refuse("Ready to go live is a summary of the other steps: there is nothing to choose on it."), 409);
  }
  if (choice !== "completed" && choice !== "later" && choice !== "remind" && choice !== "clear") {
    return c.json(refuse("Choose Completed, Later or Remind me."), 400);
  }
  if (choice === "remind" && !realDay(remindOn)) {
    return c.json(refuse("Choose the day to be reminded on."), 400);
  }

  const done = await withSession(c.get("subject"), async (client) => {
    const hotel = await managed(client, c.req.param("code"));
    if (hotel === null || hotel === "refused") return hotel;

    if (choice === "remind" && remindOn < hotel.today) return "past" as const;
    if (choice === "completed" && (await seen(client, hotel.id))[step].automatic) return "automatic" as const;

    if (choice === "clear") {
      await client.query("delete from hotel_setup_steps where hotel_id = $1 and step = $2", [hotel.id, step]);
    } else {
      await client.query(
        `insert into hotel_setup_steps (hotel_id, step, choice, remind_on)
         values ($1, $2, $3, $4)
         on conflict (hotel_id, step) do update
            set choice = excluded.choice, remind_on = excluded.remind_on,
                chosen_by = app.current_user_id(), chosen_at = now()`,
        [hotel.id, step, choice, choice === "remind" ? remindOn : null]);
    }
    return "saved" as const;
  });

  if (done === null) return c.json(NO_SUCH, 404);
  if (done === "refused") return c.json(NOT_YOURS, 403);
  if (done === "past") return c.json(refuse("A reminder is for today or a day after it."), 400);
  if (done === "automatic") {
    return c.json(refuse("The PMS ticks this step itself once it sees it done, so it cannot be marked by hand."), 409);
  }
  return c.json({ ok: true });
});
