import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { hasRoleAt, hotelFor } from "./reputation.ts";
import { FEEDBACK_ROLES } from "./feedbackRoles.ts";

/* ══════════════════════════════════════════════════════════════════
   GUEST FEEDBACK - WHAT GUESTS ANSWERED AFTER CHECK-OUT (D27-383 item 10)

   The survey on the guest's own page (api/src/routes/guestSurvey.ts) writes
   `guest_feedback`, once a stay; this reads it for one hotel: the scores by
   month, the latest answers with their comments, and whether the hotel is
   asking at all (Settings, Modules, `feedback_survey`, off to start).

   FOR THE GM - the owner, an administrator and the general manager, who
   also get a low score (1 or 2, overall or any part) in Notifications.
   Decided under D27-396: these are answers about the staff, so the people
   who run the hotel read them, not the desk.
   ══════════════════════════════════════════════════════════════════ */

export { FEEDBACK_ROLES };
export const FEEDBACK_REFUSED =
  "Guest feedback is for the owner, an administrator or the general manager.";

/** A low answer, for the bell: 1 or 2, overall or any part. One rule. */
export const lowScore = (t = "") => `least(${t}overall, coalesce(${t}room, 5), coalesce(${t}cleanliness, 5),
  coalesce(${t}food, 5), coalesce(${t}staff, 5)) <= 2`;

export const feedback = new Hono<{ Variables: { subject: string } }>();

/** How many months the screen reaches back, the current one included. */
const MONTHS = 12;
/** How many answers it lists. */
const LATEST = 100;

feedback.get("/:code/feedback", async (c) => {
  const answer = await withSession(c.get("subject"), async (client) => {
    const hotel = await hotelFor(client, c.req.param("code"));
    if (!hotel) return { status: 404 as const, body: { error: "No such property." } };
    if (!(await hasRoleAt(client, hotel.id, FEEDBACK_ROLES))) {
      return { status: 403 as const, body: { ok: false as const, reason: FEEDBACK_REFUSED } };
    }
    const { rows: [on] } = await client.query<{ on: boolean }>(
      "select app.module_enabled($1, 'feedback_survey') as on", [hotel.id]);

    /* A month with no answer for a part is null - a dash on the screen,
       never a zero. */
    const { rows: months } = await client.query(
      `select to_char(app.hotel_day($1, answered_at), 'YYYY-MM') as month,
              count(*)::int                       as answers,
              round(avg(overall), 1)::float       as overall,
              round(avg(room), 1)::float          as room,
              round(avg(cleanliness), 1)::float   as cleanliness,
              round(avg(food), 1)::float          as food,
              round(avg(staff), 1)::float         as staff,
              count(*) filter (where ${lowScore()})::int as low
         from guest_feedback
        where hotel_id = $1
          and app.hotel_day($1, answered_at)
              >= (date_trunc('month', app.hotel_day($1, now())) - make_interval(months => $2 - 1))::date
        group by 1
        order by 1 desc`,
      [hotel.id, MONTHS]);

    const { rows: answers } = await client.query(
      `select f.id::text, app.hotel_clock($1, f.answered_at) as "answeredAt",
              f.overall, f.room, f.cleanliness, f.food, f.staff, f.comment,
              (${lowScore("f.")}) as low,
              r.id::text as "stayId", r.reference, g.full_name as guest,
              coalesce(app.stay_room(r.id), '-') as "roomNumber"
         from guest_feedback f
         join reservations r on r.id = f.reservation_id
         join guests g on g.id = r.guest_id
        where f.hotel_id = $1
        order by f.answered_at desc
        limit $2`,
      [hotel.id, LATEST]);

    return { status: 200 as const, body: { on: on!.on, months, answers, latest: LATEST } };
  });
  return c.json(answer.body, answer.status);
});
