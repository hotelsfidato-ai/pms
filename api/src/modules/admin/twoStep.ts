import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { withUser } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   TWO-STEP SIGN-IN, WITH AN AUTHENTICATOR APP (D27-384, D27-396)

   Firebase's own second step needs a paid plan, so it is ours: the
   password is Firebase's, the 6-digit code is this file's, and the
   database keeps the key and every code typed (migration "two-step sign-in").

     GET   /api/me/two-step            where the signed-in person stands
     POST  /api/me/two-step/setup      a new key, as a QR code's text
     POST  /api/me/two-step            a code: confirms the key (and hands back
                                       10 recovery codes, once), or passes this
                                       sign-in; a recovery code works once
     POST  /api/admin/staff/:id/two-step/off   switched off by the owner or an
                                       Admin (a lost phone), with a reason
     PUT   /api/admin/two-step-required        the group's setting, off by default

   PER SIGN-IN, NOT PER REQUEST. server.ts asks `twoStepRefusal` for every
   person's request: a sign-in (Firebase's auth_time) that owes a code is
   answered 403 with `twoStep: "code" | "setup"`, except on the routes
   above under /api/me/two-step. A sign-in that owes nothing is not asked
   again for a minute (as auth.ts asks Google).

   THE CODE (RFC 6238): HMAC-SHA1 of the 30-second step, six digits, one step
   either side of now for a phone's clock, and never a step already taken.
   ══════════════════════════════════════════════════════════════════ */

export const twoStep = new Hono<{ Variables: { subject: string; authTime?: number } }>();

const STEP_SECONDS = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return bits > 0 ? out + B32[(value << (5 - bits)) & 31] : out;
}

function fromBase32(text: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of text) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The six digits an authenticator shows for this key at this step. */
export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const at = h[19]! & 15;
  return String((h.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The step a typed code is right for - now, or one either side - and never
    one already taken; null when it is right for none. */
function stepOf(secret: string, code: string, lastStep: number | null): number | null {
  const now = stepAt(Date.now());
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/* A recovery code: ten letters and digits, read in two fives. Kept only as
   the sha256 of what is left after spaces, dashes and case are dropped. */
const plain = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const recoveryHash = (code: string) => createHash("sha256").update(plain(code)).digest("hex");
const newRecoveryCode = () => {
  const s = base32(randomBytes(7)).slice(0, 10).toLowerCase();
  return `${s.slice(0, 5)}-${s.slice(5)}`;
};

/* ── The gate, asked by server.ts ───────────────────────────────── */

const SAY = {
  code: "Two-step sign-in: type the 6-digit code from your authenticator app to go on.",
  setup: "Your role needs two-step sign-in. Set it up to go on.",
} as const;
const DOOR = /^\/api\/me\/two-step(\/|$)/;
const FREE_FOR_MS = 60_000;
const free = new Map<string, number>();

async function stateOf(subject: string, authTime: number): Promise<string | null> {
  return withUser(subject, async (client) => (await client.query<{ s: string | null }>(
    "select app.two_step_state(to_timestamp($1)) as s", [authTime])).rows[0]!.s);
}

/** Null when this sign-in may go on; otherwise the 403's body. */
export async function twoStepRefusal(subject: string, authTime: number, path: string) {
  if (DOOR.test(path)) return null;
  const key = `${subject}:${authTime}`;
  if ((free.get(key) ?? 0) > Date.now()) return null;
  const state = await stateOf(subject, authTime);
  if (state === "code" || state === "setup") return { ok: false as const, error: SAY[state], twoStep: state };
  /* ponytail: a cap, not an LRU; the next ask fills it again. */
  if (free.size >= 10_000) free.clear();
  free.set(key, Date.now() + FREE_FOR_MS);
  return null;
}

/* ── The routes ──────────────────────────────────────────────────── */

const refuse = (reason: string) => ({ ok: false as const, reason, error: reason });
const STATUS: Record<string, 403 | 409 | 429> = { "42501": 403, "23514": 409, "54000": 429 };

/** A refusal the database raised, as its status and sentence; anything else rethrown. */
function refusalOf(error: unknown): { status: 403 | 409 | 429; body: ReturnType<typeof refuse> } {
  const status = STATUS[(error as { code?: string }).code ?? ""];
  if (!status) throw error;
  return { status, body: refuse((error as Error).message) };
}

twoStep.get("/me/two-step", async (c) => {
  const row = await withSession(c.get("subject"), async (client) =>
    (await client.query<{ state: string; recovery_left: number | null; required: boolean }>(
      "select * from app.my_two_step(to_timestamp($1))", [c.get("authTime") ?? 0])).rows[0]!);
  return c.json({
    state: row.state, on: row.state === "code" || row.state === "passed",
    recoveryLeft: row.recovery_left, required: row.required,
  });
});

twoStep.post("/me/two-step/setup", async (c) => {
  const secret = base32(randomBytes(20));
  try {
    const { email, issuer } = await withSession(c.get("subject"), async (client, session) => {
      await client.query("select app.two_step_begin($1)", [secret]);
      /* The group's name in the app, never a name written here (D21-27). */
      const name = (await client.query<{ name: string | null }>("select name from group_settings")).rows[0]?.name;
      return { email: session.email, issuer: name || "Hotel PMS" };
    });
    const label = encodeURIComponent(`${issuer}:${email}`);
    return c.json({
      ok: true as const,
      key: secret.match(/.{4}/g)!.join(" "),
      uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`,
    });
  } catch (error) {
    const r = refusalOf(error);
    return c.json(r.body, r.status);
  }
});

twoStep.post("/me/two-step", async (c) => {
  const { code } = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  const typed = typeof code === "string" ? code.trim() : "";
  if (!typed) return c.json(refuse("Type the code first."), 409);
  const authTime = c.get("authTime") ?? 0;
  try {
    const answer = await withSession(c.get("subject"), async (client, session) => {
      const t = (await client.query<{
        attempt: string; secret: string; last_step: string | null; confirmed: boolean; recovery: string[];
      }>("select * from app.two_step_try(to_timestamp($1))", [authTime])).rows[0]!;
      const step = /^\d{6}$/.test(typed)
        ? stepOf(t.secret, typed, t.last_step === null ? null : Number(t.last_step)) : null;
      const used = step === null && t.confirmed && t.recovery.includes(recoveryHash(typed))
        ? recoveryHash(typed) : null;
      if (step === null && used === null) {
        /* Kept as a wrong try by app.two_step_try (this transaction commits it). */
        console.warn(`[two-step] a wrong code for ${session.email}`);
        return null;
      }
      const fresh = t.confirmed ? null : Array.from({ length: 10 }, newRecoveryCode);
      const left = (await client.query<{ left: number }>(
        "select app.two_step_passed($1, $2, $3, $4) as left",
        [t.attempt, step, used, fresh?.map(recoveryHash) ?? null])).rows[0]!.left;
      return { ok: true as const, recoveryLeft: left, ...(fresh ? { recoveryCodes: fresh } : {}) };
    });
    if (!answer) {
      return c.json(refuse("That code is not right. The app shows a new one every 30 seconds: type the one showing now."), 409);
    }
    free.set(`${c.get("subject")}:${authTime}`, Date.now() + FREE_FOR_MS);
    return c.json(answer);
  } catch (error) {
    const r = refusalOf(error);
    return c.json(r.body, r.status);
  }
});

twoStep.post("/admin/staff/:id/two-step/off", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json(refuse("No such person."), 404);
  const { reason } = await c.req.json<{ reason?: unknown }>().catch(() => ({ reason: undefined }));
  try {
    await withSession(c.get("subject"), (client) =>
      client.query("select app.two_step_off($1, $2)", [id, typeof reason === "string" ? reason : null]));
    return c.json({ ok: true as const });
  } catch (error) {
    const r = refusalOf(error);
    return c.json(r.body, r.status);
  }
});

twoStep.put("/admin/two-step-required", async (c) => {
  const { required } = await c.req.json<{ required?: unknown }>().catch(() => ({ required: undefined }));
  if (typeof required !== "boolean") return c.json(refuse("Say on or off."), 409);
  try {
    await withSession(c.get("subject"), (client) =>
      client.query("select app.set_two_step_required($1)", [required]));
    return c.json({ ok: true as const, required });
  } catch (error) {
    const r = refusalOf(error);
    return c.json(r.body, r.status);
  }
});
