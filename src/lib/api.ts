import { auth } from "./firebase";

/* ══════════════════════════════════════════════════════════════════
   THE API CLIENT

   One place that knows how to reach the App API, and one place that
   knows how a request is authenticated. Screens never touch this —
   they go through `@/data/repositories`, which is the seam. Identity
   is the exception: who you are is not repository data.
   ══════════════════════════════════════════════════════════════════ */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

/**
 * Development only, and it mirrors the API's own `ALLOW_DEV_AUTH`.
 * There is no Firebase service account locally, so the interface names
 * the caller with a header instead. The API refuses to start this way
 * in production, so a build that reaches a deployed box cannot use it
 * even if this flag were left on by accident.
 */
export const devAuth = import.meta.env.VITE_ALLOW_DEV_AUTH === "1";

/* Set by the session store when signing in through the dev path.
   Kept in sessionStorage so a reload does not sign you out: a real
   Firebase session survives one, and a dev session that did not would
   make "check in, reload, still checked in" impossible to demonstrate.

   sessionStorage, not localStorage — it dies with the tab, so a shared
   machine does not inherit the last person's dev identity. */
const DEV_KEY = "fidato.dev-subject";

const readStored = (): string | null => {
  if (!devAuth) return null;
  try {
    return sessionStorage.getItem(DEV_KEY);
  } catch {
    /* Private mode, or storage disabled. Not a reason to fail. */
    return null;
  }
};

let devSubject: string | null = readStored();

export const getDevSubject = () => devSubject;

export const setDevSubject = (subject: string | null) => {
  devSubject = subject;
  try {
    if (subject) sessionStorage.setItem(DEV_KEY, subject);
    else sessionStorage.removeItem(DEV_KEY);
  } catch {
    /* The session still works for this page load. */
  }
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed error body, when there was one.

        A refusal often carries more than a sentence. The till answers a
        room with two open folios with the reason AND both guests, so
        the waiter can pick one — and that payload used to be dropped
        here, leaving "Request failed (409)" and no way to choose. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A 401 means sign in again, not "something went wrong". */
  get isUnauthenticated() {
    return this.status === 401;
  }
}

async function headers(): Promise<HeadersInit> {
  const base: Record<string, string> = { "content-type": "application/json" };

  if (devAuth && devSubject) {
    base["x-dev-staff-id"] = devSubject;
    return base;
  }

  const user = auth?.currentUser;
  if (user) {
    /* getIdToken refreshes when the token is near expiry, so a clerk
       on a twelve-hour shift is not signed out mid-check-in. */
    base["authorization"] = `Bearer ${await user.getIdToken()}`;
  }
  return base;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(await headers()), ...init.headers },
    });
  } catch {
    /* fetch rejects without detail when the request never happened, and
       a blocked CORS preflight looks exactly like a dead server from
       here — the browser withholds the difference on purpose. Naming
       both beats confidently naming the wrong one. */
    throw new ApiError(
      0,
      import.meta.env.DEV
        ? `Could not reach ${BASE}. Check the API is running, and that it allows this origin.`
        : "Could not reach the server. Try again in a moment.",
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; reason?: string }
      | null;
    /* `error` first, because that is what every route written before
       the till returns and what `setHousekeeping` reads. `reason` is
       the till's shape — a refusal a person acts on rather than a
       fault. Falling through to neither is still a real failure. */
    throw new ApiError(
      response.status,
      body?.error ?? body?.reason ?? `Request failed (${response.status}).`,
      body ?? undefined,
    );
  }

  return (await response.json()) as T;
}

/* ── Shapes the API returns ──────────────────────────────────────── */

export interface ApiHotel {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string | null;
  gstin: string | null;
  timezone: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  /* This property's OWN operating day. Two hotels are routinely on
     different dates — one has run its night audit and the other has
     not — so it arrives per hotel, not once for the group. */
  businessDate: string;
}

export interface ApiScope {
  staffId: string;
  email: string;
  fullName: string;
  isGroupAdmin: boolean;
  /** Where this person may WORK. Empty for a group admin — see below. */
  hotels: Array<{ hotelId: string; role: string }>;
}

export interface HotelsResponse {
  scope: ApiScope;
  /** Every property this person may READ. Not the same list. */
  hotels: ApiHotel[];
}

export const getSession = () => api<HotelsResponse>("/api/hotels");
