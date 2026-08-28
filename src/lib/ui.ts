import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role } from "./permissions";

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
   * Which role the interface is being PREVIEWED as.
   *
   * Stage 1 has no authentication (Rule 1), so this is not identity —
   * it is a demo control that lets a reviewer see how the product
   * changes for a front-desk clerk versus an owner. When real auth
   * arrives it is replaced by the signed-in user's role, and every
   * `useUi(s => s.role)` becomes `useSession(s => s.role)`.
   */
  role: Role;
  setRole: (role: Role) => void;
  /** The property in view. One today; the switcher exists regardless. */
  hotelId: string;
  setHotelId: (id: string) => void;
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
      role: "front_desk",
      setRole: (role) => set({ role }),
      hotelId: "5-elements-akkalkot",
      setHotelId: (hotelId) => set({ hotelId }),
    }),
    {
      name: "fidato.ui",
      partialize: (state) =>
        ({
          sidebarCollapsed: state.sidebarCollapsed,
          role: state.role,
          hotelId: state.hotelId,
        }) as UiState,
    },
  ),
);