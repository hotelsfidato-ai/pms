import { create } from "zustand";
import { persist } from "zustand/middleware";
import { selectProperty } from "@/data/repositories/businessDate";

/* ══════════════════════════════════════════════════════════════════
   UI STATE
   Extracted from the CRS session store — only the pieces that are
   purely client-side UI preferences, no auth, no identity, no scope.
   Stage 1 has no backend; this is the whole thing.                ═════ */

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /* WHICH SECTIONS A PERSON HAS FOLDED AWAY, by section key.
     Absent means "as it comes" — the sidebar decides the first state
     from what the section IS, not from anything stored, so a new
     section behaves sensibly for somebody who has never seen it. Only
     a deliberate fold or unfold is remembered, and it is remembered
     per person because it is a fact about them and not about the
     hotel. */
  foldedSections: Record<string, boolean>;
  /* `shownFolded` is what the person SEES (the sidebar works it out: stored,
     else as it comes, never folded while it holds the open page). The click
     shows the other; flipping the stored value left a section that came
     folded folded on the first click (D27-316 (3)). */
  toggleSection: (key: string, shownFolded: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /**
   * The property in view, as a hotel CODE.
   *
   * ⚠ Still not the same value as `useSession(s => s.hotelId)`, which
   *   is the Postgres uuid. This one is what goes in a URL. They
   *   converge when the session starts carrying the code as well —
   *   the remaining half of CP9.
   *
   *   The demo `role` that used to live here is GONE. It was a preview
   *   control, and a preview control beside a real session is how a
   *   clerk previews themselves as an owner. Role now comes from
   *   Postgres — `useRole()` in src/lib/session.ts.
   */
  hotelId: string;
  setHotelId: (id: string) => void;
  /**
   * Reports a person has starred. A preference, not data — it says
   * nothing about the hotel, so it belongs here rather than behind
   * the repository seam.
   */
  favouriteReports: string[];
  toggleFavouriteReport: (path: string) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      foldedSections: {},
      toggleSection: (key, shownFolded) => set((s) => ({
        foldedSections: { ...s.foldedSections, [key]: !shownFolded },
      })),
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      /* The hotel CODE, as Postgres names it. Was the fixture's slug
         until CP9 moved the properties repository onto HTTP. */
      hotelId: "5EL",
      setHotelId: (hotelId) => {
        /* The business date follows the property. This is the path a
           deep link takes — App.tsx calls it from a route effect — and
           leaving it out is how /h/AGR/arrivals came to show Agra's
           rooms under 5 Elements' date. */
        selectProperty(hotelId);
        set({ hotelId });
      },
      favouriteReports: [],
      toggleFavouriteReport: (path) =>
        set((s) => ({
          favouriteReports: s.favouriteReports.includes(path)
            ? s.favouriteReports.filter((p) => p !== path)
            : [...s.favouriteReports, path],
        })),
    }),
    {
      name: "fidato.ui",
      partialize: (state) =>
        ({
          sidebarCollapsed: state.sidebarCollapsed,
          foldedSections: state.foldedSections,
          hotelId: state.hotelId,
          favouriteReports: state.favouriteReports,
        }) as UiState,
    },
  ),
);