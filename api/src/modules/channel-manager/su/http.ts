/* ══════════════════════════════════════════════════════════════════
   THE WIRE TO SU — one function, so a test can stand in for SU

   Until the owner has SU's test keys there is no SU to call, and even
   after, a test that reaches the internet proves the network more than
   the code. So everything that talks to SU takes a `SuTransport`, and the
   tests hand it the example requests and responses from SU's own
   documents.

   SU answers in JSON, and "You may receive some errors even if the
   response HTTP code is 200 OK" (Rates and Availability). So the status
   code travels with the body and the caller reads both.
   ══════════════════════════════════════════════════════════════════ */

export interface SuRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SuResponse {
  status: number;
  /** The parsed body, or null when SU sent something that is not JSON. */
  body: unknown;
}

export type SuTransport = (request: SuRequest) => Promise<SuResponse>;

/* 30 seconds. SU asks for large ARI requests (up to 512 KB) and a year of
   dates at connection; a push that takes longer than this has failed as
   far as anybody waiting on it is concerned, and is retried. */
const TIMEOUT_MS = 30_000;

export const fetchTransport: SuTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
};
