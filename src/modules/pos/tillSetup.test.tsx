import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
import { mayReach } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";
import type { TillSetup, MenuCategory } from "@/modules/pos/data/till";
import SetupPage from "@/modules/pos/pages/Setup";
import FloorPage from "@/modules/pos/pages/Floor";

/* ══════════════════════════════════════════════════════════════════
   RESTAURANT SETUP ON SCREEN (D22-6, the owner's answers of 25 Sep)

   Who sees it (owner, admin, GM), the ready-to-open list's GST tick (a
   dish with no rate cannot be rung, so the tick waits for every dish),
   and the "Set up tables" button on an empty Tables screen for those who
   may - a waiter reads the sentence only.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

const as = (role: Role) =>
  signedIn({ scope: {
    staffId: "22222222-2222-2222-2222-222222222222", email: "agra@fidato.in",
    fullName: "Agra Clerk", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });

function server(routes: Record<string, () => unknown>) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const answer = routes[url.split("?")[0]!];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
}

function renderAt(path: string, route: string, element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SET_UP: TillSetup = {
  restaurant: { name: "Garden Restaurant" },
  sections: [{ id: "s-1", name: "A/C",
               tables: [{ id: "t-1", label: "AC1", seats: null, busy: false }] }],
  waiters: 1,
};
const dish = (name: string, taxRate: number | null) => ({
  id: name, name, price: 180, taxRate, isActive: true, shortCode: null, isVeg: null,
  isFavourite: false, offUntil: null, offReason: null, prepMinutes: null,
  ownPrepMinutes: null, course: null, ownCourse: null, variations: [], addonGroups: [],
});
const menu = (...items: ReturnType<typeof dish>[]): { categories: MenuCategory[] } => ({
  categories: [{ id: "c-1", name: "Mains", prepMinutes: null, course: null, items } as MenuCategory],
});

describe("who may set the restaurant up", () => {
  it("is the owner, an administrator and the GM - nobody else sees the menu entry", () => {
    const may = (["owner", "admin", "gm", "hotel_manager", "kitchen_manager", "front_desk", "pos"] as Role[])
      .filter((r) => mayReach(r, "/h/:code/till/setup"));
    expect(may).toEqual(["owner", "admin", "gm"]);
  });
});

describe("the ready-to-open list", () => {
  const renderSetup = (dishes: ReturnType<typeof dish>[]) => {
    as("gm");
    server({
      [`/api/hotels/${HOTEL}/till/setup`]: () => SET_UP,
      [`/api/hotels/${HOTEL}/till/menu`]: () => menu(...dishes),
      [`/api/hotels/${HOTEL}/till/access`]: () => ({ ok: true }),
    });
    renderAt(`/h/${HOTEL}/till/setup`, "/h/:code/till/setup", <SetupPage />);
  };

  it("waits for a GST rate on every dish: one with none cannot be rung", async () => {
    renderSetup([dish("Dal Tadka", 5), dish("Jeera Rice", null)]);
    expect(await screen.findByText("1 dish has none - they cannot be rung")).toBeTruthy();
    expect(screen.getAllByLabelText("Done")).toHaveLength(5);
    expect(screen.getAllByLabelText("Not yet")).toHaveLength(1);
  });

  it("ticks all six once every dish has one", async () => {
    renderSetup([dish("Dal Tadka", 5), dish("Jeera Rice", 5)]);
    expect(await screen.findByText("Every dish has one")).toBeTruthy();
    expect(screen.getAllByLabelText("Done")).toHaveLength(6);
  });

  it("sends GST and the module switch to their Settings tab (D27-213)", async () => {
    renderSetup([dish("Dal Tadka", 5)]);
    await screen.findByText("Every dish has one");
    expect(screen.getAllByRole("link", { name: "Open Settings" }).map((a) => a.getAttribute("href")))
      .toEqual(["/settings/taxes-and-billing", "/settings/modules-and-connections"]);
  });
});

describe("an empty Tables screen", () => {
  const renderFloor = (role: Role) => {
    as(role);
    server({
      [`/api/hotels/${HOTEL}/till/floor`]: () => ({ outlet: null, sections: [] }),
      [`/api/hotels/${HOTEL}/till/access`]: () => ({ ok: true }),
    });
    renderAt(`/h/${HOTEL}/floor`, "/h/:code/floor", <FloorPage />);
  };

  it("offers the GM \"Set up tables\"", async () => {
    renderFloor("gm");
    expect(await screen.findByText("No tables have been laid out yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up tables" })).toBeTruthy();
  });

  it("gives a waiter the sentence only", async () => {
    renderFloor("pos");
    expect(await screen.findByText("No tables have been laid out yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up tables" })).toBeNull();
  });
});
