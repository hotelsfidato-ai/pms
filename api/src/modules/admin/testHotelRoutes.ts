import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   TEST HOTELS (D27-296, the owner, 10 October)

   A test hotel inside the live system, one per real hotel ("Hotel
   Amrapali · TEST"): a copy of its whole setup, used only by the people
   switched on for it, reset at will. The owner and the group
   administrators make it, reset it and re-copy it (10); the database does
   each in one definer function (migration "test hotels") and refuses
   anybody else, and a real hotel, in its own words - these routes say it
   first, in a sentence, and map what the database raises.

     POST /api/admin/hotels/:code/test-hotel    :code is a REAL hotel
          201 { code, name } · 409 when it has one already
     POST /api/admin/hotels/:code/test-reset    :code is a TEST hotel
          { confirm: "RESET" } -> 200 { removed }
     POST /api/admin/hotels/:code/test-recopy   :code is a TEST hotel
          { confirm: "RE-COPY" } -> 200 { removed, copied }

   A refusal carries its sentence twice, as `reason` (this service's
   shape) and as `error` (the shape every other door uses), so a screen
   reads it whichever it looks for.
   ══════════════════════════════════════════════════════════════════ */
export const testHotels = new Hono<{ Variables: { subject: string } }>();

const ONLY_ADMINS =
  "Only the owner or a group administrator makes, resets or re-copies a test hotel.";

type Answer = { status: 200 | 201 | 400 | 403 | 404 | 409; body: object };
const no = (status: Answer["status"], sentence: string): Answer =>
  ({ status, body: { ok: false, reason: sentence, error: sentence } });

/** What the database raised, as an answer - or null for a fault. */
function answerFor(error: unknown): Answer | null {
  const e = error as { code?: string; message?: string } | undefined;
  switch (e?.code) {
    case "42501": return no(403, e.message ?? ONLY_ADMINS);
    case "P0002": return no(404, "No such property.");
    case "23505": case "23514": case "P0001": return no(409, e.message ?? "Refused.");
    default: return null;
  }
}

async function hotelByCode(client: Client, code: string) {
  const { rows } = await client.query<{ id: string; name: string; test_of: string | null }>(
    "select id::text, name, test_of::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0] ?? null;
}

async function run(
  subject: string, fn: (client: Client) => Promise<Answer>,
): Promise<Answer> {
  try {
    return await withSession(subject, async (client, session) => {
      if (!session.isGroupAdmin) return no(403, ONLY_ADMINS);
      return fn(client);
    });
  } catch (error) {
    const answer = answerFor(error);
    if (answer) return answer;
    throw error;
  }
}

testHotels.post("/admin/hotels/:code/test-hotel", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const answer = await run(c.get("subject"), async (client) => {
    const hotel = await hotelByCode(client, code);
    if (!hotel) return no(404, "No such property.");
    if (hotel.test_of) {
      return no(409, `${code} is a test hotel. A test hotel is made for a real one.`);
    }
    /* One per real hotel: app.create_test_hotel refuses a second in its own
       words ("<name> already has a test hotel: <CODE>."), answered 409.

       ⚠ Made in a statement of its own: in a WHERE clause the function runs
       once per row the planner looks at, and the second run refused the
       first's own work (found by its test, 10 October). */
    const { rows: made } = await client.query<{ id: string }>(
      "select app.create_test_hotel($1)::text as id", [hotel.id]);
    const { rows } = await client.query<{ code: string; name: string }>(
      "select code, name from hotels where id = $1", [made[0]!.id]);
    return { status: 201, body: { code: rows[0]!.code, name: rows[0]!.name } };
  });
  return c.json(answer.body, answer.status);
});

/** The two clearing acts: the typed word first, then a test hotel only. */
async function clearing(
  subject: string, code: string, confirm: unknown, word: "RESET" | "RE-COPY",
  act: (client: Client, id: string) => Promise<object>,
): Promise<Answer> {
  return run(subject, async (client) => {
    const hotel = await hotelByCode(client, code);
    if (!hotel) return no(404, "No such property.");
    if (confirm !== word) {
      return no(400, word === "RESET"
        ? "Type RESET to confirm. Every booking, bill, order and guest made in this test hotel goes; its setup and its testers stay."
        : "Type RE-COPY to confirm. Everything made in this test hotel goes, and the real hotel's setup is copied over it again; its testers stay.");
    }
    if (!hotel.test_of) {
      return no(409, `${code} is a real hotel. Only a test hotel is ${word === "RESET" ? "reset" : "re-copied"}.`);
    }
    return { status: 200, body: await act(client, hotel.id) };
  });
}

const confirmOf = async (c: { req: { json<T>(): Promise<T> } }): Promise<unknown> =>
  (await c.req.json<{ confirm?: unknown }>().catch(() => ({} as { confirm?: unknown }))).confirm;

testHotels.post("/admin/hotels/:code/test-reset", async (c) => {
  const answer = await clearing(c.get("subject"), c.req.param("code").toUpperCase(),
    await confirmOf(c), "RESET", async (client, id) => {
      const { rows } = await client.query<{ removed: string }>(
        "select app.reset_test_hotel($1)::text as removed", [id]);
      return { removed: Number(rows[0]!.removed) };
    });
  return c.json(answer.body, answer.status);
});

testHotels.post("/admin/hotels/:code/test-recopy", async (c) => {
  const answer = await clearing(c.get("subject"), c.req.param("code").toUpperCase(),
    await confirmOf(c), "RE-COPY", async (client, id) => {
      const { rows } = await client.query<{ done: { removed: number; copied: number } }>(
        "select app.recopy_test_hotel($1) as done", [id]);
      return { removed: Number(rows[0]!.done.removed), copied: Number(rows[0]!.done.copied) };
    });
  return c.json(answer.body, answer.status);
});

/** For the routes that add people (D27-296 (10)), admin.ts. */
export const TEST_PEOPLE =
  "Only the owner or a group administrator adds somebody to a test hotel.";
