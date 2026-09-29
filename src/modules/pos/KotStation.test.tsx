import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { Docket, KotStationOutlet } from "@/modules/pos/data/till";
import { KotStationPrinter, KotStatus } from "@/modules/pos/components/KotStation";

/* ══════════════════════════════════════════════════════════════════
   THE KOT STATION ON THE SCREEN (D27-159, D27-161)

   The station prints each new KOT once, through the browser's print,
   with the slip in the page while it prints; a device that is not the
   station asks for nothing and prints nothing; a claim another tab won
   prints nothing; and the POS says, in the owner's words, whether KOTs
   are printing.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const BASE = `/api/hotels/${HOTEL}/till`;

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: string[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    calls.push(key);
    const answer = routes[key];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(typeof init?.body === "string" ? JSON.parse(init.body) : undefined) as never;
  });
  return calls;
}

function show(element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
}

const outlet = (station: KotStationOutlet["station"]): KotStationOutlet[] =>
  [{ code: "REST", name: "Restaurant", station }];

const DOCKET: Docket = {
  kotNo: 3, orderNo: "20260825-3", table: "AC4", orderType: "dine_in",
  outlet: "Restaurant", hotel: "5 Elements", sentAt: "25/08/26 19:05",
  lines: [{ id: "l-1", parentId: null, name: "Paneer Tikka", qty: 2, note: null, isAddon: false }],
};

describe("the KOT station prints (D27-159)", () => {
  it("prints a new KOT once, with the slip in the page while it prints", async () => {
    let asks = 0;
    const calls = server({
      [`GET ${BASE}/kot-station`]: () => ({
        outlets: outlet({ name: "Kitchen PC", mine: true, seenAt: null, online: true }),
      }),
      [`POST ${BASE}/kot-station/REST/poll`]: () => ({
        station: true, recent: [],
        due: asks++ === 0 ? [{ orderId: "o-3", kotNo: 3, table: "AC4", sentAt: "", printedAt: null }] : [],
      }),
      [`GET ${BASE}/orders/o-3/kot/3`]: () => DOCKET,
      [`POST ${BASE}/orders/o-3/kot/3/printed`]: () => ({ ok: true, claimed: true }),
    });
    const onPaper: string[] = [];
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      onPaper.push(document.querySelector(".kot-print")?.textContent ?? "");
    });

    show(<KotStationPrinter hotelId={HOTEL} />);

    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onPaper[0]).toContain("KOT - 3");
    expect(onPaper[0]).toContain("Paneer Tikka");
    expect(onPaper[0]).not.toContain("₹");
    /* The claim came before the paper, and the slip left the page after. */
    expect(calls.indexOf(`POST ${BASE}/orders/o-3/kot/3/printed`)).toBeGreaterThan(-1);
    expect(document.querySelector(".kot-print")).toBeNull();
    await vi.waitFor(() => expect(asks).toBeGreaterThan(1));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("prints nothing when another tab claimed it first", async () => {
    server({
      [`GET ${BASE}/kot-station`]: () => ({
        outlets: outlet({ name: "Kitchen PC", mine: true, seenAt: null, online: true }),
      }),
      [`POST ${BASE}/kot-station/REST/poll`]: () => ({
        station: true, recent: [],
        due: [{ orderId: "o-3", kotNo: 3, table: "AC4", sentAt: "", printedAt: null }],
      }),
      [`GET ${BASE}/orders/o-3/kot/3`]: () => DOCKET,
      [`POST ${BASE}/orders/o-3/kot/3/printed`]: () => ({ ok: true, claimed: false }),
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show(<KotStationPrinter hotelId={HOTEL} />);

    await new Promise((r) => setTimeout(r, 300));
    expect(print).not.toHaveBeenCalled();
  });

  it("on any other device asks for nothing and prints nothing", async () => {
    const calls = server({
      [`GET ${BASE}/kot-station`]: () => ({
        outlets: outlet({ name: "Kitchen PC", mine: false, seenAt: null, online: true }),
      }),
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show(<KotStationPrinter hotelId={HOTEL} />);

    await vi.waitFor(() => expect(calls).toContain(`GET ${BASE}/kot-station`));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.filter((c) => c.includes("/poll") || c.includes("/kot/"))).toEqual([]);
    expect(print).not.toHaveBeenCalled();
  });
});

describe("the POS says whether KOTs are printing (D27-161)", () => {
  const status = async (station: KotStationOutlet["station"]) => {
    server({ [`GET ${BASE}/kot-station`]: () => ({ outlets: outlet(station) }) });
    show(<KotStatus hotelId={HOTEL} />);
    return (await screen.findByText(/KOT printer/)).textContent;
  };

  it("online", async () => {
    expect(await status({ name: "Kitchen PC", mine: false, seenAt: new Date().toISOString(), online: true }))
      .toBe("KOT printer: Kitchen PC - online");
  });

  it("not seen for a while", async () => {
    const text = await status({ name: "Kitchen PC", mine: false, seenAt: new Date().toISOString(), online: false });
    expect(text).toMatch(/^KOT printer Kitchen PC not seen since \d{1,2}:\d{2} [AP]M - KOTs are not printing$/);
  });

  it("none switched on", async () => {
    expect(await status(null)).toBe("No KOT printer for Restaurant - KOTs are not printing");
  });
});
