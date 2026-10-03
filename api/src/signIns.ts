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

/* ── One device signed out (P7, D27-255) ──────────────────────────
   Firebase can only revoke ALL of a person's sessions, so one sign-in is
   refused here, by (uid, auth_time). The list is the database's
   (app.signed_out_sign_ins), read once per process - the API is one
   process (deploy/fidato-api.service) - and added to when a device is
   signed out through this server. */
let signedOut: Promise<Set<string>> | null = null;
const keyOf = (uid: string, authTime: number) => `${uid}:${authTime}`;

function loadSignedOut(): Promise<Set<string>> {
  signedOut ??= withUser("", async (client) => new Set(
    (await client.query<{ firebase_uid: string; t: string }>(
      "select firebase_uid, extract(epoch from auth_time)::bigint::text as t from app.signed_out_sign_ins()",
    )).rows.map((r) => keyOf(r.firebase_uid, Number(r.t)))))
    .catch((error: unknown) => {
      signedOut = null; // asked again on the next request
      throw error;
    });
  return signedOut;
}

/** Is this sign-in one somebody signed out? Called by auth.ts on every token. */
export async function isSignedOut(uid: string, authTime: number | undefined): Promise<boolean> {
  if (!authTime) return false;
  /* A list that cannot be read is not a reason to sign everybody out (a 401
     sends the page to sign-in): the request meets the same database next. */
  const list = await loadSignedOut().catch((error: unknown) => {
    console.warn("[sign-ins] signed-out list not read:", error instanceof Error ? error.message : error);
    return null;
  });
  return list?.has(keyOf(uid, authTime)) ?? false;
}

/** A device was just signed out here: refuse it from the next request. */
export async function markSignedOut(uid: string, authTime: number): Promise<void> {
  (await loadSignedOut()).add(keyOf(uid, authTime));
}

/** A fresh process, for the test that the list survives a restart. */
export function forgetSignedOutForTests(): void {
  signedOut = null;
}

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
