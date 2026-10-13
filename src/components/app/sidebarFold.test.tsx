import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { TooltipProvider } from "@/components/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import { Sidebar } from "./Sidebar";

/* ══════════════════════════════════════════════════════════════════
   A MENU SECTION OPENS AND FOLDS ON THE FIRST CLICK (D27-316 (3))

   Banquet, Laundry, Spa, Reports, System, Point of sale, Sales and marketing
   and Distribution start folded because of what they ARE, not because
   anything was stored. The toggle used to flip the STORED value, which is
   unset for a person who has never touched it, so the first click said
   "folded" again and nothing moved. The toggle now follows the state on
   screen: whatever is shown, the click shows the other.
   ══════════════════════════════════════════════════════════════════ */

function menu() {
  signedIn({
    scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "o@fidato.in", fullName: "O",
      isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }],
    },
  });
  useUi.setState({ hotelId: "AGR", foldedSections: {}, sidebarCollapsed: false });
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter initialEntries={["/h/AGR/stay"]}><Sidebar /></MemoryRouter></TooltipProvider>
    </QueryClientProvider>,
  );
}
const section = (name: RegExp) => screen.getByRole("button", { name });
const shown = (name: RegExp) => section(name).getAttribute("aria-expanded");

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a menu section's first click", () => {
  it("opens a section that came folded", () => {
    menu();
    expect(shown(/^Reports/)).toBe("false");
    fireEvent.click(section(/^Reports/));
    expect(shown(/^Reports/)).toBe("true");
    fireEvent.click(section(/^Reports/));
    expect(shown(/^Reports/)).toBe("false");
  });

  it("opens each of the sections that come folded, one click each", () => {
    menu();
    for (const name of [/^System/, /^Distribution/]) {
      expect(shown(name), String(name)).toBe("false");
      fireEvent.click(section(name));
      expect(shown(name), String(name)).toBe("true");
    }
  });

  it("folds a section that came open, on the first click", () => {
    menu();
    const open = /^Rooms and rates/;
    expect(shown(open)).toBe("true");
    fireEvent.click(section(open));
    expect(shown(open)).toBe("false");
    fireEvent.click(section(open));
    expect(shown(open)).toBe("true");
  });
});
