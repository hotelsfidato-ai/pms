import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { MenuItem, Order, NumberedAddon, Docket } from "@/modules/pos/data/till";
import { OrderPad } from "@/modules/pos/flows/OrderPad";
import TillPage from "@/modules/pos/pages/Till";
import MenuPage from "@/modules/pos/pages/Menu";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";

/* ══════════════════════════════════════════════════════════════════
   CUSTOM ADD-ONS ON THE SCREENS (the owner's D27-291)

   Customise has a Custom add-on: a name, and a price or Free - never a
   default - with its own number. It is its own line under the dish. On a
   dish the kitchen already has, Customise adds lines of their own for the
   next Send - on the Till, and on the Tables pad, which now lists the
   table's dishes already sent. The server's half is
   api/test/modules/pos/customAddons.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;
type Call = { path: string; method: string; body: unknown };

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
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer(body) as never;
  });
  return calls;
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

const thali: MenuItem = {
  id: "i-7", name: "Veg Thali", price: 300, taxRate: 5, isActive: true,
  shortCode: null, isVeg: true, isFavourite: false, offUntil: null, offReason: null,
  prepMinutes: null, ownPrepMinutes: null, course: null, ownCourse: null,
  variations: [], addonGroups: [],
};
const KEBAB: NumberedAddon = {
  id: "na-2", number: 2, name: "Kebab", description: null, price: 120, free: false,
  isActive: true, offUntil: null, offReason: null,
};
const BATCH = () => ({ id: "o-5", orderNo: "12", lines: [], ok: true, opened: false, sent: 2, kotNo: 14 });

/** Types a custom add-on into the open Customise dialog and adds it. */
function typeCustom(panel: HTMLElement, name: string, price: string | "free", times = 1) {
  fireEvent.click(within(panel).getByRole("button", { name: "Custom add-on" }));
  const form = within(panel).getByRole("region", { name: "Custom add-on" });
  fireEvent.change(within(form).getByRole("textbox", { name: /Name/ }), { target: { value: name } });
  if (price === "free") fireEvent.click(within(form).getByRole("checkbox", { name: "Free" }));
  else fireEvent.change(within(form).getByRole("textbox", { name: /Price/ }), { target: { value: price } });
  for (let i = 1; i < times; i++) fireEvent.click(within(form).getByRole("button", { name: "One more" }));
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
}

describe("Tables: a custom add-on on a dish of this round", () => {
  const pad = () => {
    const calls = server({
      [`GET ${API}/till/menu`]: () => ({ categories: [{
        id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [thali] }] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
      [`POST ${API}/till/orders/batch`]: BATCH,
    });
    const sent = vi.fn();
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-7" tableLabel="Table 7"
                open onOpenChange={() => {}} onSent={sent} />
    ));
    return { calls, sent };
  };

  it("is typed with its own number, shows under the dish, and Send carries it", async () => {
    const { calls, sent } = pad();
    fireEvent.click(await screen.findByRole("button", { name: /Veg Thali/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Thali" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Thali" });
    typeCustom(panel, "Extra papad", "40", 2);
    expect(within(panel).getByRole("list", { name: "Custom add-ons" }).textContent)
      .toContain("+ Extra papad ×2");
    expect(panel.textContent, "₹300 for the thali, ₹80 for two papads").toContain("₹380");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));

    expect(await screen.findByText("+ Extra papad ×2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      lines: [{ itemId: "i-7", qty: 1, extras: [{ name: "Extra papad", price: 40, qty: 2 }] }],
    });
  });

  it("has no default price: Add waits for a price or Free, and Free goes as Free", async () => {
    const { calls, sent } = pad();
    fireEvent.click(await screen.findByRole("button", { name: /Veg Thali/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Thali" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Thali" });
    fireEvent.click(within(panel).getByRole("button", { name: "Custom add-on" }));
    const form = within(panel).getByRole("region", { name: "Custom add-on" });
    fireEvent.change(within(form).getByRole("textbox", { name: /Name/ }), { target: { value: "Extra onions" } });
    expect(within(form).getByRole("button", { name: "Add" }), "no price, no Free").toHaveProperty("disabled", true);
    fireEvent.change(within(form).getByRole("textbox", { name: /Price/ }), { target: { value: "0" } });
    expect(within(form).getByRole("button", { name: "Add" }), "0 is not a price - tick Free").toHaveProperty("disabled", true);
    fireEvent.click(within(form).getByRole("checkbox", { name: "Free" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));

    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      lines: [{ itemId: "i-7", extras: [{ name: "Extra onions", free: true, qty: 1 }] }],
    });
  });

  it("a dish with a typed add-on is its own plate: the next tap is a new line", async () => {
    pad();
    const tile = await screen.findByRole("button", { name: /Veg Thali/ });
    fireEvent.click(tile);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Thali" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Thali" });
    typeCustom(panel, "Extra papad", "40");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await screen.findByText("+ Extra papad ×1");
    fireEvent.click(tile);
    expect(screen.getAllByRole("button", { name: "Customise Veg Thali" })).toHaveLength(2);
  });
});

/** An open order: a Thali the kitchen has (l-2), and a Biryani not yet sent (l-1). */
function anOrder(more: Record<string, (body: unknown) => unknown> = {}) {
  const order = {
    id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
    table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
    openedBy: "Owner", eventId: null, eventTitle: null, tenders: [],
    abandonedReason: null, discount: 0, roundOff: 0, net: 650, taxable: 650,
    tax: 33, gross: 683, payable: 683,
    lines: [
      { id: "l-2", name: "Veg Thali", qty: 1, unitPrice: 300, taxRate: 5,
        note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
        parentLineId: null, isAddon: false, variationId: null, numberedAddons: null, extra: null },
      { id: "l-3", name: "Extra papad", qty: 1, unitPrice: 40, taxRate: 5,
        note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
        parentLineId: "l-2", isAddon: false, variationId: null, numberedAddons: null, extra: "custom" },
      { id: "l-1", name: "Veg Biryani", qty: 1, unitPrice: 310, taxRate: 5,
        note: null, voided: false, kotStatus: "pending", addedBy: "Owner",
        parentLineId: null, isAddon: false, variationId: null, numberedAddons: null, extra: null },
    ],
  } as unknown as Order;
  return server({
    [`GET ${API}/pos/outlets`]: () => [{ code: "REST", name: "Fidato Restaurant",
      category: "food", hasKey: false, isActive: true, bills: 0 }],
    [`GET ${API}/till/menu`]: () => ({ categories: [{
      id: "c-1", name: "Main course", prepMinutes: null, course: null, items: [thali] }] }),
    [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
    [`GET ${API}/till/orders`]: () => ({ businessDate: "2026-08-25", orders: [] }),
    [`GET ${API}/till/orders/o-5`]: () => order,
    [`GET ${API}/till/rooms`]: () => ({ rooms: [] }),
    [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
    [`POST ${API}/till/orders/o-5/lines/l-2/extras`]: () => ({ ...order, ok: true }),
    [`POST ${API}/till/orders/batch`]: BATCH,
    ...more,
  });
}

describe("Tables: add-ons on a dish already sent (the pad lists them)", () => {
  it("Customise on the sent Thali puts its add-ons in this round, for it, and Send carries them", async () => {
    const calls = anOrder();
    const sent = vi.fn();
    renderAt(`/pos/${HOTEL}/tables`, "/pos/:code/tables", (
      <OrderPad hotelId={HOTEL} outlet="REST" tableId="t-4" tableLabel="Table 4" orderId="o-5"
                open onOpenChange={() => {}} onSent={sent} />
    ));
    const already = await screen.findByText("Already sent");
    expect(already).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Customise Veg Biryani" }),
      "a dish not yet sent is the Till's, not this list's").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customise Veg Thali" }));

    const panel = await screen.findByRole("dialog", { name: "Add to Veg Thali" });
    expect(within(panel).queryByRole("radio"), "nothing folds into a sent dish").toBeNull();
    expect(within(panel).getByRole("button", { name: "Done" }), "nothing chosen yet").toHaveProperty("disabled", true);
    fireEvent.click(within(panel).getByRole("button", { name: /Add-on 2, Kebab/ }));
    typeCustom(panel, "Extra papad", "40");
    expect(panel.textContent).toContain("+₹160");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));

    expect(await screen.findByText("+ Kebab")).toBeTruthy();
    expect(screen.getByText("+ Extra papad")).toBeTruthy();
    expect(screen.getAllByText("for Veg Thali, already sent")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      orderId: "o-5",
      lines: [
        { qty: 1, extraFor: "l-2", extras: [{ numberedId: "na-2", qty: 1 }] },
        { qty: 1, extraFor: "l-2", extras: [{ name: "Extra papad", price: 40, qty: 1 }] },
      ],
    });
  });
});

describe("the Till: add-ons on a dish the kitchen has", () => {
  it("shows an add-on line under its dish, and Customise on the sent dish adds lines of their own", async () => {
    const calls = anOrder();
    renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);

    expect(await screen.findByText("+ Extra papad")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "One fewer Extra papad" }),
      "its number is set when it goes on").toBeNull();
    expect(screen.queryByRole("button", { name: "Customise Extra papad" })).toBeNull();
    expect(screen.getByRole("button", { name: "Strike Extra papad" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Customise Veg Thali" }));
    const panel = await screen.findByRole("dialog", { name: "Add to Veg Thali" });
    typeCustom(panel, "Ghee", "20");
    fireEvent.click(within(panel).getByRole("button", { name: /Add-on 2, Kebab/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/l-2/extras")))
      .toMatchObject({ body: { extras: [{ numberedId: "na-2", qty: 1 }, { name: "Ghee", price: 20, qty: 1 }] } }));
  });

  it("on a dish not yet sent, typed add-ons go with Customise's set", async () => {
    const calls = anOrder({
      [`POST ${API}/till/orders/o-5/lines/l-1/numbered-addons`]: () => ({ ok: true, id: "o-5", lines: [] }),
    });
    renderAt(`/pos/${HOTEL}/till?order=o-5`, "/pos/:code/till", <TillPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Customise Veg Biryani" }));
    const panel = await screen.findByRole("dialog", { name: "Customise Veg Biryani" });
    typeCustom(panel, "Extra papad", "free");
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/l-1/numbered-addons")))
      .toMatchObject({ body: { numberedAddons: [], extras: [{ name: "Extra papad", free: true, qty: 1 }] } }));
  });
});

describe("the KOT slip", () => {
  it("prints an add-on for a dish of an earlier KOT on its own, naming the dish", () => {
    const d: Docket = {
      kotNo: 14, orderNo: "20260825-5", table: "A7", orderType: "dine_in", outlet: "Fidato Restaurant",
      hotel: "5 Elements", sentAt: "25/08/26 20:42",
      lines: [
        { id: "9", parentId: "2", name: "Extra papad", qty: 1, note: null, isAddon: false,
          extra: true, for: { name: "Veg Thali", kotNo: 12 } },
        { id: "10", parentId: null, name: "Veg Biryani", qty: 2, note: null, isAddon: false },
        { id: "11", parentId: "10", name: "Raita", qty: 1, note: null, isAddon: false, extra: true },
      ],
    };
    render(<DocketSlip d={d} />);
    expect(screen.getByText("+ Extra papad")).toBeTruthy();
    expect(screen.getByText("for: Veg Thali (KOT 12)")).toBeTruthy();
    expect(screen.getByText("+ Raita"), "under its dish on this slip").toBeTruthy();
    expect(screen.getAllByText(/Raita/), "printed once, not also as a dish").toHaveLength(1);
    expect(document.body.textContent).not.toContain("₹");
  });
});

describe("the Add-ons tab: the custom add-ons used", () => {
  it("lists what was typed, and Number it opens the dialog with its name and price", async () => {
    server({
      [`GET ${API}/till/menu`]: () => ({ categories: [] }),
      [`GET ${API}/modules`]: () => ({ modules: {} }),
      [`GET ${API}/till/menu/addon-groups`]: () => ({ groups: [] }),
      [`GET ${API}/till/promotions`]: () => ({ freehandCapPercent: 10, promotions: [] }),
      [`GET ${API}/till/numbered-addons`]: () => ({ addons: [KEBAB] }),
      [`GET ${API}/till/custom-addons-used`]: () => ({ days: 30, used: [
        { name: "Extra papad", price: 40, times: 6, qty: 7, lastAt: "2026-08-25 20:42", by: "Asha, Ravi" },
      ] }),
    });
    renderAt(`/pos/${HOTEL}/menu`, "/pos/:code/menu", <MenuPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Add-ons" }));

    expect(await screen.findByText("Custom add-ons used")).toBeTruthy();
    expect(await screen.findByText("Extra papad")).toBeTruthy();
    expect(screen.getByText(/6 times, 7 in all · by Asha, Ravi/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Number it" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an add-on" });
    expect((within(dialog).getByRole("textbox", { name: /Name/ }) as HTMLInputElement).value).toBe("Extra papad");
    expect((within(dialog).getByRole("textbox", { name: /Price/ }) as HTMLInputElement).value).toBe("40");
  });
});
