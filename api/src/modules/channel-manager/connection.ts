import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { suConnection } from "./su/runtime.ts";
import { TOKENS_PER_HOUR } from "./su/token.ts";
import { ownsAnyHotel, SU_OWNER_ONLY } from "./access.ts";

/* ══════════════════════════════════════════════════════════════════
   IS SU SET UP, AND DOES ITS LOGIN WORK — part 1 of the SU connection

   GET  /api/channel-manager/su         what the server has: which account
                                        (test or live), what is missing,
                                        the last login and when it was
   POST /api/channel-manager/su/login   log in to SU now and say whether it
                                        worked. Nothing is sent to any
                                        booking site; a login changes nothing

   Mounted under `/api`, not `/api/hotels/:code`: SU's keys belong to the
   PMS as SU's partner, and one pair serves every hotel connected.

   WHO. The `integration` grant in `src/lib/permissions.ts` is held by the
   owner alone, and a group administrator counts as the owner everywhere
   (the rule `api/src/modules/admin/grants.ts` copies). So: a group
   administrator, or somebody who is `owner` at a hotel. Whether an
   administrator or a GM should also reach this is the owner's to say.

   What the answer never carries: the client id, the secret, the token.
   ══════════════════════════════════════════════════════════════════ */

export const connection = new Hono<{ Variables: { subject: string } }>();

let lastLogin: { ok: boolean; at: string; reason: string | null } | null = null;

function describe() {
  const su = suConnection();
  if (!su.ok) {
    return {
      configured: false as const,
      environment: null,
      missing: su.missing,
      reason: su.reason,
      lastLogin,
      loginsThisHour: null,
      loginsPerHour: TOKENS_PER_HOUR,
    };
  }
  return {
    configured: true as const,
    environment: su.settings.environment,
    missing: [] as string[],
    reason: null,
    lastLogin,
    loginsThisHour: su.tokens.usedThisHour(),
    loginsPerHour: TOKENS_PER_HOUR,
  };
}

connection.get("/channel-manager/su", async (c) => {
  const allowed = await withSession(c.get("subject"), (client) => ownsAnyHotel(client));
  if (!allowed) return c.json({ ok: false, reason: SU_OWNER_ONLY }, 403);
  return c.json(describe());
});

connection.post("/channel-manager/su/login", async (c) => {
  const allowed = await withSession(c.get("subject"), (client) => ownsAnyHotel(client));
  if (!allowed) return c.json({ ok: false, reason: SU_OWNER_ONLY }, 403);

  const su = suConnection();
  if (!su.ok) {
    return c.json({ ok: false, reason: su.reason, missing: su.missing }, 409);
  }

  const token = await su.tokens.get();
  lastLogin = {
    ok: token.ok,
    at: new Date().toISOString(),
    reason: token.ok ? null : token.reason,
  };

  if (!token.ok) {
    return c.json({ ok: false, reason: token.reason, environment: su.settings.environment },
      token.kind === "limit" ? 429 : 502);
  }
  return c.json({
    ok: true,
    environment: su.settings.environment,
    /* When the token this server holds runs out; it is renewed on its own
       five minutes before. The token itself stays on the server. */
    validUntil: new Date(token.expiresAt).toISOString(),
    loginsThisHour: su.tokens.usedThisHour(),
    loginsPerHour: TOKENS_PER_HOUR,
  });
});
