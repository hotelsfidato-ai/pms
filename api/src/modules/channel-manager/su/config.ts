/* ══════════════════════════════════════════════════════════════════
   SU's SETTINGS — read from the server's environment, and nowhere else

   D17-66: the owner chose SU. SU gives a PMS partner a client id and a
   client secret; with them the PMS asks SU for a short-lived token and
   signs every call with it. The secret is a key to every hotel we
   connect, so it lives where the Firebase key lives: in `api/.env` on the
   server, set by the owner. Never in the repository, a screen, a test
   file, a log line or a chat.

       SU_ENVIRONMENT    sandbox | live
       SU_CLIENT_ID      from SU when the account is made
       SU_CLIENT_SECRET  generated on SU's extranet

   THE ADDRESS IS NOT A SETTING. SU has exactly two hosts, and the secret
   is sent in a header to whichever one we call. A free-text base URL
   would let one mistyped line hand the secret to somebody else's server,
   so the environment names WHICH of SU's two hosts, and the host comes
   from the list below.

   Read at call time, not at import: `env.ts` loads `api/.env` into
   process.env when the server starts, and a value captured before that
   would be "not set" for the life of the process.
   ══════════════════════════════════════════════════════════════════ */

/* ── The key SU presents when it pushes a booking to us ──────────────
   D17-79: SU pushes each booking the moment it happens, to one address on
   this server. That address is open to the internet, so SU proves a call is
   its own with a key the owner generates, gives to SU on SU's extranet, and
   sets here. It is a password: it lives in `api/.env` on the server and
   nowhere else - not in the repository, not in a test, not in a message.
   Absent means the door refuses everything, which is the right answer for a
   server nobody has set up to receive bookings. */
export const readSuPushKey = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | null => (source["SU_PUSH_KEY"] ?? "").trim() || null;

export type SuEnvironment = "sandbox" | "live";

/* From SU's "Getting Started" and "Certification": the same APIs on both,
   only the host and the keys differ. */
export const SU_HOSTS: Readonly<Record<SuEnvironment, string>> = {
  sandbox: "https://connect-sandbox.su-api.com",
  live: "https://connect.su-api.com",
};

export interface SuSettings {
  environment: SuEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export type SuSettingsResult =
  | { ok: true; settings: SuSettings }
  | { ok: false; missing: string[]; reason: string };

const NAMES = ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"] as const;

export function readSuSettings(
  source: Readonly<Record<string, string | undefined>> = process.env,
): SuSettingsResult {
  const value = (name: string) => (source[name] ?? "").trim();
  const missing = NAMES.filter((n) => !value(n));

  if (missing.length > 0) {
    return {
      ok: false,
      missing: [...missing],
      reason:
        "SU is not set up on this server yet. The owner adds "
        + `${missing.join(", ")} to the server's settings file.`,
    };
  }

  const environment = value("SU_ENVIRONMENT").toLowerCase();
  if (environment !== "sandbox" && environment !== "live") {
    return {
      ok: false,
      missing: [],
      /* The value itself is not secret, but echoing whatever was typed
         into a settings file back to a screen is a habit worth not
         having. */
      reason: "SU_ENVIRONMENT must be sandbox (SU's test account) or live.",
    };
  }

  return {
    ok: true,
    settings: {
      environment,
      baseUrl: SU_HOSTS[environment],
      clientId: value("SU_CLIENT_ID"),
      clientSecret: value("SU_CLIENT_SECRET"),
    },
  };
}
