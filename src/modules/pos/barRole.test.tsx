import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { toast } from "@/components/ui";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Docket, MenuCategory, MenuItem, Order } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";

/* ══════════════════════════════════════════════════════════════════
   THE BAR ROLE AND THE WAITER'S KOT REPRINT ON THE ORDER SCREEN
   (the owner's D27-324 (2) and (4))

   The server gives a Bar person only the bar's sections (those that print
   on the Bar KOT), so the pad opens on them - no Restaurant tab in front.
   A waiter or a Bar person reprints the open order's own KOTs from the pad;
   the reprint prints at the computer that prints that KOT, marked REPRINT
   (D27-329 (2)). The server's half is api/test/modules/pos/barRole.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}/till`;

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
  const asked: string[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    const answer = routes[`${init?.method ?? "GET"} ${url.split("?")[0]}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
  return asked;
}

const dish = (id: string, name: string): MenuItem => ({
  id, name, price: 200, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
});
const section = (id: string, taxKind: MenuCategory["taxKind"], items: MenuItem[]): MenuCategory =>
  ({ id, name: id, taxKind, prepMinutes: null, course: null, items });

function pad(orderId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/tables`]}>
        <Routes><Route path="/pos/:code/tables" element={
          <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-4" tableLabel="Table 4"
                    {...(orderId ? { orderId } : {})} open onOpenChange={() => {}} onSent={() => {}} />
        } /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a Bar person's order pad (D27-324 (2))", () => {
  it("opens on the bar's sections, with no Restaurant tab in front of them", async () => {
    as("bar");
    /* What the server gives a Bar person: what prints at the bar - here a
       section taxed as the restaurant's whose KOT is the Bar's, and one
       under the Bar heading. */
    server({
      [`GET ${API}/menu`]: () => ({ categories: [
        section("Bar snacks", "restaurant", [dish("i-1", "Masala Peanuts")]),
        section("Beers", "bar", [dish("i-2", "Kingfisher 650")]),
      ] }),
      [`GET ${API}/numbered-addons`]: () => ({ addons: [] }),
    });
    pad();
    expect(await screen.findByRole("button", { name: /Kingfisher 650/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Masala Peanuts/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Restaurant" })).toBeNull();
  });
});

describe("reprinting a KOT from the order screen (D27-324 (4))", () => {
  const ORDER = {
    id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Restaurant", hotelName: "5 Elements",
    hotelCity: null, hotelGstin: null, table: "T4", status: "open", lines: [
      { id: "l-1", name: "Kingfisher 650", qty: 2, unitPrice: 300, taxRate: 18, note: null, voided: false,
        kotStatus: "sent", addedBy: "Ravi", parentLineId: null, isAddon: false, variationId: null,
        kotNo: 3, kotKind: { id: "k-bar", name: "Bar" } },
      { id: "l-2", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5, note: null, voided: false,
        kotStatus: "sent", addedBy: "Ravi", parentLineId: null, isAddon: false, variationId: null,
        kotNo: 3, kotKind: { id: "k-kitchen", name: "Kitchen" } },
      { id: "l-3", name: "Dal Tadka", qty: 1, unitPrice: 260, taxRate: 5, note: null, voided: false,
        kotStatus: "pending", addedBy: "Ravi", parentLineId: null, isAddon: false, variationId: null,
        kotNo: null, kotKind: null },
    ],
  } as unknown as Order;
  const DOCKET: Docket = {
    kotNo: 3, kind: { id: "k-bar", name: "Bar" }, orderNo: "20260825-5", table: "T4",
    orderType: "dine_in", outlet: "Restaurant", hotel: "5 Elements", sentAt: "25/08/26 19:05",
    lines: [{ id: "l-1", parentId: null, name: "Kingfisher 650", qty: 2, note: null, isAddon: false }],
  };

  /* D27-329 (2): the reprint goes to the computer that prints that KOT's
     kind - the bar's here - not to this device's printer. The station's
     half is KotStation.test.tsx; offline and refused, kotReprint.test.tsx. */
  for (const role of ["pos", "bar"] as const) {
    it(`offers ${role === "pos" ? "a waiter" : "a Bar person"} each KOT of the order, and sends the reprint to the bar's computer`, async () => {
      as(role);
      const asked = server({
        [`GET ${API}/menu`]: () => ({ categories: [] }),
        [`GET ${API}/numbered-addons`]: () => ({ addons: [] }),
        [`GET ${API}/orders/o-5`]: () => ORDER,
        [`GET ${API}/orders/o-5/kot/3`]: () => DOCKET,
        [`POST ${API}/orders/o-5/kot/3/reprint`]: () =>
          ({ ok: true, station: { name: "Bar PC", online: true, seenAt: null } }),
      });
      const print = vi.spyOn(window, "print").mockImplementation(() => {});
      const said = vi.spyOn(toast, "success");
      pad("o-5");

      const list = await screen.findByRole("list", { name: "KOTs sent" });
      expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.replace("Reprint", "").trim()))
        .toEqual(["KOT 3 · Bar", "KOT 3 · Kitchen"]);
      fireEvent.click(within(list).getByRole("button", { name: "Reprint KOT 3 · Bar" }));

      await vi.waitFor(() => expect(said).toHaveBeenCalledWith(
        "KOT 3 · Bar sent to Bar PC", "It prints there, marked REPRINT."));
      expect(asked).toContain(`POST ${API}/orders/o-5/kot/3/reprint`);
      expect(print, "not on this device").not.toHaveBeenCalled();
    });
  }
});
