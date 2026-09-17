import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import { nav } from "@/modules/guests/nav";
import { GuestsPage, CompaniesPage } from "@/modules/guests/pages/Guests";
import BookingSourcesPage from "@/modules/guests/pages/BookingSources";
import FormCPage from "@/modules/guests/pages/FormC";

/* ══════════════════════════════════════════════════════════════════
   THE HEADING IS THE MENU NAME — GUE-1 (the owner, 17 September, D17-22)

   `/companies` sat under "Companies and agents" in the menu and was
   headed, and tabbed, "Booking sources": the name of a different screen
   under Configuration. The menu tests could not see it — they read
   `nav.ts`, never a page. So each of this service's screens is opened
   here and its heading and browser tab are compared with its OWN menu
   entry: renaming either one without the other fails.

   Seen to fail with the old heading put back (guests CHANGELOG,
   17 September).
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  startSignedIn();
  /* The heading is drawn while the list is still loading, and that is
     all these ask about — so the server never answers. */
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
});

const SCREENS: { to: string; path: string; route: string; page: ReactElement }[] = [
  { to: "/guests", path: "/guests", route: "/guests", page: <GuestsPage /> },
  { to: "/companies", path: "/companies", route: "/companies", page: <CompaniesPage /> },
  { to: "/h/:code/booking-sources", path: `/h/${HOTEL}/booking-sources`,
    route: "/h/:code/booking-sources", page: <BookingSourcesPage /> },
  { to: "/h/:code/form-c", path: `/h/${HOTEL}/form-c`, route: "/h/:code/form-c", page: <FormCPage /> },
];

function renderAt(path: string, route: string, element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("each guests screen", () => {
  it("has a menu entry for every screen tested here, and a screen for every entry", () => {
    expect(SCREENS.map((s) => s.to).sort()).toEqual(nav.map((e) => e.to).sort());
  });

  for (const s of SCREENS) {
    it(`${s.to} is headed and tabbed with its menu name`, async () => {
      const label = nav.find((e) => e.to === s.to)!.label;
      renderAt(s.path, s.route, s.page);

      expect(await screen.findByRole("heading", { level: 1, name: label })).toBeTruthy();
      expect(document.title.startsWith(`${label} · `)).toBe(true);
    });
  }

  it("never calls /companies by another screen's name (GUE-1)", async () => {
    renderAt("/companies", "/companies", <CompaniesPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "Booking sources" })).toBeNull();
  });
});
