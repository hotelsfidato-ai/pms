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
import type { Role } from "./permissions";
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
const ROLE_FROM_DB: Record<string, Role> = {
  owner: "owner",
  gm: "manager",
  front_desk: "front_desk",
  housekeeping: "housekeeping",
  finance: "finance",
  read_only: "viewer",
  /* No PMS screen is scoped to a stores keeper or a POS operator yet.
     Both read; neither posts. When Stage 7 brings the POS bridge this
     stops being a viewer and becomes its own row in the matrix. */
  pos: "viewer",
  stores: "viewer",
};

export function roleFor(scope: ApiScope, hotelId: string | null): Role {
  /* A group admin holds no `staff_hotels` rows and still reaches
     everything — `auth_hotel_ids()` accounts for that in the database,
     and this has to account for it here or the owner would read as a
     viewer with no properties. */
  if (scope.isGroupAdmin) return "owner";

  const grant = hotelId
    ? scope.hotels.find((h) => h.hotelId === hotelId)
    : scope.hotels[0];

  return grant ? (ROLE_FROM_DB[grant.role] ?? "viewer") : "viewer";
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
    /* A dev session left in this tab. Checked before Firebase, because
       the dev path is the one in use when there is no service account. */
    const dev = getDevSubject();
    if (dev) {
      void load(set).catch(() => {
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
      void load(set).catch(() => set({ status: "signed-out" }));
    });
  },
}));

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

  set({ status: "signed-in", scope, hotels, hotelId: first, busy: false, error: null });
}

/* ── Selectors ───────────────────────────────────────────────────── */

export const useRole = (): Role => {
  const scope = useSession((s) => s.scope);
  const hotelId = useSession((s) => s.hotelId);
  return scope ? roleFor(scope, hotelId) : "viewer";
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
