import type { SuSettings } from "./config.ts";
import type { SuTransport } from "./http.ts";

/* ══════════════════════════════════════════════════════════════════
   SU's TOKEN — asked for rarely, kept briefly, never shown

   From SU's "Token Based Authentication":
     GET /SUAPI/jservice/auth/generate-access-token
     headers  client-id, client-secret
     answer   { Status: "Success",
                Data: { token_type: "Bearer", token: "sandbox_…" | "live_…",
                        expire_in: "3600" } }
   - a token is valid for 60 minutes,
   - at most 30 may be generated in a 60-minute window,
   - a sandbox token starts "sandbox_", a live one "live_", and the two
     cannot be used for each other.

   So: one token at a time, reused until five minutes before it lapses;
   one request in flight however many pushes want a token at once; a
   count of what this hour has used, so a fault that loops cannot spend
   SU's 30 and lock every hotel out until the hour turns; and after a
   refusal, a minute before asking again, because a wrong secret asked
   every second is the same wrong secret.

   THE TOKEN AND THE SECRET NEVER LEAVE THIS FILE except as the header SU
   needs. No answer, error or log line carries either.
   ══════════════════════════════════════════════════════════════════ */

export const TOKEN_ENDPOINT = "/SUAPI/jservice/auth/generate-access-token";

/** SU's documented validity, used only if an answer omits `expire_in`. */
const DOCUMENTED_LIFETIME_S = 3600;
/** Renew this long before expiry, so a push never starts on a dying token. */
const RENEW_BEFORE_MS = 5 * 60_000;
/** SU: "A maximum of 30 tokens can be generated … within a 60-minute window". */
export const TOKENS_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;
/** After a refusal, how long before SU is asked again. */
export const RETRY_AFTER_FAILURE_MS = 60_000;

export type TokenResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: string; kind: "login" | "unreachable" | "limit" };

export class SuTokenHolder {
  private current: { token: string; expiresAt: number } | null = null;
  private inFlight: Promise<TokenResult> | null = null;
  private issuedAt: number[] = [];
  private lastFailure: { at: number; result: TokenResult } | null = null;

  /* Longhand, not constructor parameter properties: see client.ts. */
  private readonly settings: SuSettings;
  private readonly transport: SuTransport;
  private readonly now: () => number;

  constructor(settings: SuSettings, transport: SuTransport, now: () => number = Date.now) {
    this.settings = settings;
    this.transport = transport;
    this.now = now;
  }

  /** The token to sign a call with, asking SU for a new one only when needed. */
  async get(): Promise<TokenResult> {
    const now = this.now();
    if (this.current && this.current.expiresAt - RENEW_BEFORE_MS > now) {
      return { ok: true, ...this.current };
    }
    if (this.lastFailure && now - this.lastFailure.at < RETRY_AFTER_FAILURE_MS) {
      return this.lastFailure.result;
    }
    if (!this.inFlight) {
      this.inFlight = this.fetchToken().finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  /** SU said "Authorization Required" to a call signed with the current
      token: drop it, so the next call asks for a fresh one. */
  forget(): void {
    this.current = null;
  }

  /** How many of SU's 30 this hour has used. */
  usedThisHour(): number {
    const since = this.now() - HOUR_MS;
    this.issuedAt = this.issuedAt.filter((t) => t > since);
    return this.issuedAt.length;
  }

  private fail(result: TokenResult & { ok: false }): TokenResult {
    this.lastFailure = { at: this.now(), result };
    return result;
  }

  private async fetchToken(): Promise<TokenResult> {
    if (this.usedThisHour() >= TOKENS_PER_HOUR) {
      const oldest = Math.min(...this.issuedAt);
      const minutes = Math.max(1, Math.ceil((oldest + HOUR_MS - this.now()) / 60_000));
      /* Not recorded as a failure: it clears on its own, and the minute's
         wait would only add to the hour's. */
      return {
        ok: false, kind: "limit",
        reason:
          `SU allows ${TOKENS_PER_HOUR} logins an hour and this hour's are used. `
          + `The next is possible in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }

    let response;
    try {
      response = await this.transport({
        method: "GET",
        url: this.settings.baseUrl + TOKEN_ENDPOINT,
        headers: {
          "client-id": this.settings.clientId,
          "client-secret": this.settings.clientSecret,
        },
      });
    } catch (error) {
      return this.fail({
        ok: false, kind: "unreachable",
        reason: `SU could not be reached (${errorName(error)}). Nothing was sent to it.`,
      });
    }

    const body = asRecord(response.body);
    const data = asRecord(body?.["Data"]);
    const token = typeof data?.["token"] === "string" ? data["token"] : "";

    if (response.status >= 400 || body?.["Status"] !== "Success" || !token) {
      return this.fail({
        ok: false, kind: "login",
        reason: this.scrub(
          "SU refused the login: "
          + (suMessage(body) ?? `it answered ${response.status} with no reason`)
          + ". Check SU_CLIENT_ID and SU_CLIENT_SECRET on the server."),
      });
    }

    if (typeof data?.["token_type"] === "string"
        && data["token_type"].toLowerCase() !== "bearer") {
      return this.fail({
        ok: false, kind: "login",
        reason: "SU answered with a token type this connection does not use.",
      });
    }

    /* A live token from a sandbox login, or the reverse, means the keys
       and SU_ENVIRONMENT disagree. SU would refuse every call with it; a
       test push to the live account would be worse. */
    const expected = this.settings.environment === "live" ? "live_" : "sandbox_";
    if (!token.startsWith(expected)) {
      return this.fail({
        ok: false, kind: "login",
        reason:
          `SU_ENVIRONMENT is ${this.settings.environment}, but SU answered with `
          + `a token for the other account. The keys and SU_ENVIRONMENT must `
          + `be for the same account.`,
      });
    }

    const lifetime = Number(data?.["expire_in"]);
    const seconds = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : DOCUMENTED_LIFETIME_S;
    const issued = this.now();
    this.issuedAt.push(issued);
    this.lastFailure = null;
    this.current = { token, expiresAt: issued + seconds * 1000 };
    return { ok: true, ...this.current };
  }

  /* SU's messages do not echo the keys today. This makes sure no future
     one can carry them to a screen. */
  private scrub(text: string): string {
    let out = text;
    for (const secret of [this.settings.clientSecret, this.settings.clientId]) {
      if (secret) out = out.split(secret).join("[hidden]");
    }
    return out;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;
}

/* SU writes a failure four ways across its documents:
     { Status: "Fail", Errors: [{ Code, ShortText }] }
     { Status: "Fail", Errors: { Code, ShortText } }
     { Status: "Fail", Error:  { Code, ShortText } }
     { status: "Fail", response: "…" }
   and sometimes a top-level Message. The first readable one wins. */
export function suError(body: unknown): { code: string | null; text: string | null } {
  const record = asRecord(body);
  if (!record) return { code: null, text: null };
  const candidates: unknown[] = [];
  const errors = record["Errors"];
  if (Array.isArray(errors)) candidates.push(...errors);
  else candidates.push(errors);
  candidates.push(record["Error"]);
  for (const candidate of candidates) {
    const e = asRecord(candidate);
    const text = typeof e?.["ShortText"] === "string" ? e["ShortText"].trim() : "";
    if (text) {
      return { code: e?.["Code"] != null ? String(e["Code"]) : null, text };
    }
  }
  for (const key of ["Message", "message", "response"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return { code: null, text: value.trim() };
  }
  return { code: null, text: null };
}

export const suMessage = (body: unknown): string | null => suError(body).text;

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "no answer in 30 seconds" : error.name;
  }
  return "unknown error";
}
