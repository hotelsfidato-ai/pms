import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { toast } from "@/components/ui";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Docket, KotKind, KotSetup, Order } from "@/modules/pos/data/till";
import { KotStationPrinter, KotStatus } from "@/modules/pos/components/KotStation";
import { KotSection } from "@/modules/pos/components/KotSection";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import BillPage from "@/modules/pos/pages/Bill";
import TillPage from "@/modules/pos/pages/Till";
import KitchenPage from "@/modules/pos/pages/Kitchen";

/* ══════════════════════════════════════════════════════════════════
   THE PRINTING COMPUTERS AND THE KOT SECTION ON THE SCREEN (D27-292)

   A computer prints the slips of the kinds it prints, each headed with its
   kind - "BAR KOT 3" - once, claimed per kind, and the bills asked of it,
   headed INTERIM BILL / BILL / BILL · DUPLICATE; any other computer asks
   for nothing. The POS says, per kind something prints to, whether it is
   printing. Restaurant setup's KOT section: this computer's kinds and the
   bills, the kinds, which section prints where. The Kitchen screen's
   filter. Print bill: sent, offline (Print here), or none chosen (opens
   here). Replaces D27-159's one-device-per-outlet tests.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const BASE = `/api/hotels/${HOTEL}/till`;
type Call = { key: string; body: unknown };

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const answer = routes[key];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(body) as never;
  });
  return calls;
}

function show(element: ReactElement, path = `/pos/${HOTEL}/tables`, route = "/pos/:code/tables") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const as = (role: Role) =>
  signedIn({ scope: {
    staffId: "22222222-2222-2222-2222-222222222222", email: "agra@fidato.in",
    fullName: "Agra Clerk", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });

const kind = (over: Partial<KotKind>): KotKind => ({
  id: "k-kitchen", name: "Kitchen", role: "food", fixed: true, station: null, sections: 3, ...over,
});
const KITCHEN = kind({});
const BAR = kind({ id: "k-bar", name: "Bar", role: "bar", sections: 1 });
const setupOf = (over: Partial<KotSetup> = {}): KotSetup => ({
  kinds: [KITCHEN, BAR], stations: [], sections: [], billPrinter: null, me: null, ...over,
});
const ME = { id: "st-1", name: "Bar PC", mine: true, online: true, seenAt: null };

const DOCKET: Docket = {
  kotNo: 3, kind: { id: "k-bar", name: "Bar" }, orderNo: "20260825-3", table: "AC4",
  orderType: "dine_in", outlet: "Restaurant", hotel: "5 Elements", sentAt: "25/08/26 19:05",
  lines: [{ id: "l-1", parentId: null, name: "Kingfisher 650", qty: 2, note: null, isAddon: false }],
};

const ORDER = {
  id: "o-3", orderNo: "20260825-3", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements", hotelCity: "Akkalkot", hotelGstin: null, hotelFssai: null,
  table: "AC4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
  openedBy: "Owner", settledBy: null, eventId: null, eventTitle: null, tenders: [],
  abandonedReason: null, discount: 0, roundOff: 0, net: 300, taxable: 300, tax: 15,
  taxes: [{ scheme: "gst", rate: 5, tax: 15 }], gross: 315, payable: 315, billsPrinted: 0,
  lines: [{ id: "l-1", name: "Veg Thali", qty: 1, unitPrice: 300, taxRate: 5, note: null,
            voided: false, kotStatus: "sent", addedBy: "Owner", parentLineId: null,
            isAddon: false, variationId: null, numberedAddons: null, extra: null }],
} as unknown as Order;

describe("a printing computer prints (D27-159, D27-292)", () => {
  const station = (claimed: boolean, due: boolean, bills: boolean, reprints = false) => {
    let asks = 0;
    const calls = server({
      [`GET ${BASE}/kot-setup`]: () => setupOf({ me: "st-1" }),
      [`POST ${BASE}/kot-stations/poll`]: () => {
        const first = asks++ === 0;
        return {
          station: { id: "st-1", name: "Bar PC", kinds: [{ id: "k-bar", name: "Bar" }], printsBills: true },
          recent: [],
          due: first && due ? [{ orderId: "o-3", kotNo: 3, kindId: "k-bar", kind: "Bar", table: "AC4", sentAt: "", printedAt: null }] : [],
          bills: first && bills ? [{ id: "9", orderId: "o-3", heading: "interim", table: "AC4" }] : [],
          reprints: first && reprints
            ? [{ id: "r-1", orderId: "o-3", kotNo: 3, kindId: "k-bar", kind: "Bar", table: "AC4" }] : [],
        };
      },
      [`GET ${BASE}/orders/o-3/kot/3`]: () => DOCKET,
      [`POST ${BASE}/orders/o-3/kot/3/printed`]: () => ({ ok: true, claimed }),
      [`POST ${BASE}/kot-reprints/r-1/printed`]: () => ({ ok: true, claimed }),
      [`GET ${BASE}/orders/o-3`]: () => ORDER,
      [`POST ${BASE}/bill-prints/9/printed`]: () => ({ ok: true, claimed }),
    });
    const onPaper: string[] = [];
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      onPaper.push(document.querySelector(".kot-print")?.textContent ?? "");
    });
    show(<KotStationPrinter hotelId={HOTEL} />);
    return { calls, print, onPaper, asks: () => asks };
  };

  it("prints its kind's slip once, headed BAR KOT 3, claimed for that kind", async () => {
    const { calls, print, onPaper, asks } = station(true, true, false);
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onPaper[0]).toContain("BAR KOT 3");
    expect(onPaper[0]).toContain("Kingfisher 650");
    expect(onPaper[0]).not.toContain("₹");
    expect(calls.find((c) => c.key === `POST ${BASE}/orders/o-3/kot/3/printed`)?.body)
      .toMatchObject({ kind: "k-bar" });
    /* Waited for (POS-32): the slip leaves in React's next render. */
    await vi.waitFor(() => expect(document.querySelector(".kot-print")).toBeNull());
    await vi.waitFor(() => expect(asks()).toBeGreaterThan(1));
    expect(print).toHaveBeenCalledTimes(1);
  });

  /* D27-334: the bill before payment is a plain BILL - never "interim",
     never "not paid" - as a restaurant hands its guest. */
  it("prints a bill asked of it, headed BILL", async () => {
    const { print, onPaper } = station(true, false, true);
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onPaper[0]).toContain("Bill");
    expect(onPaper[0]).not.toMatch(/interim|not paid/i);
  });

  /* D27-329 (2): Reprint pressed on a waiter's tablet, the Till or the
     Terminal waits here, at the computer that prints that KOT's kind. */
  it("prints a reprint asked of it, marked REPRINT, claimed first", async () => {
    const { calls, print, onPaper } = station(true, false, false, true);
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onPaper[0]).toContain("BAR KOT 3");
    expect(onPaper[0]).toContain("REPRINT");
    expect(onPaper[0]).toContain("Kingfisher 650");
    expect(calls.find((c) => c.key === `POST ${BASE}/kot-reprints/r-1/printed`)?.body)
      .toMatchObject({ device: expect.any(String) });
    expect(calls.some((c) => c.key === `POST ${BASE}/orders/o-3/kot/3/printed`), "not claimed as a new KOT")
      .toBe(false);
  });

  it("prints nothing when another tab claimed it first", async () => {
    const { print } = station(false, true, true, true);
    await new Promise((r) => setTimeout(r, 300));
    expect(print).not.toHaveBeenCalled();
  });

  it("on any other computer asks for nothing and prints nothing", async () => {
    const calls = server({ [`GET ${BASE}/kot-setup`]: () => setupOf() });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show(<KotStationPrinter hotelId={HOTEL} />);
    await vi.waitFor(() => expect(calls.map((c) => c.key)).toContain(`GET ${BASE}/kot-setup`));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.filter((c) => c.key.includes("/poll") || c.key.includes("/kot/"))).toEqual([]);
    expect(print).not.toHaveBeenCalled();
  });
});

describe("the slip says what it is (D27-292)", () => {
  it("BAR KOT 3 at the top, and REPRINT when printed again", () => {
    render(<DocketSlip d={{ ...DOCKET, reprint: true }} />);
    expect(screen.getByText("BAR KOT 3")).toBeTruthy();
    expect(screen.getByText("REPRINT")).toBeTruthy();
  });
});

describe("the POS says, per kind, whether KOTs are printing", () => {
  const lines = async (kinds: KotKind[]) => {
    server({ [`GET ${BASE}/kot-setup`]: () => setupOf({ kinds }) });
    show(<KotStatus hotelId={HOTEL} />);
    await screen.findAllByText(/KOTs/);
    return screen.getAllByText(/KOTs/).map((p) => p.textContent);
  };

  it("online, offline and none - only for a kind some section prints to", async () => {
    expect(await lines([
      kind({ station: { ...ME, name: "Kitchen PC", mine: false } }),
      kind({ id: "k-bar", name: "Bar", role: "bar", station: { ...ME, online: false, seenAt: new Date().toISOString() } }),
      kind({ id: "k-t", name: "Tandoor", role: null, fixed: false }),
      kind({ id: "k-d", name: "Desserts", role: null, fixed: false, sections: 0 }),
    ])).toEqual([
      "Kitchen KOTs: Kitchen PC - online",
      expect.stringMatching(/^Bar KOTs wait: Bar PC not seen since \d{1,2}:\d{2} [AP]M$/),
      "No computer prints Tandoor KOTs - they are not printing",
    ]);
  });

  it("links to the KOT section for whoever may set it up, and only them", async () => {
    as("kitchen_manager");
    server({ [`GET ${BASE}/kot-setup`]: () => setupOf() });
    show(<KotStatus hotelId={HOTEL} />);
    const links = await screen.findAllByRole("link", { name: "Set up" });
    expect(links[0]!.getAttribute("href")).toBe(`/pos/${HOTEL}/setup#kot`);
  });

  it("no link for a waiter", async () => {
    as("pos");
    server({ [`GET ${BASE}/kot-setup`]: () => setupOf() });
    show(<KotStatus hotelId={HOTEL} />);
    await screen.findAllByText(/not printing/);
    expect(screen.queryByRole("link", { name: "Set up" })).toBeNull();
  });
});

describe("Restaurant setup's KOT section", () => {
  it("ticks what this computer prints, under its name, and the bills", async () => {
    as("kitchen_manager");
    const calls = server({
      [`GET ${BASE}/kot-setup`]: () => setupOf({ kinds: [KITCHEN, kind({ ...BAR, station: { ...ME, mine: false, name: "Kitchen PC" } })] }),
      [`POST ${BASE}/kot-setup/this-computer`]: () => ({ ok: true }),
    });
    show(<KotSection hotelId={HOTEL} />);
    const me = (await screen.findByText("This computer")).closest("div")!.parentElement!;
    expect(me.textContent).toContain("Kitchen PC prints them now. Ticked here, they move here.");
    fireEvent.change(within(me).getByRole("textbox", { name: /name/ }), { target: { value: "Bar PC" } });
    fireEvent.click(within(me).getByRole("checkbox", { name: "Prints Bar KOTs" }));
    fireEvent.click(within(me).getByRole("checkbox", { name: "Prints the bills" }));
    fireEvent.click(within(me).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(calls.find((c) => c.key === `POST ${BASE}/kot-setup/this-computer`)?.body)
      .toMatchObject({ name: "Bar PC", kindIds: ["k-bar"], bills: true }));
  });

  it("adds a KOT, and sends a section elsewhere - pre-filled from its heading", async () => {
    const calls = server({
      [`GET ${BASE}/kot-setup`]: () => setupOf({ sections: [
        { id: "c-1", name: "Mocktails", heading: "restaurant", own: null, kind: "k-kitchen" },
      ] }),
      [`POST ${BASE}/kot-setup/kinds`]: () => ({ ok: true, id: "k-t" }),
      [`POST ${BASE}/kot-setup/sections/c-1`]: () => ({ ok: true }),
    });
    show(<KotSection hotelId={HOTEL} />);
    const select = await screen.findByRole("combobox", { name: "Mocktails prints on" }) as HTMLSelectElement;
    expect(select.value, "no kind of its own: its heading decides").toBe("");
    expect(select.options[0]!.textContent).toBe("Kitchen (by its heading)");
    fireEvent.change(select, { target: { value: "k-bar" } });
    await vi.waitFor(() => expect(calls.find((c) => c.key === `POST ${BASE}/kot-setup/sections/c-1`)?.body)
      .toEqual({ kindId: "k-bar" }));

    fireEvent.click(screen.getByRole("button", { name: "Add a KOT" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a KOT" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Tandoor" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(calls.find((c) => c.key === `POST ${BASE}/kot-setup/kinds`)?.body)
      .toEqual({ name: "Tandoor" }));
  });

  it("Kitchen and Bar are renamed, never switched off; an added one is", async () => {
    server({ [`GET ${BASE}/kot-setup`]: () => setupOf({ kinds: [KITCHEN, BAR, kind({ id: "k-t", name: "Tandoor", role: null, fixed: false })] }) });
    show(<KotSection hotelId={HOTEL} />);
    await screen.findByText("Tandoor");
    expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Switch off" })).toHaveLength(1);
  });
});

describe("the Kitchen screen's filter (D27-292)", () => {
  it("shows one kind's lines, remembered on this computer; the KOT printer button is gone", async () => {
    server({
      [`GET /api/hotels/${HOTEL}/kitchen`]: () => ({ lines: [
        { id: "1", orderNo: "1", table: "AC1", orderType: "dine_in", outlet: "REST", name: "Paneer Tikka",
          qty: 1, note: null, status: "sent", waitedSeconds: 30, prepMinutes: null, course: null,
          cancelled: false, kindId: "k-kitchen" },
        { id: "2", orderNo: "1", table: "AC1", orderType: "dine_in", outlet: "REST", name: "Kingfisher 650",
          qty: 2, note: null, status: "sent", waitedSeconds: 30, prepMinutes: null, course: null,
          cancelled: false, kindId: "k-bar" },
      ] }),
      [`GET ${BASE}/kot-setup`]: () => setupOf(),
    });
    show(<KitchenPage />, `/pos/${HOTEL}/kitchen`, "/pos/:code/kitchen");
    expect(await screen.findByText(/Kingfisher 650/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "KOT printer" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Bar" }));
    expect(screen.queryByText(/Paneer Tikka/)).toBeNull();
    expect(screen.getByText(/Kingfisher 650/)).toBeTruthy();
    expect(localStorage.getItem("pms.kitchen-kind")).toBe("k-bar");
  });
});

describe("Print the bill (D27-292)", () => {
  const settled = { ...ORDER, status: "settled", paymentMethod: "upi" } as unknown as Order;
  const till = (answer: unknown) => {
    const calls = server({
      [`GET ${BASE}/menu`]: () => ({ categories: [] }),
      [`GET ${BASE}/numbered-addons`]: () => ({ addons: [] }),
      [`GET ${BASE}/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
      [`GET ${BASE}/orders/o-3`]: () => settled,
      [`GET ${BASE}/rooms`]: () => ({ rooms: [] }),
      [`GET ${BASE}/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`GET ${BASE}/kot-setup`]: () => setupOf(),
      [`POST ${BASE}/orders/o-3/bill-print`]: () => answer,
    });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    show(<TillPage />, `/pos/${HOTEL}/till?order=o-3`, "/pos/:code/till");
    return { calls, opened };
  };

  it("goes to the bill printer, and the screen says where", async () => {
    const said = vi.spyOn(toast, "success");
    const { opened } = till({ ok: true, heading: "bill", sentTo: { name: "Bar PC", online: true } });
    fireEvent.click(await screen.findByRole("button", { name: /Print the bill/ }));
    await vi.waitFor(() => expect(said).toHaveBeenCalledWith("Bill sent to Bar PC"));
    expect(opened).not.toHaveBeenCalled();
  });

  it("offline, it offers Print here, which opens the bill on this device", async () => {
    const { opened } = till({ ok: true, heading: "duplicate", sentTo: { name: "Bar PC", online: false } });
    fireEvent.click(await screen.findByRole("button", { name: /Print the bill/ }));
    const dialog = await screen.findByRole("dialog", { name: "Bar PC is offline" });
    expect(dialog.textContent).toContain("The bill · duplicate waits there");
    fireEvent.click(within(dialog).getByRole("button", { name: "Print here" }));
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(`/pos/${HOTEL}/bill/o-3`, "_blank"));
  });

  it("with no bill printer chosen, the bill opens here as before", async () => {
    const { opened } = till({ ok: true, heading: "bill", sentTo: null });
    fireEvent.click(await screen.findByRole("button", { name: /Print the bill/ }));
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(`/pos/${HOTEL}/bill/o-3`, "_blank"));
  });
});

describe("the bill page says what it is, and Print here writes it down first", () => {
  const page = (order: Order, heading: string) => {
    const calls = server({
      [`GET ${BASE}/orders/o-3`]: () => order,
      [`POST ${BASE}/orders/o-3/bill-print/here`]: () => ({ ok: true, heading }),
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    show(<BillPage />, `/pos/${HOTEL}/bill/o-3`, "/pos/:code/bill/:id");
    return { calls, print };
  };

  it("BILL before payment, never Interim (D27-334)", async () => {
    page(ORDER, "interim");
    expect(await screen.findByText("Bill")).toBeTruthy();
    expect(screen.queryByText(/interim/i)).toBeNull();
  });

  it("BILL after payment, and BILL · DUPLICATE once one was printed", async () => {
    page({ ...ORDER, status: "settled", paymentMethod: "upi", billsPrinted: 1 } as unknown as Order, "duplicate");
    expect(await screen.findByText("Bill · duplicate")).toBeTruthy();
  });

  it("Print here asks the server first, then prints", async () => {
    const { calls, print } = page({ ...ORDER, status: "settled", paymentMethod: "upi" } as unknown as Order, "duplicate");
    expect(await screen.findByText("Bill")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Print here/ }));
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    expect(calls.map((c) => c.key)).toContain(`POST ${BASE}/orders/o-3/bill-print/here`);
    expect(screen.getByText("Bill · duplicate"), "the paper says what the server said").toBeTruthy();
  });
});
