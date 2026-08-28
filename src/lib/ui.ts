import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ══════════════════════════════════════════════════════════════════
   UI STATE
   Extracted from the CRS session store — only the pieces that are
   purely client-side UI preferences, no auth, no identity, no scope.
   Stage 1 has no backend; this is the whole thing.                ═════ */

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
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
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      /* The hotel CODE, as Postgres names it. Was the fixture's slug
         until CP9 moved the properties repository onto HTTP. */
      hotelId: "5EL",
      setHotelId: (hotelId) => set({ hotelId }),
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
          hotelId: state.hotelId,
          favouriteReports: state.favouriteReports,
        }) as UiState,
    },
  ),
);