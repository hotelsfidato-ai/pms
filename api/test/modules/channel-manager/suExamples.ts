/* ══════════════════════════════════════════════════════════════════
   SU's OWN EXAMPLES — what SU's documents say it sends back

   Copied from https://suissu.gitbook.io/su-api-documentation/su-channel-manager
   (read 16–17 September 2026). The shapes are SU's; only the token strings
   are shortened, because a real token is 300 characters of noise. Nothing
   here is a working key: until the owner has SU's test account, these are
   the only SU there is.
   ══════════════════════════════════════════════════════════════════ */

import type { SuRequest, SuResponse, SuTransport } from "../../../src/modules/channel-manager/su/http.ts";

/* "Token Based Authentication" → "Success Response - For Sandbox" */
export const TOKEN_SANDBOX = {
  Status: "Success",
  Data: {
    token_type: "Bearer",
    token: "sandbox_eyJpdiI6InVTL013bmlpc3VMZVVISmxqNldMMVE9PSIs-EXAMPLE",
    expire_in: "3600",
  },
  Message: "Access Token generated successfully",
};

/* "Success Response - For Production" */
export const TOKEN_LIVE = {
  Status: "Success",
  Data: {
    token_type: "Bearer",
    token: "live_eyJpdiI6IlI1NGR6dndiRTNpci9lcGRZSm8wMXc9PSIs-EXAMPLE",
    expire_in: "3600",
  },
  Message: "Access Token generated successfully",
};

/* "Property Listing" → "Sample Error Response (497)" — what SU says to a
   call whose token is wrong or has lapsed. */
export const AUTHORIZATION_REQUIRED = {
  Status: "Fail",
  Errors: { Code: "497", ShortText: "Authorization Required" },
};

/* "Rates and Availability" → the hourly cap, and a success. */
export const LIMIT_REACHED = {
  Status: "Fail",
  Errors: [{ ShortText: "Limit has been reached" }],
};
export const ARI_SUCCESS = { Status: "Success", TicketId: "159870515681827209466" };

/* "Rates and Availability" → "Sample Error Response (873)", answered with
   HTTP 200 — SU's "errors even if the response HTTP code is 200 OK". */
export const PRICE_REFUSED = {
  Status: "Fail",
  Errors: [{ Code: "873", ShortText: "price: Value is not a nonnegative (a non-negative number), found '2900r.00'" }],
};

/* A pretend SU: answers each request with the next scripted answer and
   remembers what it was sent. */
export function scriptedSu(
  ...answers: Array<SuResponse | ((req: SuRequest) => SuResponse | Promise<SuResponse>) | Error>
) {
  const sent: SuRequest[] = [];
  let i = 0;
  const transport: SuTransport = async (req) => {
    sent.push(req);
    const next = answers[Math.min(i, answers.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(req) : next!;
  };
  return { transport, sent };
}

export const ok200 = (body: unknown): SuResponse => ({ status: 200, body });
