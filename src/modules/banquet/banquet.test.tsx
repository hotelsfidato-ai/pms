import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, signedIn, startSignedIn } from "@/test/app";
import { getBanquetDiary, getBanquetEvent, getBanquetSetup, type BanquetEvent } from "@/modules/banquet/data/banquet";
import * as frontDoor from "@/modules/banquet";
import BanquetPage from "@/modules/banquet/pages/Banquet";
import BanquetSetupPage from "@/modules/banquet/pages/BanquetSetup";
import BanquetEventPage from "@/modules/banquet/pages/BanquetEvent";

/* ══════════════════════════════════════════════════════════════════
   THE BANQUET SCREENS — the owner's answers of 17 September

     BQ-2   the Diary's heading is the menu's word, "Diary" (D17-22)
     BQ-3   a read that fails says so, the restaurant's way, instead of
            "This property has no banquet hall" or "No such function"
     BQ-4   the function's account is a "bill"
     BQ-5   dates and times through format.ts
     BQ-1   the function's bill lists its restaurant orders, and the
            front door exports the functions an order may attach to (D17-21)

   The server is stubbed per path, and made to fail on purpose. Each of
   these was run against the code before the change and seen to fail
   (banquet CHANGELOG, 17 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => { startSignedIn(); });

afterEach(() => {
  vi.restoreAllMocks();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

/** Answers each request by its path; anything unlisted is a fault. */
function server(routes: Record<string, () => unknown>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const path = url.split("?")[0]!;
    const answer = routes[path];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
}

function renderAt(path: string, route: string, element: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DIARY = `/api/hotels/${HOTEL}/banquet`;
const EVENT = `/api/hotels/${HOTEL}/banquet/events/e-1`;
const SETUP = `/api/hotels/${HOTEL}/banquet/setup`;

/** One package on, one switched off (D27-305). */
const twoPackages = () => ({
  venues: [],
  packages: [
    { id: "p-1", name: "Veg thali", description: null, ratePerHead: 450, mealType: null, isActive: true },
    { id: "p-2", name: "Old buffet", description: null, ratePerHead: 900, mealType: null, isActive: false },
  ],
});

const OFF = "This property has no banquet hall. Turn it on in the property's settings if that is wrong.";
const refuse = (status: number, sentence: string) => () => {
  throw new ApiError(status, sentence, { reason: sentence });
};

const diaryPage = () => renderAt(`/h/${HOTEL}/banquet`, "/h/:code/banquet", <BanquetPage />);
const setupPage = () => renderAt(`/h/${HOTEL}/banquet/setup`, "/h/:code/banquet/setup", <BanquetSetupPage />);
const eventPage = () => renderAt(`/h/${HOTEL}/banquet/e-1`, "/h/:code/banquet/:id", <BanquetEventPage />);

function aFunction(over: Partial<BanquetEvent> = {}): BanquetEvent {
  return {
    id: "e-1", reference: "BQ-2611-1001", title: "Sharma sangeet",
    eventType: null, status: "confirmed",
    startsAt: "2026-11-14T18:00", endsAt: "2026-11-14T23:00",
    businessDate: "2026-11-01", hostName: "Mr Sharma", hostPhone: null,
    hostEmail: null, pax: 200, paxGuaranteed: null, agreedAmount: 60000,
    notes: null, cancelReason: null,
    venue: { id: "v-1", name: "North hall", seated: 250, floating: null, defaultRate: null },
    registeredBy: "Owner", registeredAt: "2026-11-01T10:30",
    confirmedBy: "Owner", folioId: "f-1", taxWarning: null, bill: null, invoice: null, catering: [],
    restaurantOrders: [],
    money: { venue: 60000, food: 0, pos: 0, total: 60000, unpriced: null },
    ...over,
  };
}

/* ── BQ-3 · the reads ───────────────────────────────────────────── */

describe("the banquet reads", () => {
  it("throw a server fault instead of answering null", async () => {
    vi.spyOn(apiModule, "api").mockRejectedValue(new ApiError(500, "Request failed (500)."));
    await expect(getBanquetDiary(HOTEL)).rejects.toThrow("500");
    await expect(getBanquetEvent(HOTEL, "e-1")).rejects.toThrow("500");
    await expect(getBanquetSetup(HOTEL)).rejects.toThrow("500");
  });
});

/* ── The Diary ──────────────────────────────────────────────────── */

describe("the Diary", () => {
  it("is headed with the menu's word, and prints dates as every screen does", async () => {
    server({
      [DIARY]: () => ({
        businessDate: "2026-11-01", from: "2026-11-01", to: "2026-12-01",
        venues: [{
          id: "v-1", name: "North hall",
          events: [{
            id: "e-1", reference: "BQ-2611-1001", title: "Sharma sangeet",
            status: "confirmed", startsAt: "2026-11-14T18:00", endsAt: "2026-11-14T23:00",
            hostName: "Mr Sharma", pax: 200, agreedAmount: null, registeredBy: "Owner",
          }],
        }],
      }),
    });
    diaryPage();

    expect(await screen.findByText("1 function confirmed between 1 Nov 2026 and 1 Dec 2026.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Diary" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Banquet" })).toBeNull();
    expect(screen.getByText("14 Nov 2026, 6:00 PM → 11:00 PM")).toBeTruthy();
    expect(screen.queryByText(/2026-11-01/)).toBeNull();
  });

  it("says the diary did not load when the server fails - not that there is no hall", async () => {
    server({});
    diaryPage();

    expect(await screen.findByText("The diary did not load")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText(/no banquet hall/i)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Diary" })).toBeTruthy();
  });

  it("says the server could not be reached when nothing arrived", async () => {
    server({ [DIARY]: () => { throw new ApiError(0, "Could not reach the server."); } });
    diaryPage();

    expect(await screen.findByText("The diary did not load")).toBeTruthy();
    expect(screen.getByText(/server could not be reached/)).toBeTruthy();
  });

  it("shows the server's own sentence when banquet is switched off", async () => {
    server({ [DIARY]: refuse(403, OFF) });
    diaryPage();

    expect(await screen.findByText("The diary is not available")).toBeTruthy();
    expect(screen.getByText(OFF)).toBeTruthy();
  });
});

/* ── Halls and packages ─────────────────────────────────────────── */

describe("Halls and packages", () => {
  it("says it did not load when the server fails - not that there is no hall", async () => {
    server({});
    setupPage();

    expect(await screen.findByText("Halls and packages did not load")).toBeTruthy();
    expect(screen.queryByText(/no banquet hall/i)).toBeNull();
  });

  it("shows reception the switches disabled, and who switches them (D27-305)", async () => {
    server({ [SETUP]: twoPackages });
    setupPage();
    const sw = await screen.findByRole("switch", { name: "Offer Veg thali" });
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The owner, an administrator or the GM switches them\./)).toBeTruthy();
  });

  it("switches a package off and sends nothing else; it is never edited (D27-305)", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
      fullName: "Group Owner", isGroupAdmin: true, hotels: [],
    } });
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return { ok: true } as never;
      }
      return twoPackages() as never;
    });
    setupPage();

    fireEvent.click(await screen.findByRole("switch", { name: "Offer Veg thali" }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: `/api/hotels/${HOTEL}/banquet/packages/p-1`, body: { isActive: false } });
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});

/* ── One function ───────────────────────────────────────────────── */

describe("one function", () => {
  it("says it did not load when the server fails - not that it does not exist", async () => {
    server({});
    eventPage();

    expect(await screen.findByText("This function did not load")).toBeTruthy();
    expect(screen.queryByText(/no such function/i)).toBeNull();
    expect(screen.getByRole("button", { name: /diary/i })).toBeTruthy();
  });

  it("calls its account a bill, and prints its times through format.ts", async () => {
    server({ [EVENT]: () => aFunction() });
    eventPage();

    expect(await screen.findByText("The bill")).toBeTruthy();
    expect(screen.getByText("Nothing is on the bill yet.")).toBeTruthy();
    expect(screen.queryByText(/folio/i)).toBeNull();
    expect(screen.getByText("14 Nov 2026, 6:00 PM")).toBeTruthy();
    expect(screen.getByText("1 Nov 2026, 10:30 AM")).toBeTruthy();
  });

  it("lists the restaurant orders on its bill, and says an open one is not in the total", async () => {
    server({
      [EVENT]: () => aFunction({
        restaurantOrders: [
          { id: "o-1", orderNo: "DH-014", table: "B1", outlet: "Fidato Restaurant",
            status: "settled", openedAt: "2026-11-14T19:10", settledAt: "2026-11-14T20:00",
            amount: 1050 },
          { id: "o-2", orderNo: "DH-015", table: null, outlet: "Fidato Restaurant",
            status: "open", openedAt: "2026-11-14T21:05", settledAt: null, amount: 420 },
        ],
        money: { venue: 60000, food: 0, pos: 1050, total: 61050, unpriced: null },
      }),
    });
    eventPage();

    expect(await screen.findByText("DH-014")).toBeTruthy();
    expect(screen.getByText("DH-015")).toBeTruthy();
    expect(screen.getByText("Fidato Restaurant · Table B1 · 14 Nov 2026, 7:10 PM")).toBeTruthy();
    expect(screen.getByText("Settled")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("An open order is not in the total until it is settled.")).toBeTruthy();
    expect(screen.getByText("Restaurant orders", { selector: "dt" })).toBeTruthy();
  });

  it("offers only the packages that are on when a course is added (D27-305)", async () => {
    server({ [EVENT]: () => aFunction(), [SETUP]: twoPackages });
    eventPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a course" }));
    expect(await screen.findByRole("option", { name: /Veg thali/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Old buffet/ })).toBeNull();
  });

  it("warns while the banquet tax is not set (D27-124)", async () => {
    const warning = "Banquet tax is not set: ask the GM to set it before the bill.";
    server({ [EVENT]: () => aFunction({ taxWarning: warning }) });
    eventPage();
    expect(await screen.findByText(warning)).toBeTruthy();
  });

  it("sends a hall price of 0 only with Free ticked (D27-120)", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return { ok: true } as never;
      }
      return aFunction({ agreedAmount: null }) as never;
    });
    eventPage();
    fireEvent.click(await screen.findByText("Set the hall price"));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Free" }));
    await vi.waitFor(() =>
      expect((screen.getByLabelText("Agreed amount") as HTMLInputElement).value).toBe("0"));
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ agreedAmount: 0, free: true });
  });

  it("offers reception no money on a function's bill (D27-132)", async () => {
    server({ [EVENT]: () => aFunction() });
    eventPage();
    expect(await screen.findByText("The bill")).toBeTruthy();
    expect(screen.queryByText("Take an advance")).toBeNull();
    expect(screen.queryByText("Bill the function")).toBeNull();
  });

  it("offers the owner an advance and the bill, then Settle and the invoice (BQ-1)", async () => {
    const owner = () => signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
      fullName: "Group Owner", isGroupAdmin: true, hotels: [],
    } });
    owner();
    server({ [EVENT]: () => aFunction() });
    eventPage();
    expect(await screen.findByText("Take an advance")).toBeTruthy();
    expect(screen.getByText("Bill the function")).toBeTruthy();
    expect(screen.getByText(/No GST receipt voucher/)).toBeTruthy();
  });

  it("after the bill: the figures, Settle, and the invoice once issued", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
      fullName: "Group Owner", isGroupAdmin: true, hotels: [],
    } });
    server({ [EVENT]: () => aFunction({
      status: "completed", bill: { charges: 60000, tax: 3000, paid: 20000, balance: 43000 },
      invoice: "5EL/2026-27/00007",
    }) });
    eventPage();
    expect(await screen.findByText("Settle")).toBeTruthy();
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.getByText("₹43,000")).toBeTruthy();
    expect(screen.getByText("Tax invoice 5EL/2026-27/00007").closest("a")!.getAttribute("href"))
      .toBe(`/h/${HOTEL}/invoices/doc/5EL/2026-27/00007`);
    expect(screen.queryByText("Issue tax invoice")).toBeNull();
    expect(screen.queryByText("Change the hall price")).toBeNull();
  });

  it("says plainly when no restaurant order is charged to it", async () => {
    server({ [EVENT]: () => aFunction() });
    eventPage();

    expect(await screen.findByText("No restaurant orders are charged to this function.")).toBeTruthy();
    expect(screen.queryByText(/not in the total/)).toBeNull();
  });
});

/* ── BQ-1 · the front door ──────────────────────────────────────── */

describe("the front door", () => {
  it("exports the functions a restaurant order may be attached to, and nothing else", async () => {
    expect(Object.keys(frontDoor).sort()).toEqual(["getAttachableFunctions"]);

    const spy = server({
      [`/api/hotels/${HOTEL}/banquet/attachable`]: () => ({
        enabled: true, businessDate: "2026-11-14", functions: [],
      }),
    });
    await expect(frontDoor.getAttachableFunctions(HOTEL))
      .resolves.toEqual({ enabled: true, businessDate: "2026-11-14", functions: [] });
    expect(spy).toHaveBeenCalledWith(`/api/hotels/${HOTEL}/banquet/attachable`);
  });
});
