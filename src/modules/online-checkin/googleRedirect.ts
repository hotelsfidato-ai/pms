/* ══════════════════════════════════════════════════════════════════
   CONTINUE WITH GOOGLE, WITH NO SCRIPT OF GOOGLE'S (OCI-10, D27-239 8.4)

   Until 2 October this page loaded Google's own script (Google Identity
   Services) on the press - somebody else's code on the one page a stranger
   opens, able to read the link and this phone's unlock. Now the guest leaves
   for Google's own page and comes back:

     1. "Continue with Google" sends the whole tab to Google's sign-in
        (OpenID Connect, response_type=id_token), with this system's client
        id, the return address /g-return, a nonce and a state.
     2. Google answers at /g-return, in the address's FRAGMENT - which a
        browser never sends to any server.
     3. pages/GoogleReturn.tsx checks the state is this tab's, posts Google's
        signed answer and the nonce to the door, and opens the booking.

   THE GUEST'S LINK NEVER GOES TO GOOGLE: it waits in this tab's own
   sessionStorage with the state and the nonce, and is taken out once. The
   door checks Google's answer exactly as before (D27-207), and the nonce.

   No Firebase, no account: the answer is used once, for the unlock.
   ══════════════════════════════════════════════════════════════════ */

const KEPT = "google-sign-in";
const GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth";
/** Registered in the Google client as an Authorized redirect URI (OWNER-STEPS). */
export const RETURN_PATH = "/g-return";

/** 16 random bytes, as letters, digits, - and _. */
function random(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The browser leaving this page - an object, so a test can stand in for it. */
export const browser = {
  leaveFor(url: string): void { window.location.assign(url); },
};

export function continueWithGoogle(token: string, clientId: string): void {
  const state = random();
  const nonce = random();
  try {
    sessionStorage.setItem(KEPT, JSON.stringify({ state, nonce, token }));
  } catch { /* a tab with no storage: the return finds nothing and says so */ }
  const ask = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}${RETURN_PATH}`,
    response_type: "id_token",
    scope: "openid email",
    nonce,
    state,
    prompt: "select_account",
  });
  browser.leaveFor(`${GOOGLE}?${ask}`);
}

export type GoogleAnswer =
  | { ok: true; token: string; credential: string; nonce: string }
  | { ok: false; token: string | null };

/** Google's answer from the address's fragment, held against what THIS tab
    kept when it left - and the kept record is taken out, so it is used once. */
export function takeGoogleAnswer(fragment: string): GoogleAnswer {
  let kept: { state?: string; nonce?: string; token?: string } = {};
  try {
    kept = JSON.parse(sessionStorage.getItem(KEPT) ?? "{}") as typeof kept;
    sessionStorage.removeItem(KEPT);
  } catch { /* nothing kept */ }
  const answer = new URLSearchParams(fragment.replace(/^#/, ""));
  const credential = answer.get("id_token");
  const token = typeof kept.token === "string" ? kept.token : null;
  if (!token || !kept.state || !kept.nonce || !credential || answer.get("state") !== kept.state) {
    return { ok: false, token };
  }
  return { ok: true, token, credential, nonce: kept.nonce };
}
