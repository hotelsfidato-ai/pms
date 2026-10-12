import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import PropertyPage from "@/modules/admin/pages/Property";
import PeoplePage from "@/modules/admin/pages/People";

/* ══════════════════════════════════════════════════════════════════
   D27-308 (the owner, 12 October): what the A16 video check found on
   Properties and a property's own page.

   (1a) another property's page reads ITS business date, not the one of
        the property selected at the top: no date is sent, the server
        uses the property's own;
   (1b) its average rate and RevPAR are a dash when nothing is sold;
   (1d) "Calendar" and "Open the Calendar" open the Calendar;
   (1e) a GM or Admin gets Open on the card of a property they run;
   (2)  the two room counts say which they are; Add somebody here starts
        on Reception; its passwords are hidden, with Show; the GM's
        Add somebody says what is true for the GM.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => { startSignedIn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const as = (role: Role | "group-admin") =>
  signedIn({ scope: {
    staffId: "22222222-2222-2222-2222-222222222222", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: role === "group-admin",
    hotels: role === "group-admin" ? [] : [{ hotelId: AGRA_HOTEL, role }],
  } });

function renderAt(path: string, route: string, element: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ── One property's page ─────────────────────────────────────────── */

const DETAIL = (grantableRoles: string[] = [], staff: unknown[] = []) => ({
  property: { id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra", state: "UP",
    gstin: null, phone: null, email: null, addressLine: null, isActive: true, rooms: 10,
    roomTypes: [], checkedIn: 0, fssaiNumber: null },
  staff, grantableRoles,
});
const NOTHING_SOLD = {
  from: "2026-08-01", to: "2026-08-24", availableRoomNights: 240, roomsSold: 0,
  occupancyPct: 0, adr: 0, revpar: 0, roomRevenue: 0,
};

function openProperty(detail = DETAIL(), period: unknown = NOTHING_SOLD) {
  const asked: string[] = [];
  const sent: { path: string; body: unknown }[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, id: "p-new", existed: false } as never;
    }
    asked.push(path);
    if (path === "/api/admin/hotels/AGR") return detail as never;
    if (path.startsWith("/api/hotels/AGR/statistics/period")) return period as never;
    if (path.startsWith("/api/hotels/AGR/statistics/snapshot")) {
      return { date: "2026-08-24", available: 10, sold: 0, vacant: 10, occupancyPct: 0 } as never;
    }
    return new Promise(() => {}) as never;
  });
  renderAt("/properties/AGR", "/properties/:code", <PropertyPage />);
  return { asked, sent };
}

const figure = async (label: string) =>
  (await screen.findByText(label)).nextElementSibling?.textContent;

describe("another property's page", () => {
  it("asks for that property's own day, not the selected property's (1a)", async () => {
    /* The seam is on 5 Elements, 25 August (src/test/setup.ts); Agra's
       own day is the 24th. The page names no date at all. */
    as("group-admin");
    const { asked } = openProperty();
    await waitFor(() => {
      expect(asked).toContain("/api/hotels/AGR/statistics/snapshot");
      expect(asked).toContain("/api/hotels/AGR/statistics/period");
    });
    expect(asked.filter((u) => u.includes("2026-08-25"))).toEqual([]);
  });

  it("shows a dash, not ₹0, for the average rate and RevPAR when nothing is sold (1b)", async () => {
    as("group-admin");
    openProperty();
    await waitFor(async () => expect(await figure("Room revenue, month to date")).toBe("₹0"));
    expect(await figure("Average rate")).toBe("-");
    expect(await figure("RevPAR")).toBe("-");
  });

  it("starts Add somebody here on Reception, as People does", async () => {
    as("group-admin");
    openProperty(DETAIL(["owner", "admin", "gm", "front_desk", "housekeeping"]));
    fireEvent.click(await screen.findByRole("button", { name: /Add somebody here/ }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/What they do here/) as HTMLSelectElement).value)
      .toBe("front_desk");
  });

  it("hides the password typed for somebody, with Show, when adding and when setting one", async () => {
    as("group-admin");
    openProperty(DETAIL(["gm", "front_desk"], [{
      id: "p-1", name: "Asha", email: "asha@fidato.in", role: "front_desk", isActive: true,
      canSignIn: true, isGroupAdmin: false, homeScreen: "dashboard",
    }]));

    fireEvent.click(await screen.findByRole("button", { name: /Add somebody here/ }));
    let dialog = await screen.findByRole("dialog");
    const typed = within(dialog).getByLabelText(/A password for them/) as HTMLInputElement;
    expect(typed.type).toBe("password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show" }));
    expect(typed.type).toBe("text");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Set a password for Asha" }));
    dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/Password/) as HTMLInputElement).type).toBe("password");
    expect(within(dialog).getByRole("button", { name: "Show" })).toBeTruthy();
  });
});

/* ── Properties ──────────────────────────────────────────────────── */

const CARD = {
  id: "AGR", name: "Fidato Agra", address: "Agra", phone: "", email: "", gstin: null,
  currency: "INR", checkInTime: "12:00", checkOutTime: "11:00", rooms: 9, roomTypes: ["Deluxe"],
  rateTypes: ["CP"], tax: { cgst: 0, sgst: 0 }, paymentMethods: [],
};
const NO_TAX = { kinds: [], categories: [] };

function server(routes: Record<string, () => unknown>) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = routes[`${init?.method ?? "GET"} ${url.split("?")[0]!}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
}

const staffCards = () => server({
  "GET /api/hotels": () => ({ scope: { isGroupAdmin: false, hotels: [] }, hotels: [{ id: AGRA_HOTEL, code: "AGR" }] }),
  "GET /api/hotels/AGR": () => CARD,
  "GET /api/hotels/AGR/tax": () => NO_TAX,
});

const linkTo = (name: string | RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("Properties, for somebody who is not a group administrator", () => {
  it("opens the Calendar from Open the Calendar, and says the rooms are today's sellable ones (1d)", async () => {
    as("front_desk");
    staffCards();
    renderAt("/properties", "/properties", <PropertiesPage />);
    await screen.findByText("Fidato Agra");
    expect(linkTo(/Open the Calendar/)).toBe("/h/AGR/calendar");
    expect(screen.getByText("Rooms sellable today")).toBeTruthy();
  });

  it("gives a GM and an Admin Open on the card of the property they run, and the desk none (1e)", async () => {
    for (const role of ["gm", "admin"] as const) {
      as(role);
      staffCards();
      renderAt("/properties", "/properties", <PropertiesPage />);
      await screen.findByText("Fidato Agra");
      expect(linkTo(/^Open$/), role).toBe("/properties/AGR");
      cleanup(); vi.restoreAllMocks();
    }
    as("front_desk");
    staffCards();
    renderAt("/properties", "/properties", <PropertiesPage />);
    await screen.findByText("Fidato Agra");
    expect(screen.queryByRole("link", { name: /^Open$/ })).toBeNull();
  });
});

describe("Properties, for a group administrator", () => {
  it("opens the Calendar from Calendar, and says the rooms are all of them (1d)", async () => {
    as("group-admin");
    server({
      "GET /api/hotels": () => ({ scope: { isGroupAdmin: true, hotels: [] }, hotels: [] }),
      "GET /api/admin/hotels": () => ({ hotels: [{
        id: "h-1", code: "AGR", name: "Fidato Agra", city: "Agra", state: "UP", gstin: null,
        phone: null, email: null, addressLine: null, isActive: true, rooms: 10,
        roomTypes: ["Deluxe"], checkedIn: 0,
      }] }),
      "GET /api/hotels/AGR/tax": () => NO_TAX,
    });
    renderAt("/properties", "/properties", <PropertiesPage />);
    await screen.findByText("Fidato Agra");
    expect(linkTo("Calendar")).toBe("/h/AGR/calendar");
    expect(screen.getByText("All rooms")).toBeTruthy();
  });
});

/* ── People: the GM's Add somebody ───────────────────────────────── */

describe("People, the GM's Add somebody", () => {
  it("says what is true for a GM: the person, their place and their role, in one go", async () => {
    as("gm");
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
      if (url === "/api/admin/staff") {
        return { staff: [{
          id: "p-1", email: "asha@fidato.in", name: "Asha", phone: null, canSignIn: true,
          isGroupAdmin: false, isActive: true, homeScreen: "dashboard",
          mayEdit: true, maySwitch: true, maySetPassword: true,
          access: [{ code: "AGR", role: "front_desk" }],
        }], rosterAt: [{ code: "AGR", name: "Fidato Agra", roles: ["front_desk"] }] } as never;
      }
      throw new ApiError(500, "Request failed (500).");
    });
    renderAt("/people", "/people", <PeoplePage />);
    /* The button waits for the list (admin.test.tsx, D22-3). */
    await screen.findByText("Asha");
    fireEvent.click(await screen.findByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/comes next/)).toBeNull();
    expect(within(dialog).getByText(/where they work and what they do/)).toBeTruthy();
  });
});
