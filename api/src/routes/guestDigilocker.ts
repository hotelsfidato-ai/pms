import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { ask, refused, sha256, tooOften } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   DIGILOCKER - a fourth way in, prepared and switched off (D27-235 2.5)

   The owner, 2 October: DigiLocker through API Setu as a DigiLocker partner,
   OFF until the partner keys and the lawyer's answers arrive. It unlocks the
   page like Google - the DigiLocker account's mobile must be the booking's
   own number - and the ID it vouches for waits for the desk as a submission,
   never confirmed by itself. Only the masked Aadhaar number and the name are
   kept; the eAadhaar XML is never fetched (D27-207).

   DigiLocker's own words: Authorized Partner API Specification v2.2
   (October 2022, MeitY/NeGD) - "Get Authorization Code" (PKCE, S256,
   scope openid, acr aadhaar) and "Get Access Token (openid connect)", whose
   id_token carries masked_aadhaar, given_name and phone_number.

     GET  /api/guest/:token/digilocker   {offered} - false while it is off
     POST /api/guest/:token/digilocker   {url}: DigiLocker's sign-in, with a
                                         state and a PKCE challenge; the page
                                         keeps the token in sessionStorage
     POST /api/guest/digilocker/finish   {code, state} from the page DigiLocker
                                         sent the guest back to (a fixed
                                         address, DIGILOCKER_REDIRECT_URI):
                                         {verified, unlock} or a refusal

   No plaintext token or unlock ever travels in an address, and none is kept
   here: the state is stored hashed, the verifier for ten minutes and one
   answer (182). The id_token is read straight from DigiLocker's token
   endpoint over TLS (OpenID Connect Core 3.1.3.7), checked for our client,
   and dropped with the access token at once.

   SETTINGS (names only, in api/.env.example): DIGILOCKER_CLIENT_ID,
   DIGILOCKER_CLIENT_SECRET, DIGILOCKER_REDIRECT_URI. Any one missing: off.
   ══════════════════════════════════════════════════════════════════ */

export const digilocker = new Hono();

const AUTHORIZE = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize";
const TOKEN_URL = "https://digilocker.meripehchaan.gov.in/public/oauth2/2/token";

const NOT_THIS_DIGILOCKER = "That DigiLocker account is not the one on this booking. "
  + "Use the DigiLocker with the booking's mobile number, or ask for a code.";

function settings() {
  const clientId = process.env["DIGILOCKER_CLIENT_ID"]?.trim();
  const clientSecret = process.env["DIGILOCKER_CLIENT_SECRET"]?.trim();
  const redirectUri = process.env["DIGILOCKER_REDIRECT_URI"]?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

/** Whether the door may offer DigiLocker at all - read by the opening answer. */
export const digilockerOn = () => settings() !== null;

type Claims = { aud?: unknown; phone_number?: unknown; masked_aadhaar?: unknown; given_name?: unknown; name?: unknown };

/** The id_token's claims, or null for anything that is not a JWT of an object. */
function claimsOf(idToken: unknown): Claims | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload as Claims : null;
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

digilocker.get("/:token/digilocker", async (c) => {
  if (!settings()) return c.json({ offered: false });
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "open")) return c.json({ offered: false });
  const rows = await ask<{ kind: string; occupied: boolean }>(
    "select kind, occupied from app.guest_link_open($1)", [hash]);
  const it = rows[0];
  return c.json({ offered: !!it && (it.kind === "booking" || it.occupied) });
});

digilocker.post("/:token/digilocker", async (c) => {
  const s = settings();
  if (!s) return refused(c);
  const hash = sha256(c.req.param("token"));
  if (tooOften(hash, "code")) return refused(c);

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_digilocker_begin($1, $2, $3) as ok", [hash, sha256(state), verifier]);
  if (!rows[0]?.ok) return refused(c);

  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: "code", client_id: s.clientId, redirect_uri: s.redirectUri, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", scope: "openid", acr: "aadhaar",
  }).toString();
  return c.json({ url: url.toString() });
});

digilocker.post("/digilocker/finish", async (c) => {
  const s = settings();
  if (!s) return refused(c);
  const b = await c.req.json<{ code?: string; state?: string }>()
    .catch(() => ({}) as { code?: string; state?: string });
  if (!b.code || !b.state) return refused(c);
  const stateHash = sha256(b.state);
  if (tooOften(stateHash, "code")) return refused(c);

  const taken = await ask<{ verifier: string | null }>(
    "select app.guest_digilocker_take($1) as verifier", [stateHash]);
  const verifier = taken[0]?.verifier;
  if (!verifier) return refused(c);

  let claims: Claims | null = null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: b.code, client_id: s.clientId,
        client_secret: s.clientSecret, redirect_uri: s.redirectUri, code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) claims = claimsOf(((await res.json()) as { id_token?: unknown }).id_token);
  } catch (error) {
    console.error("[guest] DigiLocker token endpoint", (error as Error).message);
  }
  if (!claims) return refused(c);

  /* Our client's token, or nothing: an id_token minted for somebody else's
     application is not an answer to us. */
  const aud = claims.aud;
  if (aud !== undefined && aud !== s.clientId && !(Array.isArray(aud) && aud.includes(s.clientId))) {
    return c.json({ verified: false, error: NOT_THIS_DIGILOCKER }, 401);
  }

  const unlock = randomBytes(32).toString("base64url");
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_digilocker_answer($1, $2, $3, $4, $5) as ok",
    [stateHash, text(claims.phone_number), text(claims.masked_aadhaar),
     text(claims.given_name) || text(claims.name), sha256(unlock)]);
  if (!rows[0]?.ok) return c.json({ verified: false, error: NOT_THIS_DIGILOCKER }, 401);
  return c.json({ verified: true, unlock });
});
