import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, AGRA_HOTEL, startSignedIn } from "@/test/app";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";

/** Signed in with this role at the hotel (D27-363: a waiter sends, a manager strikes). */
function asRole(role: Role) {
  const s = useSession.getState();
  useSession.setState({ scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] } });
}
import type { Order } from "@/modules/pos/data/till";
import TillPage from "@/modules/pos/pages/Till";

/* ══════════════════════════════════════════════════════════════════
   FIX ROUND C ON THE TILL (QA of 28 September)

   POS-2 / NA-4  Close unpaid asked through window.prompt(), which the app's
                 window refuses: nothing happened and the day could not close
   D27-117       Charge to room asks first, naming the guest (POS-8)
   D27-119       a dish the kitchen has asks why before it comes off
   The server's side of each is api/test/modules/pos/restaurantFixes.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const API = `/api/hotels/${HOTEL}`;

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const order: Order = {
  id: "o-5", orderNo: "20260825-5", outlet: "REST", outletName: "Fidato Restaurant",
  hotelName: "5 Elements Akkalkot", hotelCity: null, hotelGstin: null,
  table: "4", status: "open", businessDate: "2026-08-25", paymentMethod: null,
  openedBy: "Owner", settledBy: null, settledAt: null, abandonedReason: null,
  ticketId: null, eventId: null, eventTitle: null,
  lines: [{
    id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5,
    note: null, voided: false, kotStatus: "sent", addedBy: "Owner",
    parentLineId: null, isAddon: false, variationId: null,
  }],
  net: 320, discount: 0, discountType: null, discountValue: null,
  discountReason: null, promotionId: null, promotionName: null,
  taxable: 320, tax: 16, taxes: [{ scheme: "gst", rate: 5, tax: 16 }], gross: 336, roundOff: 0, payable: 336, tenders: [],
  covers: null, waiter: null, orderType: "dine_in", customerName: null,
  customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
};

function till({
  rooms = [{ room: "209", guest: "Asha Kulkarni", folioId: "f-1" }] as unknown[],
  refuse = null as string | null,
} = {}) {
  const posts: { path: string; body: unknown }[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    if (method === "POST") {
      posts.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      /* The body as the browser hands it over (it does not survive the
         constructor under vitest: MEMORY, "ApiError has two shapes"). */
      if (refuse) throw Object.assign(new ApiError(409, "Request failed (409)."), { body: { ok: false, reason: refuse } });
      return { ...order, ok: true, status: "settled" } as never;
    }
    const answers: Record<string, unknown> = {
      [`${API}/till/orders`]: { businessDate: "2026-08-25", orders: [] },
      [`${API}/till/menu`]: { categories: [] },
      [`${API}/till/orders/o-5`]: order,
      [`${API}/till/rooms`]: { rooms },
      [`${API}/till/promotions`]: { freehandCapPercent: 10, promotions: [] },
      [`${API}/banquet/attachable`]: { enabled: false, businessDate: "2026-08-25", functions: [] },
    };
    if (path in answers) return answers[path] as never;
    throw new ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/till?order=o-5`]}>
        <Routes><Route path="/pos/:code/till" element={<TillPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return posts;
}

const typeInto = (dialog: HTMLElement, text: string) =>
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: text } });

describe("the Till's questions are asked on screen", () => {
  it("Close unpaid: a dialog that will not close the bill without a reason (POS-2, NA-4)", async () => {
    const posts = till();
    fireEvent.click(await screen.findByRole("button", { name: "Close unpaid" }));
    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close unpaid" }) as HTMLButtonElement;
    expect(close.disabled, "closed unpaid with no reason").toBe(true);

    typeInto(dialog, "Walked out");
    fireEvent.click(close);
    await vi.waitFor(() => expect(posts).toEqual([
      { path: `${API}/till/orders/o-5/abandon`, body: { reason: "Walked out" } }]));
  });

  it("Charge to room asks first, naming the guest, and charges nothing until yes (D27-117)", async () => {
    const posts = till();
    fireEvent.change(await screen.findByPlaceholderText("Room"), { target: { value: "209" } });
    fireEvent.click(screen.getByRole("button", { name: "Charge to room" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("to room 209?");
    expect(dialog.textContent).toContain("Asha Kulkarni");
    expect(posts, "charged before anybody confirmed").toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Charge to room" }));
    await vi.waitFor(() => expect(posts[0]).toMatchObject({
      path: `${API}/till/orders/o-5/settle`, body: { method: "room", room: "209" } }));
  });

  it("a room with two open bills asks whose in the same box, one button each (D27-162)", async () => {
    /* The owner's order of 28 September: room 201 on a changeover, and a
       split bill's company bill beside a guest's. It closed on "yes" and
       asked "who ate?" in a corner, and the order stayed open. */
    const posts = till({ rooms: [
      { room: "201", guest: "Rekha Gaikwad", folioId: "f-1" },
      { room: "201", guest: "Tanvi Bhide", folioId: "f-2", company: "ACME Ltd" },
    ] });
    fireEvent.change(await screen.findByPlaceholderText("Room"), { target: { value: "201" } });
    fireEvent.click(screen.getByRole("button", { name: "Charge to room" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Charge to room" }), "a yes that chooses nobody").toBeNull();
    within(dialog).getByRole("button", { name: "Rekha Gaikwad" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tanvi Bhide - bill to ACME Ltd" }));
    await vi.waitFor(() => expect(posts[0]).toMatchObject({
      path: `${API}/till/orders/o-5/settle`, body: { method: "room", room: "201", folioId: "f-2" } }));
  });

  it("a room charge the server refuses says why in the box that asked (D27-162)", async () => {
    till({ refuse: "Room 209 cannot be charged: nobody is checked in there." });
    fireEvent.change(await screen.findByPlaceholderText("Room"), { target: { value: "209" } });
    fireEvent.click(screen.getByRole("button", { name: "Charge to room" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Charge to room" }));
    expect((await within(dialog).findByRole("alert")).textContent)
      .toBe("Room 209 cannot be charged: nobody is checked in there.");
  });

  it("a dish the kitchen has asks why before it comes off, and sends the reason (D27-119)", async () => {
    asRole("gm");
    const posts = till();
    fireEvent.click(await screen.findByRole("button", { name: "Strike Paneer Tikka" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("The kitchen already has this.");
    expect(posts).toEqual([]);

    typeInto(dialog, "Dropped at the pass");
    fireEvent.click(within(dialog).getByRole("button", { name: "Take it off" }));
    await vi.waitFor(() => expect(posts).toEqual([
      { path: `${API}/till/orders/o-5/lines/l-1/void`, body: { reason: "Dropped at the pass" } }]));
  });

  it("a waiter sends the GM a dish the kitchen has, with the reason (D27-363)", async () => {
    asRole("pos");
    const posts = till();
    fireEvent.click(await screen.findByRole("button", { name: "Strike Paneer Tikka" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("the GM decides");
    typeInto(dialog, "Guest changed their mind");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to the GM" }));
    await vi.waitFor(() => expect(posts).toEqual([{ path: `${API}/till/orders/o-5/requests`,
      body: { kind: "strike_line", lineId: "l-1", reason: "Guest changed their mind" } }]));
  });
});

describe("no restaurant or night-audit screen asks through the browser (POS-2)", () => {
  it("has no window.prompt() or window.confirm() left", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
                 && /window\.(prompt|confirm)\(/.test(
                   readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) found.push(p);
      }
    };
    walk(join(__dirname));
    walk(join(__dirname, "..", "night-audit"));
    expect(found).toEqual([]);
  });
});
