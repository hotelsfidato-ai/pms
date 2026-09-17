import type { SuSettings } from "./config.ts";
import type { SuTransport } from "./http.ts";
import { asRecord, suError, type SuTokenHolder } from "./token.ts";

/* ══════════════════════════════════════════════════════════════════
   A CALL TO SU — signed, read, and answered in one shape

   Every SU endpoint the channel manager uses goes through `call`, so
   three things are decided once:

   1. SIGNING. `Authorization: Bearer <token>`, never Basic (SU is retiring
      basic authentication). A call SU answers with "Authorization
      Required" (497, or 401) drops the token and is tried ONCE more with
      a fresh one: a token can lapse between being handed out and being
      used. Twice is not a lapse, it is a wrong key, and it is reported.

   2. READING. SU answers HTTP 200 with `Status: "Fail"` for most refusals,
      so the body decides, not the status code. Success is `Success` or,
      for queued work, `enqueued`; a body with no status at all (the
      reservations list, the room list) is data.

   3. SAYING WHAT HAPPENED. `kind` is what the caller acts on:
        not_configured  the owner has not set the keys
        login           the keys do not work
        limit           SU's hourly cap (5,000 ARI calls a property,
                        30 tokens) — wait, do not retry in a loop
        unreachable     no answer; nothing is known to have happened
        refused         SU read the request and said no; `code` is SU's
   ══════════════════════════════════════════════════════════════════ */

export type SuFailureKind = "not_configured" | "login" | "limit" | "unreachable" | "refused";

export type SuResult<T> =
  | { ok: true; data: T; status: string | null }
  | { ok: false; kind: SuFailureKind; code: string | null; reason: string };

const AUTH_REQUIRED = /authorization required/i;
const LIMIT_REACHED = /limit has been reached/i;

export class SuClient {
  /* Written out, not parameter properties: the server strips types and emits
     nothing, so a parameter property is never assigned (CM-3). */
  readonly settings: SuSettings;
  private readonly transport: SuTransport;
  private readonly tokens: SuTokenHolder;

  constructor(settings: SuSettings, transport: SuTransport, tokens: SuTokenHolder) {
    this.settings = settings;
    this.transport = transport;
    this.tokens = tokens;
  }

  post<T = unknown>(endpoint: string, payload: unknown): Promise<SuResult<T>> {
    return this.call<T>("POST", endpoint, payload, true);
  }

  get<T = unknown>(endpoint: string): Promise<SuResult<T>> {
    return this.call<T>("GET", endpoint, undefined, true);
  }

  private async call<T>(
    method: "GET" | "POST",
    endpoint: string,
    payload: unknown,
    mayRetry: boolean,
  ): Promise<SuResult<T>> {
    const token = await this.tokens.get();
    if (!token.ok) {
      return { ok: false, kind: token.kind, code: null, reason: token.reason };
    }

    let response;
    try {
      response = await this.transport({
        method,
        url: this.settings.baseUrl + endpoint,
        headers: {
          authorization: `Bearer ${token.token}`,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch (error) {
      const name = error instanceof Error && error.name === "TimeoutError"
        ? "no answer in 30 seconds" : error instanceof Error ? error.name : "unknown error";
      return {
        ok: false, kind: "unreachable", code: null,
        reason: `SU could not be reached (${name}). It may or may not have received the request.`,
      };
    }

    const body = response.body;
    const record = asRecord(body);
    const status = typeof record?.["Status"] === "string" ? record["Status"]
      : typeof record?.["status"] === "string" ? record["status"] : null;
    const error = suError(body);

    const authFailed = response.status === 401
      || error.code === "497"
      || AUTH_REQUIRED.test(error.text ?? "");
    if (authFailed) {
      this.tokens.forget();
      if (mayRetry) return this.call<T>(method, endpoint, payload, false);
      return {
        ok: false, kind: "login", code: error.code,
        reason: "SU refused this server's login twice in a row. Check the SU keys on the server.",
      };
    }

    if (LIMIT_REACHED.test(error.text ?? "")) {
      return {
        ok: false, kind: "limit", code: error.code,
        reason: "SU's hourly limit for this property is reached. Updates wait for the next hour.",
      };
    }

    const failed = response.status >= 400
      || (status !== null && /^fail/i.test(status))
      || (body === null && response.status !== 204);
    if (failed) {
      return {
        ok: false, kind: "refused", code: error.code,
        reason: error.text
          ? `SU refused it: ${error.text}`
          : `SU refused it (HTTP ${response.status}) and gave no reason.`,
      };
    }

    return { ok: true, data: body as T, status };
  }
}
