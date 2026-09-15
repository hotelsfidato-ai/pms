import { create } from "zustand";
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth } from "./firebase";
import {
  getSession, setDevSubject, getDevSubject, devAuth, ApiError,
  type ApiHotel, type ApiScope,
} from "./api";
import { DEMO } from "./demo";
import { ROLES, type Role } from "./permissions";
import { useUi } from "./ui";
import { registerBusinessDates, selectProperty }
  from "@/data/repositories/businessDate";

/* ══════════════════════════════════════════════════════════════════
   THE SESSION

   Who is signed in, and what they may do. Both answers come from
   Postgres, not from this file and not from a picker.

   Firebase answers *who are you*. Postgres answers *what may you do*,
   from `staff` and `staff_hotels` under RLS. Roles never live in
   Firebase — a custom claim may cache one, but it must never own it,
   because a token is minted once and a permission changes whenever
   someone decides it does.

   This replaces the `role` half of `src/lib/ui.ts`, which was a DEMO
   CONTROL: it let a reviewer preview the product as a clerk or an
   owner. Leaving that beside a real session is how a clerk previews
   themselves as an owner, so it is gone rather than hidden.
   ══════════════════════════════════════════════════════════════════ */

/**
 * `staff_hotels.role` and `src/lib/permissions.ts` grew from different
 * places and do not share a vocabulary. Neither is wrong; they answer
 * different questions — the database says what someone was hired as,
 * the matrix says what a screen may show them.
 *
 * The mapping is explicit and total, so a new database role is a
 * compile error here rather than a silent fall-through to `viewer`.
 */
/* ⚠ THIS WAS A TRANSLATION TABLE, AND IT EXISTED BECAUSE THE TWO
   VOCABULARIES DIFFERED. The database said `gm`, the matrix said
   `manager`; the database said `stores`, the matrix had no such role
   and this mapped it to `viewer`.

   That last one was not a naming detail. A store keeper signed in and
   read as a VIEWER — no create, no edit, nothing — while their row in
   `staff_hotels` said `stores`. The comment above it said "when Stage 7
   brings the POS bridge this stops being a viewer"; Stage 7 shipped and
   this did not change.

   078 gives the database and the matrix the SAME twelve roles, so there
   is nothing to translate. The mapping is gone rather than corrected:
   a translation between two lists that are now identical is a place for
   them to diverge again.

   `api/test/roles.test.ts` asserts the two lists are equal, so a role
   added to one and not the other fails a gate. */
const KNOWN = new Set<string>(ROLES);

export function roleFor(scope: ApiScope, hotelId: string | null): Role {
  /* A group admin holds no `staff_hotels` rows and still reaches
     everything — `auth_hotel_ids()` accounts for that in the database,
     and this has to account for it here or the owner would read as a
     viewer with no properties. */
  if (scope.isGroupAdmin) return "owner";

  const grant = hotelId
    ? scope.hotels.find((h) => h.hotelId === hotelId)
    : scope.hotels[0];

  if (!grant) return "read_only";

  /* An unknown role is READ_ONLY and it is also a fault worth saying
     out loud. Silently granting the least is right — the alternative is
     granting something nobody chose — but a role the database allows
     and this build has never heard of means the two lists have drifted
     again, and the person it happens to would otherwise just find the
     product mysteriously empty. */
  if (!KNOWN.has(grant.role)) {
    console.error(
      `[session] unknown role "${grant.role}" — this build does not know it. ` +
      `Treating as read-only. The role lists have drifted; see 078.`,
    );
    return "read_only";
  }

  return grant.role as Role;
}

type Status = "starting" | "signed-out" | "signed-in";

interface SessionState {
  status: Status;
  scope: ApiScope | null;
  /** Every property this person may READ. */
  hotels: ApiHotel[];
  /** The property in view, by database id. Null until one is chosen. */
  hotelId: string | null;
  error: string | null;
  busy: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  signInAsDev: (subject: string) => Promise<void>;
  signOut: () => Promise<void>;
  setHotelId: (id: string) => void;
  /**
   * Re-read identity, scope and every property's BUSINESS DATE.
   *
   * Needed because the night audit MOVES a date. Before this existed,
   * closing a day updated the database and left the whole interface
   * reading the old one: the audit's own success card said "now
   * operating in 26 August" while the header two lines above it still
   * said "Closing 25 August". Nothing was broken; the client had
   * simply never been told.
   */
  refresh: () => Promise<void>;
  /** Called once at start-up to restore a session Firebase already holds. */
  restore: () => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  status: "starting",
  scope: null,
  hotels: [],
  hotelId: null,
  error: null,
  busy: false,

  signIn: async (email, password) => {
    if (!auth) {
      set({ error: "Firebase is not configured. See .env.example." });
      return;
    }
    set({ busy: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await load(set);
    } catch (error) {
      /* Firebase distinguishes "no such user" from "wrong password".
         Repeating that distinction back is a way to discover which
         email addresses are staff, so both read the same. */
      set({
        busy: false,
        status: "signed-out",
        error:
          error instanceof ApiError
            ? error.message
            : "That email and password do not match.",
      });
    }
  },

  signInAsDev: async (subject) => {
    if (!devAuth) return;
    set({ busy: true, error: null });
    setDevSubject(subject);
    try {
      await load(set);
    } catch (error) {
      setDevSubject(null);
    forgetSession();
      set({
        busy: false,
        status: "signed-out",
        error: error instanceof Error ? error.message : "Could not sign in.",
      });
    }
  },

  signOut: async () => {
    setDevSubject(null);
    if (auth?.currentUser) await firebaseSignOut(auth);
    set({ status: "signed-out", scope: null, hotels: [], hotelId: null, error: null });
  },

  refresh: async () => {
    await load(set);
  },

  setHotelId: (id) => {
    /* Before the id changes, not after. Every screen reads
       BUSINESS_DATE synchronously during the render this triggers,
       and a render between the two would show the new property's
       rooms under the old property's date. */
    selectProperty(id);
    set({ hotelId: id });
  },

  restore: () => {
    /* The preview build has no server and no Firebase, and asking a
       client to sign in to a demo that cannot authenticate anybody
       would be a dead end. `/api/hotels` is in the snapshot, so this
       loads the real scope straight out of it. */
    if (DEMO) {
      loadOrRecall(set, () => set({ status: "signed-out" }));
      return;
    }

    /* A dev session left in this tab. Checked before Firebase, because
       the dev path is the one in use when there is no service account. */
    const dev = getDevSubject();
    if (dev) {
      loadOrRecall(set, () => {
        setDevSubject(null);
        set({ status: "signed-out" });
      });
      return;
    }

    /* Without Firebase configured there is nothing to restore, and
       leaving status on "starting" would hang the app on a spinner. */
    if (!auth) {
      set({ status: "signed-out" });
      return;
    }
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (get().status !== "signed-in") set({ status: "signed-out" });
        return;
      }
      loadOrRecall(set, () => set({ status: "signed-out" }));
    });
  },
}));


/* ══════════════════════════════════════════════════════════════════
   THE SESSION SURVIVES AN OUTAGE

   `load()` reads identity and scope from the server, and every caller
   used to write `.catch(() => set({ status: "signed-out" }))`. That is
   correct for a 401 and wrong for everything else — and offline,
   EVERYTHING ELSE is what happens.

   The effect was that reloading a page with no connection put the
   clerk on the sign-in screen. Which cannot be completed, because
   signing in also needs the server. Every screen cached for offline
   use, every held change in the outbox, all of it unreachable behind a
   form that could not be filled in.

   Found by stopping the API and pressing reload, which is the only way
   it could have been found: nothing about it fails a typecheck, a test
   or a build.

   SO THE LAST GOOD SESSION IS KEPT. On a network failure it is
   restored and the person stays where they were. On a real 401 it is
   discarded and they are signed out, because that is the server saying
   who they are — the one answer worth believing.

   WHAT IS STORED: their own name, email and which properties they may
   see. Nothing about a guest. It is what "stay signed in" already
   means everywhere else, and it is the signed-in person's own
   identity, which they are looking at anyway. */
const SESSION_KEY = "fidato-last-session";

interface Remembered {
  scope: ApiScope;
  hotels: ApiHotel[];
  at: number;
}

function remember(scope: ApiScope, hotels: ApiHotel[]) {
  try {
    localStorage.setItem(SESSION_KEY,
      JSON.stringify({ scope, hotels, at: Date.now() } satisfies Remembered));
  } catch {
    /* Private window, or storage full. The app works; it just will not
       survive a reload offline. */
  }
}

function recall(): Remembered | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Remembered;
    /* A WEEK. Long enough for any outage a hotel actually has, short
       enough that a machine left in a drawer does not open into
       somebody's account months later. */
    if (Date.now() - r.at > 7 * 24 * 60 * 60 * 1000) return null;
    return r;
  } catch {
    return null;
  }
}

export function forgetSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* Nothing depends on this succeeding. */
  }
}

/** True when the request never arrived, as opposed to being refused.
    `ApiError(0)` is what api.ts raises for a dead line. */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/**
 * What every `restore` path does when `load()` fails.
 *
 * A refusal signs out. A dropped line does not — it puts the person
 * back where they were, with what was true when the line was last up.
 */
function loadOrRecall(
  set: (partial: Partial<SessionState>) => void,
  onSignedOut: () => void,
) {
  void load(set).catch((error: unknown) => {
    if (!isNetworkFailure(error)) {
      forgetSession();
      onSignedOut();
      return;
    }

    const last = recall();
    if (!last) {
      /* Nothing to fall back to — a first run with no connection. */
      onSignedOut();
      return;
    }

    registerBusinessDates(last.hotels);
    const first = last.scope.hotels[0]?.hotelId ?? last.hotels[0]?.id ?? null;
    if (first) selectProperty(first);
    selectProperty(useUi.getState().hotelId);

    set({
      status: "signed-in",
      scope: last.scope,
      hotels: last.hotels,
      hotelId: first,
      busy: false,
      error: null,
    });
  });
}

/** Reads identity and scope from Postgres. The one source for both. */
async function load(set: (partial: Partial<SessionState>) => void) {
  const { scope, hotels } = await getSession();

  /* Which property to open in. A group admin has no grants, so fall
     back to the first readable one rather than showing an empty shell. */
  const first = scope.hotels[0]?.hotelId ?? hotels[0]?.id ?? null;

  /* The property's operating day, into the seam, BEFORE status becomes
     "signed-in". App.tsx holds every screen behind a loading state until
     then, so no screen can observe the unset value. */
  registerBusinessDates(hotels);
  if (first) selectProperty(first);
  /* And then onto whatever property the interface is actually showing.
     `useUi.hotelId` holds a CODE and persists across reloads, so it can
     already name a different property than the one `first` picked. */
  selectProperty(useUi.getState().hotelId);

  /* Kept so a reload with no connection lands on the application
     rather than on a sign-in form that cannot be completed. */
  remember(scope, hotels);

  set({ status: "signed-in", scope, hotels, hotelId: first, busy: false, error: null });
}

/* ── Selectors ───────────────────────────────────────────────────── */

export const useRole = (): Role => {
  const scope = useSession((s) => s.scope);
  const hotelId = useSession((s) => s.hotelId);
  return scope ? roleFor(scope, hotelId) : "read_only";
};

export const useCurrentHotel = (): ApiHotel | null => {
  const hotels = useSession((s) => s.hotels);
  const hotelId = useSession((s) => s.hotelId);
  return hotels.find((h) => h.id === hotelId) ?? null;
};

/** The properties this person may WORK IN, not merely read. */
export const useWorkableHotels = (): ApiHotel[] => {
  const hotels = useSession((s) => s.hotels);
  const scope = useSession((s) => s.scope);
  if (!scope) return [];
  if (scope.isGroupAdmin) return hotels;
  const allowed = new Set(scope.hotels.map((h) => h.hotelId));
  return hotels.filter((h) => allowed.has(h.id));
};
