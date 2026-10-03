import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import {
  getMenu, listOrders, getOrder, listChargeableRooms, getKitchen, getFloor,
  listWaiters, getDocket, getDayEnd, type DayEnd,
} from "@/modules/pos/data/till";
import { readProblem } from "@/components/ui";
import KitchenPage from "@/modules/pos/pages/Kitchen";
import DayEndPage from "@/modules/pos/pages/DayEnd";
import TerminalPage from "@/modules/pos/pages/Terminal";

/* ══════════════════════════════════════════════════════════════════
   REFUSED, FAILED, OR EMPTY — POS-4, and this round's two dates and
   the Kitchen heading (POS-3)

   The till's reads used to catch every failure and answer empty, so a
   screen could not tell a fault from a hotel with nothing in it. These
   tests make the stubbed server fail on purpose and ask what the
   screen says. Each was run against the code before the change and
   seen to fail there (the POS CHANGELOG, 16 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => {
  startSignedIn();
  /* useLiveOrders streams with the real `fetch`, which jsdom cannot
     reach. Left pending, so it neither fails nor retries mid-test. */
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  return qc;
}

const refuse = (status: number, sentence: string) => () => {
  throw new ApiError(status, sentence, { reason: sentence });
};

/* ── The reads ──────────────────────────────────────────────────── */

describe("the till's reads", () => {
  it("throw a server fault instead of answering empty", async () => {
    vi.spyOn(apiModule, "api").mockRejectedValue(
      new ApiError(500, "Request failed (500)."));

    const reads: [string, () => Promise<unknown>][] = [
      ["getMenu", () => getMenu(HOTEL)],
      ["listOrders", () => listOrders(HOTEL)],
      ["getOrder", () => getOrder(HOTEL, "o-1")],
      ["listChargeableRooms", () => listChargeableRooms(HOTEL)],
      ["getKitchen", () => getKitchen(HOTEL)],
      ["getFloor", () => getFloor(HOTEL)],
      ["listWaiters", () => listWaiters(HOTEL)],
      ["getDocket", () => getDocket(HOTEL, "o-1", 1)],
      ["getDayEnd", () => getDayEnd(HOTEL)],
    ];
    for (const [name, read] of reads) {
      await expect(read(), `${name} swallowed a 500`).rejects.toThrow("500");
    }
  });

  it("keep the rooms list kept on the device when a refresh cannot reach the server", async () => {
    /* `till-rooms` is persisted so a room can be charged offline (owner,
       8 September), and the settle panel refetches it every time it
       opens. An empty answer on failure REPLACED the kept list. */
    const kept = [{ room: "203", guest: "A. Guest", folioId: "f-1" }];
    const spy = vi.spyOn(apiModule, "api");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["till-rooms", HOTEL];

    spy.mockResolvedValueOnce({ rooms: kept });
    await qc.fetchQuery({ queryKey: key, queryFn: () => listChargeableRooms(HOTEL) });

    spy.mockRejectedValueOnce(new ApiError(0, "Could not reach the server."));
    await qc.fetchQuery({
      queryKey: key, queryFn: () => listChargeableRooms(HOTEL), staleTime: 0,
    }).catch(() => undefined);

    expect(qc.getQueryData(key)).toEqual(kept);
    expect(qc.getQueryState(key)?.status).toBe("error");
  });

  it("are told apart: refused, unreachable, failed", () => {
    expect(readProblem(new ApiError(403, "Reception is not set up to use the point of sale.")))
      .toEqual({ kind: "refused", reason: "Reception is not set up to use the point of sale." });
    expect(readProblem(new ApiError(0, "Could not reach the server.")))
      .toEqual({ kind: "unreachable" });
    expect(readProblem(new ApiError(502, "Bad gateway")))
      .toMatchObject({ kind: "failed", status: 502 });
    expect(readProblem(null)).toBeNull();
  });
});

/* ── The kitchen ────────────────────────────────────────────────── */

const KITCHEN = `/api/hotels/${HOTEL}/kitchen`;
const kitchenAt = () =>
  renderAt(`/pos/${HOTEL}/kitchen`, "/pos/:code/kitchen", <KitchenPage />);

describe("the Kitchen screen", () => {
  it("has a heading and a tab title that say what the menu says (POS-3)", async () => {
    server({ [KITCHEN]: () => ({ lines: [] }) });
    kitchenAt();

    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" }))
      .toBeTruthy();
    expect(document.title.startsWith("Kitchen")).toBe(true);
  });

  it("says a board that failed did not load, not that nothing is ordered", async () => {
    server({});
    kitchenAt();

    expect(await screen.findByText("The kitchen board did not load")).toBeTruthy();
    expect(screen.queryByText("Nothing ordered yet.")).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("shows the server's sentence when the board is refused", async () => {
    server({
      [KITCHEN]: refuse(403, "This property has no point of sale."),
    });
    kitchenAt();

    expect(await screen.findByText("The kitchen board is not available")).toBeTruthy();
    expect(screen.getByText("This property has no point of sale.")).toBeTruthy();
    expect(screen.queryByText("Nothing ordered yet.")).toBeNull();
  });

  it("keeps the board and says it is not current when a refresh fails", async () => {
    let up = true;
    server({
      [KITCHEN]: () => {
        if (up) return { lines: [] };
        throw new ApiError(0, "Could not reach the server.");
      },
    });
    const qc = kitchenAt();

    expect(await screen.findByText("Nothing ordered yet.")).toBeTruthy();

    up = false;
    await act(() => qc.refetchQueries({ queryKey: ["kitchen"] }));

    expect(await screen.findByText(/Not up to date: no connection\./)).toBeTruthy();
    expect(screen.getByText("Nothing ordered yet.")).toBeTruthy();
  });
});

/* ── Close restaurant day ───────────────────────────────────────── */

const DAY_END = `/api/hotels/${HOTEL}/till/day-end`;
const dayEndAt = () =>
  renderAt(`/pos/${HOTEL}/day-end`, "/pos/:code/day-end", <DayEndPage />);

const A_DAY: DayEnd = {
  outlet: { code: "REST", name: "Fidato Restaurant" },
  businessDate: "2026-08-25",
  summary: {
    settledOrders: 0, settledValue: 0, abandonedOrders: 0, abandonedValue: 0,
    compOrders: 0, discountGiven: 0, byMethod: {},
  },
  blockers: [],
  movements: [],
  cash: {
    opening: 0, expected: 0, counted: null, variance: null,
    varianceReason: null, denominations: [],
  },
  closedAt: null,
  closedBy: null, opened: true,
};

describe("Close restaurant day", () => {
  it("prints the business date the way every other screen does", async () => {
    server({ [DAY_END]: () => A_DAY });
    dayEndAt();

    /* The hotel's name leads since D17-20; this session knows 5EL by its
       code only (`ownerDecisions.test.tsx` has the named case). */
    expect(await screen.findByText(`${HOTEL} · Fidato Restaurant · Tuesday, 25 August 2026`))
      .toBeTruthy();
    expect(screen.queryByText(/Fidato Restaurant · 2026-08-25/)).toBeNull();
  });

  it("does not call a failure 'no restaurant configured'", async () => {
    server({});
    dayEndAt();

    expect(await screen.findByText("The restaurant day did not load")).toBeTruthy();
    expect(screen.queryByText("No outlet")).toBeNull();
  });

  it("shows the server's sentence when it refuses", async () => {
    server({ [DAY_END]: refuse(404, "No outlet REST at this property.") });
    dayEndAt();

    expect(await screen.findByText("The restaurant day is not available")).toBeTruthy();
    expect(screen.getByText("No outlet REST at this property.")).toBeTruthy();
  });
});

/* ── The terminal ───────────────────────────────────────────────── */

describe("the Terminal", () => {
  it("prints the business date the way every other screen does", async () => {
    localStorage.setItem("fidato.terminal-outlet", "REST");
    server({
      [`/api/hotels/${HOTEL}/pos/outlets`]: () => [{
        code: "REST", name: "Fidato Restaurant", category: "food",
        hasKey: false, isActive: true, bills: 0,
      }],
      [`/api/hotels/${HOTEL}/till/menu`]: () => ({ categories: [] }),
      [`/api/hotels/${HOTEL}/till/orders`]: () =>
        ({ businessDate: "2026-08-25", orders: [] }),
    });
    renderAt(`/pos/${HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);

    expect(await screen.findByText("0 open · Tuesday, 25 August 2026")).toBeTruthy();
    expect(screen.queryByText(/2026-08-25/)).toBeNull();
  });

  it("does not say 'No outlet is configured' when the outlets failed to load", async () => {
    server({});
    renderAt(`/pos/${HOTEL}/terminal`, "/pos/:code/terminal", <TerminalPage />);

    expect(await screen.findByText("The outlets did not load")).toBeTruthy();
    expect(screen.queryByText("No outlet is configured")).toBeNull();
  });
});
