import {
  ruleFor, enqueue, noteReachable, noteUnreachable,
} from "./offline";
import { auth } from "./firebase";

/* ══════════════════════════════════════════════════════════════════
   THE API CLIENT

   One place that knows how to reach the App API, and one place that
   knows how a request is authenticated. Screens never touch this —
   they go through `@/data/repositories`, which is the seam. Identity
   is the exception: who you are is not repository data.
   ══════════════════════════════════════════════════════════════════ */

/* WHERE THE API LIVES IS A RUNTIME FACT, NOT A BUILD-TIME ONE.

   Vite inlines VITE_* at build. Baking the address in means moving the
   backend — to another provider, to a standby during an outage — forces
   a rebuild and redeploy of every client that talks to it. That is the
   opposite of the portability this system is designed around, and it is
   the one thing that would actually tie us to a vendor.

   `config.json` sits beside index.html. Moving the backend becomes
   editing one file and redeploying static assets: seconds, no rebuild,
   no DNS wait.

   The build-time value remains the fallback, so local development
   needs no extra file. */
const FALLBACK_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

let baseResolution: Promise<string> | null = null;

/* Exported for the outbox drain, which has to build the same request
   this file would have built — same base, same auth. A second copy of
   either is a second thing to get wrong. */
export function apiBase(): Promise<string> {
  /* Resolved once per page load and memoised. Same-origin, so it costs
     no preflight; a missing or malformed file falls back rather than
     breaking every screen, because an unreachable API is a far more
     legible failure than an app that will not start. */
  baseResolution ??= fetch("/config.json", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ apiUrl?: string }>) : null))
    .then((c) => c?.apiUrl?.trim() || FALLBACK_BASE)
    .catch(() => FALLBACK_BASE);
  return baseResolution;
}

/**
 * Development only, and it mirrors the API's own `ALLOW_DEV_AUTH`.
 * There is no Firebase service account locally, so the interface names
 * the caller with a header instead. The API refuses to start this way
 * in production, so a build that reaches a deployed box cannot use it
 * even if this flag were left on by accident.
 */
/* ⚠ AND ONLY ON THE DEV SERVER. `import.meta.env.DEV` is false in EVERY
   `vite build`, whatever the .env files say, and Vite writes it in as a
   literal — so in a production bundle this is `false`, every branch
   behind it is dead, and the minifier drops the test sign-ins, the
   "view as" switcher and the x-dev-staff-id header outright.

   Asked for on 14 September: "for production remove it, so there are no
   issues". Before this the buttons were hidden in production by
   .env.production blanking the flag — correct, but one edited .env away
   from shipping. `scripts/check-no-dev-login.mjs` now fails the build if
   any trace of it reaches `dist`. */
export const devAuth =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_AUTH === "1";

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
/* WHEN this dev sign-in happened, as Firebase's auth_time says it for a real
   one: two-step sign-in asks once per sign-in (D27-396), so each dev sign-in
   is a new one and a reload is not. */
const DEV_SIGN_IN_KEY = "fidato.dev-sign-in";
let devSignIn: string | null = (() => {
  try { return devAuth ? sessionStorage.getItem(DEV_SIGN_IN_KEY) : null; } catch { return null; }
})();

export const getDevSubject = () => devSubject;

export const setDevSubject = (subject: string | null) => {
  /* A no-op without devAuth, so a production bundle does not even carry
     the storage key's name — sign-out calls this unconditionally. */
  if (!devAuth) return;
  devSubject = subject;
  devSignIn = subject ? String(Math.floor(Date.now() / 1000)) : null;
  try {
    if (subject) sessionStorage.setItem(DEV_KEY, subject);
    else sessionStorage.removeItem(DEV_KEY);
    if (devSignIn) sessionStorage.setItem(DEV_SIGN_IN_KEY, devSignIn);
    else sessionStorage.removeItem(DEV_SIGN_IN_KEY);
  } catch {
    /* The session still works for this page load. */
  }
};

/**
 * A write that never left the machine and is now in the outbox.
 *
 * NOT an ApiError, and that is the whole design. Every repository in
 * this codebase already ends its catch with
 *
 *     if (error instanceof ApiError) return { allowed: false, reason };
 *     throw error;
 *
 * so a held write propagates past all of them untouched, and a screen
 * sees it as thrown rather than as a refusal. Making this an ApiError
 * would have `setHousekeeping` convert a successful queue into
 * "Could not update" — which is defect 49 exactly: the ApiError
 * conversion swallowing the one case the feature exists for.
 */
export class HeldError extends Error {
  constructor(
    message: string,
    readonly entryId: string,
    /** True when the person should be told this is not confirmed —
        a check-in, where another desk may take the room first. */
    readonly warn: boolean,
  ) {
    super(message);
    this.name = "HeldError";
  }
}

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

/**
 * Who is signed in, as a stable identifier.
 *
 * Used to stamp an outbox entry with the person who ACTED, because a
 * front desk is a shared machine: one PC, four clerks, one browser
 * profile. Without this a change queued by the morning clerk drains
 * under whoever is signed in when the line returns, and `raised_by`,
 * `posted_by` and `checked_in_by` all name the wrong person.
 *
 * This project puts "who said so" in the schema everywhere —
 * `banquet_events.registered_by` is NOT NULL for exactly that reason —
 * and the queue was quietly throwing it away.
 */
export function currentSubject(): string {
  if (devAuth && devSubject) return devSubject;
  return auth?.currentUser?.uid ?? "";
}

export async function authHeaders(): Promise<HeadersInit> {
  const base: Record<string, string> = { "content-type": "application/json" };

  if (devAuth && devSubject) {
    base["x-dev-staff-id"] = devSubject;
    if (devSignIn) base["x-dev-sign-in"] = devSignIn;
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
  const base = await apiBase();

  let response: Response;

  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(await authHeaders()), ...init.headers },
    });
  } catch {
    /* ── The request never happened ──────────────────────────────
       fetch rejects without detail when nothing left the machine, and
       a blocked CORS preflight looks exactly like a dead server from
       here — the browser withholds the difference on purpose.

       THIS IS ALSO WHERE OFFLINE LIVES, because it is the one place
       every request in the application already passes through. A tier
       decided per screen is a rule written forty times, and defect 96
       is what that costs.

       `navigator.onLine` is not consulted. It reports TRUE on a wifi
       with no route out — the commonest hotel failure, where the
       access point is up and the line is down — and defect 49 paid
       for believing it. A request that did not arrive is the evidence. */
    noteUnreachable();

    const method = (init.method ?? "GET").toUpperCase();

    if (method === "GET" || method === "HEAD") {
      /* Reads are NOT queued. They are answered from the query cache,
         which can say how old the answer is; a read held for later is
         a question nobody is still asking. */
      throw new ApiError(
        0,
        import.meta.env.DEV
          ? `Could not reach ${base}. Check the API is running, and that it allows this origin.`
          : "Could not reach the server. Showing the last data received.",
      );
    }

    /* THE BODY, because one address carries four different acts: a bill
       settled to a room may be held, and the same endpoint settling cash
       may not. `ruleFor` explains at length why this is the only write
       whose tier is not decided by its path alone. */
    const rule = ruleFor(
      path, method,
      typeof init.body === "string" ? init.body : undefined,
    );

    if (rule.tier === "refuse") {
      /* REFUSED, not silently dropped and not optimistically queued:
         a write that silently does nothing is the exact defect this
         project keeps finding. The sentence says why and what to do
         instead, because a refusal a person cannot act on is just a
         failure with better manners. */
      throw new ApiError(503, rule.reason!, { reason: rule.reason });
    }

    /* Held. The idempotency key is minted inside enqueue, once, and
       reused on every retry — `folio_postings.idempotency_key` has
       waited for this since migration 011. */
    const entry = await enqueue({
      label: rule.label,
      path,
      method,
      body: typeof init.body === "string" ? init.body : undefined,
      hotelId: path.match(/\/api\/hotels\/([^/]+)/)?.[1] ?? "",
      /* WHOSE ACT THIS WAS. Not who happens to be signed in when the
         line comes back. */
      subject: currentSubject(),
    });

    throw new HeldError(
      rule.tier === "queue-warn"
        ? `${rule.label} is held and will be sent when the connection is back. `
          + "It is not confirmed until then - the room could be taken by "
          + "another desk in the meantime."
        : `${rule.label} is held and will be sent when the connection is back.`,
      entry.id,
      rule.tier === "queue-warn",
    );
  }

  /* Something answered, so the line is up whatever navigator.onLine
     believes. A 500 is still evidence of reachability. */
  noteReachable();

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; reason?: string; message?: string }
      | null;
    /* `error` first, because that is what every route written before
       the till returns and what `setHousekeeping` reads. `reason` is
       the till's shape — a refusal a person acts on rather than a
       fault. Falling through to neither is still a real failure. */
    throw new ApiError(
      response.status,
      body?.error ?? body?.reason ?? body?.message ?? `Request failed (${response.status}).`,
      body ?? undefined,
    );
  }

  return (await response.json()) as T;
}

/* ── A file from the API ─────────────────────────────────────────────
   A report as a PDF, a spreadsheet or a CSV (D17-31, D17-32); later a bill.
   A plain link cannot carry the sign-in, so the file is fetched here with
   it and handed to the browser to save, under the name the server gave in
   Content-Disposition (which the API exposes to the website's origin;
   without that the browser hides it).

   A download is a read, but there is no cached copy of a file, so when the
   server cannot be reached it is refused in a sentence rather than held. */

/** The file name in a Content-Disposition header, or null. */
export function filenameFrom(disposition: string | null): string | null {
  const m = /filename="([^"]+)"/.exec(disposition ?? "");
  return m ? m[1]! : null;
}

/** Fetches `path` with the sign-in and saves it. Resolves to the file's name. */
export async function downloadFile(path: string): Promise<string> {
  const base = await apiBase();
  let response: Response;
  try {
    /* No content-type: a GET for a file carries no body. */
    const headers = { ...((await authHeaders()) as Record<string, string>) };
    delete headers["content-type"];
    response = await fetch(`${base}${path}`, { headers });
  } catch {
    noteUnreachable();
    throw new ApiError(0, "Could not reach the server, so the file was not downloaded. Try again when the connection is back.");
  }
  noteReachable();

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; reason?: string; message?: string }
      | null;
    throw new ApiError(
      response.status,
      body?.error ?? body?.reason ?? body?.message ?? `Request failed (${response.status}).`,
      body ?? undefined,
    );
  }

  const name = filenameFrom(response.headers.get("content-disposition"))
    ?? path.split("?")[0]!.split("/").pop()
    ?? "download";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  /* Revoked later, not at once: some browsers start the save after click()
     returns, and a revoked address saves nothing. */
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
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
  /** The property's real date in its own time zone (D27-237); absent from an
      older server. */
  today?: string;
  /** The front desk's rules, set on Settings › Operations (189, the owner's
      D27-243); absent from an older server. */
  deskRules?: DeskRules;
  /** A TEST HOTEL's real hotel, by CODE (the owner's D27-296): a practice
      copy of that hotel's setup. Null for a real hotel; absent from an older
      server, which has none. `isTestHotel` in src/lib/testHotel.ts reads it. */
  testOf?: string | null;
}

export interface DeskRules {
  /** What the desk's payment screens start on (the till keeps Cash). */
  defaultPaymentMethod: string;
  /** The hotel's own ways of paying that are On, in its order (191, the
      owner's D27-259); absent from an older server. */
  paymentMethods?: { label: string; kind: string }[];
  /** Off: the desk's booking past a full house is refused. */
  deskMayOverbook: boolean;
  advanceBeforeCheckIn: "none" | "first_night" | "whole_stay";
  /** Days of the week shaded, 0 Sunday .. 6 Saturday. */
  weekendDays: number[];
  defaultIdType: string | null;
  defaultNationality: string;
  defaultTitle: string | null;
  /* Phase 5 of the settings plan (192, the owner's D27-260). */
  defaultGuarantee: "confirmed" | "tentative";
  defaultBillTo: "guest" | "company";
  /** Fields New booking asks for at this hotel (the desk only). */
  requiredBookingFields: string[];
  hkDirtyAfterMove: boolean;
  hkDirtyAfterUnblock: boolean;
  hkStayoverDirtyAtAudit: boolean;
  /** ID types this hotel does not take. */
  idTypesOff: string[];
  /** Calendar colours per booking state; null = the built-in ones. */
  statusColours: Record<string, string> | null;
  posRoundOff: "off" | "manual" | "automatic";
  kpiDayUseHalf: boolean;
  kpiCompAsSold: boolean;
  /** The tax invoice at check-out (229, D27-344): issued and printed (the
      default), offered as a button, or left to Invoices; and its copies. */
  invoiceAtCheckout?: "print" | "offer" | "invoices";
  invoiceCopies?: 1 | 2;
  /** Shaded like a weekend on the Calendar and Rates; no price reads them. */
  holidays: Array<{ day: string; name: string; colour: string | null }>;
}

/** The first screen after sign-in (087). Set by the GM, changeable by
    the person; NULL on the server reads as the Dashboard. */
export type HomeScreen = "dashboard" | "rooms" | "calendar";
export type RoomGrouping = "type" | "floor";

export interface ApiScope {
  staffId: string;
  email: string;
  fullName: string;
  isGroupAdmin: boolean;
  /** Where this person may WORK. Empty for a group admin — see below. */
  hotels: Array<{ hotelId: string; role: string }>;
  /** Optional only because an API older than 087 does not send them. */
  homeScreen?: HomeScreen;
  roomGrouping?: RoomGrouping;
  /** True once they tapped "Got it" on their Start here card (089). */
  startHereDismissed?: boolean;
}

export interface HotelsResponse {
  scope: ApiScope;
  /** Every property this person may READ. Not the same list. */
  hotels: ApiHotel[];
}

export const getSession = () => api<HotelsResponse>("/api/hotels");
