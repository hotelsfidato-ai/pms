import { withUser } from "./db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SIGN-IN HISTORY (D27-243 5.4)

   Called by `auth.ts` each time a token is verified. A sign-in is one
   Firebase `auth_time`; its tokens are refreshed hourly and sent with
   every request, so this keeps the ones already written and writes each
   sign-in once (`app.note_sign_in` also ignores a repeat). It never
   throws into the request: a history that cannot be written is a line
   in the server's log, not a refused sign-in.
   ══════════════════════════════════════════════════════════════════ */

const seen = new Set<string>();

export function noteSignIn(uid: string, authTime: number | undefined, headers: Headers): Promise<void> {
  if (!authTime) return Promise.resolve();
  const key = `${uid}:${authTime}`;
  if (seen.has(key)) return Promise.resolve();
  /* ponytail: a cap, not an LRU; the database ignores a repeat anyway. */
  if (seen.size > 10_000) seen.clear();
  seen.add(key);

  const device = headers.get("user-agent")?.slice(0, 300) ?? null;
  const address = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip") || null;
  return withUser("", (client) => client.query(
    "select app.note_sign_in($1, to_timestamp($2), $3, $4)", [uid, authTime, device, address]))
    .then(() => undefined, (error: unknown) => {
      seen.delete(key);
      console.warn("[sign-ins] not recorded:", error instanceof Error ? error.message : error);
    });
}
