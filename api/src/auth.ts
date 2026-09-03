import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { env } from "./env.ts";
import { withUser, type Client } from "./db.ts";

/* ══════════════════════════════════════════════════════════════════
   AUTHENTICATION

   Firebase answers *who are you*. Postgres answers *what may you do*.
   Nothing in this file decides a permission — it resolves an identity
   and hands it to `withUser`, and RLS does the rest.

   The subject that goes into `app.user_id` is the raw Firebase uid.
   `app.current_user_id()` accepts either a staff uuid or a 28-character
   uid and resolves the latter through `staff.firebase_uid`, so there
   is no lookup here that could run outside a policy.
   ══════════════════════════════════════════════════════════════════ */

let firebaseApp: App | null = null;

function firebase(): App {
  if (firebaseApp) return firebaseApp;
  if (!env.firebaseServiceAccount) {
    throw new Error("[auth] No service account configured.");
  }
  firebaseApp =
    getApps()[0] ??
    initializeApp({ credential: cert(JSON.parse(env.firebaseServiceAccount)) });
  return firebaseApp;
}

export interface Session {
  /** Whatever `app.user_id` was set to — a Firebase uid, or a staff uuid in dev. */
  subject: string;
  staffId: string;
  email: string;
  fullName: string;
  isGroupAdmin: boolean;
}

export class Unauthenticated extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unauthenticated";
  }
}

/**
 * Turns an incoming request's headers into a subject, without touching
 * the database. Throws `Unauthenticated` rather than returning null so
 * a caller cannot forget to check.
 */
export async function subjectFor(headers: Headers): Promise<string> {
  /* Development only. `env.ts` refuses to start the process with this
     on in production, so this branch cannot exist on a deployed box. */
  if (env.allowDevAuth) {
    const dev = headers.get("x-dev-staff-id");
    if (dev) return dev;
  }

  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Unauthenticated("No bearer token.");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new Unauthenticated("Empty bearer token.");

  /* Resolve the app OUTSIDE the try. A missing or malformed service
     account is a fault in the deployment, not in the caller's token, and
     inside the catch below it came back as "Token rejected." — sending an
     operator to debug a perfectly good credential while the real problem
     was that the process had never been given one. It is logged loudly and
     answered as a 500, because it is our failure and not theirs. */
  let app: App;
  try {
    app = firebase();
  } catch (error) {
    console.error("[auth] cannot verify tokens:",
      error instanceof Error ? error.message : error);
    throw error;
  }

  try {
    const decoded = await getAuth(app).verifyIdToken(token, true);
    return decoded.uid;
  } catch (error) {
    /* Never echo the library's message back to the CALLER — it
       distinguishes "expired" from "wrong project" from "revoked",
       which is a probing aid and tells a legitimate user nothing
       they can act on beyond "sign in again".

       It goes to the server log, though. A rejection nobody can see the
       reason for is a rejection nobody can fix. */
    console.warn("[auth] token rejected:",
      error instanceof Error ? error.message : error);
    throw new Unauthenticated("Token rejected.");
  }
}

/**
 * Opens the session transaction and reads the caller's own staff row
 * through the `staff_self` policy. A subject that resolves to nothing —
 * a uid with no staff row, or a deactivated one — comes back empty,
 * and that is a 401 rather than an empty page.
 */
export async function withSession<T>(
  subject: string,
  fn: (client: Client, session: Session) => Promise<T>,
): Promise<T> {
  return withUser(subject, async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      full_name: string;
      is_group_admin: boolean;
    }>(
      `select id, email, full_name, is_group_admin
         from staff
        where id = app.current_user_id()`,
    );

    const row = rows[0];
    if (!row) {
      throw new Unauthenticated("No active staff record for this account.");
    }

    return fn(client, {
      subject,
      staffId: row.id,
      email: row.email,
      fullName: row.full_name,
      isGroupAdmin: row.is_group_admin,
    });
  });
}
