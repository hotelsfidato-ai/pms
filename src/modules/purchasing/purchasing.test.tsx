import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { flatNavigationFor } from "@/components/app/navigation";
import { go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING — the owner's D18-2, D18-3 and D18-4

   What is proved here is what a PERSON is left looking at, never that a
   request went out (MEMORY 291):

     a read that failed says so, and never "nothing has been asked for"
     somebody who may not ask is told, and told whom to ask
     an unpriced line reads "-" and the total reads "-" — never 0
     an order with an unpriced line does not offer Send
     the screen sends the GM to the approvals inbox, not to a second
       Approve button of its own
     the delivery keeps what was ORDERED beside what CAME
     the setting switches a role on and the list says so at once

   The reads are switched per test; the writes are spies.

   ⚠ EVERY TEST USES ITS OWN PROPERTY CODE, and the detail tests their own
   request id. The application's query cache lives as long as this file
   (App.tsx makes it once, staleTime Infinity), so two tests sharing a key
   means the second one reads what the first one cached and the controls
   above do nothing. A code per test is one word and it cannot go wrong;
   ordering the tests around a shared cache is what goes wrong later.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  list: "rows" as "rows" | "empty" | "unreachable",
  mayRaise: true,
  maySet: true,
  priced: [] as unknown[],
  sent: [] as unknown[],
  delivered: [] as unknown[],
  switched: [] as unknown[],
  decided: [] as unknown[],
  approval: "theirs" as "mine" | "theirs" | "none",
  requesters: {} as Record<string, boolean>,
}));

vi.mock("@/modules/purchasing/data/purchasing", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/purchasing/data/purchasing")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");

  const request = (over: Record<string, unknown> = {}) => ({
    id: "waiting", reference: "PO-5EL-2609-0001", state: "waiting",
    reason: "The rice is down to two days",
    store: { id: "main", name: "Main store" }, supplier: null, approvalId: "ap1",
    total: null, lines: 2, unpriced: 1,
    requestedBy: "Store Keeper", requestedAt: "2026-09-18T06:00:00.000Z",
    decidedBy: null, decisionNote: null, orderedBy: null, orderedAt: null,
    receivedBy: null, receivedAt: null, deliveryNote: null, cancelledReason: null,
    ...over,
  });

  const rice = (over: Record<string, unknown> = {}) => ({
    id: "l1", lineNo: 1, itemId: "rice", item: "Basmati rice", unit: "kg",
    quantity: "50.000", unitPrice: null, receivedQuantity: null,
    receivedUnitCost: null, note: null, ...over,
  });
  const oil = (over: Record<string, unknown> = {}) => ({
    id: "l2", lineNo: 2, itemId: "oil", item: "Sunflower oil", unit: "litre",
    quantity: "10.000", unitPrice: "140.00", receivedQuantity: null,
    receivedUnitCost: null, note: null, ...over,
  });

  /* The id in the URL says which state this request is in. */
  const DETAIL: Record<string, { request: unknown; lines: unknown[] }> = {
    waiting: { request: request(), lines: [rice(), oil()] },
    ready: {
      request: request({ id: "ready", state: "ready", total: "4500.00", unpriced: 0,
        decidedBy: "Test GM" }),
      lines: [rice({ unitPrice: "62.00" }), oil()],
    },
    "half-priced": {
      request: request({ id: "half-priced", state: "ready", total: null, unpriced: 1,
        decidedBy: "Test GM" }),
      lines: [rice(), oil()],
    },
    ordered: {
      request: request({ id: "ordered", state: "ordered", total: "4500.00", unpriced: 0,
        supplier: { id: "sup1", name: "Akkalkot Traders" }, decidedBy: "Test GM",
        orderedBy: "Store Keeper", orderedAt: "2026-09-18T07:00:00.000Z" }),
      lines: [rice({ unitPrice: "62.00" })],
    },
    received: {
      request: request({ id: "received", state: "received", total: "4500.00", unpriced: 0,
        supplier: { id: "sup1", name: "Akkalkot Traders" }, decidedBy: "Test GM",
        receivedBy: "Store Keeper", receivedAt: "2026-09-18T09:00:00.000Z",
        deliveryNote: "Five kilos short, agreed with the driver" }),
      lines: [rice({ unitPrice: "62.00", receivedQuantity: "45.000",
                     receivedUnitCost: "64.00" })],
    },
  };

  return {
    ...actual,
    getPurchasing: async () => {
      if (control.list === "unreachable") throw unreachable();
      return {
        me: { mayRaise: control.mayRaise, maySetRequesters: control.maySet },
        stores: [{ id: "main", name: "Main store", isMain: true }],
        suppliers: [{ id: "sup1", name: "Akkalkot Traders" }],
        items: [
          { id: "rice", name: "Basmati rice", unit: "kg", onHand: 12 },
          { id: "oil", name: "Sunflower oil", unit: "litre", onHand: 4 },
        ],
        requests: control.list === "empty" ? [] : [request()],
      };
    },
    getPurchaseRequest: async (_hotel: string, id: string) =>
      DETAIL[id] ?? DETAIL["waiting"],
    getRequesters: async () => ({
      mayChange: control.maySet,
      roles: Object.entries(control.requesters).map(([role, mayRaise]) => ({ role, mayRaise })),
    }),
    setRequester: async (_h: string, role: string, mayRaise: boolean) => {
      control.switched.push({ role, mayRaise });
      control.requesters[role] = mayRaise;
      return { ok: true };
    },
    raiseRequest: async (_h: string, input: unknown) => {
      control.sent.push(input);
      return { ok: true, request: request() };
    },
    priceLine: async (_h: string, _r: string, lineId: string, unitPrice: number | null) => {
      control.priced.push({ lineId, unitPrice });
      return { ok: true };
    },
    sendOrder: async () => ({ ok: true, request: request({ state: "ordered" }) }),
    getPurchaseApproval: async () => {
      if (control.approval === "none") return null;
      return {
        id: "ap1", subject: { table: "purchase_requests", id: "waiting" },
        status: "pending", amount: null, requestedBy: "Store Keeper",
        mayDecide: control.approval === "theirs",
        ...(control.approval === "mine"
          ? { blockedBecause: "You asked for this one, so you cannot be the person who approves it." }
          : {}),
      };
    },
    decidePurchase: async (_h: string, _a: string, decision: string, note?: string) => {
      control.decided.push({ decision, note: note ?? "" });
      return { ok: true, status: decision };
    },
    recordDelivery: async (_h: string, _r: string, input: unknown) => {
      control.delivered.push(input);
      return { ok: true, received: [{ item: "Basmati rice", quantity: 45,
        store: "Main store", onHandHere: 57 }] };
    },
  };
});

const as = (role: string) => signedIn({
  scope: {
    staffId: "44444444-4444-4444-4444-444444444444",
    email: "purchase-test@fidato.in", fullName: "Purchase Test", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

beforeEach(() => {
  startSignedIn();
  control.list = "rows";
  control.mayRaise = true;
  control.maySet = true;
  control.requesters = { stores: true, kitchen_manager: false };
  control.priced.splice(0);
  control.sent.splice(0);
  control.delivered.splice(0);
  control.switched.splice(0);
  control.decided.splice(0);
  control.approval = "theirs";
});

describe("purchasing", () => {
  it("says a read that failed did not load - never that nothing has been asked for", async () => {
    as("stores");
    control.list = "unreachable";
    go("/h/PU1/purchasing");
    render(<App />);

    expect(await screen.findByText("Purchasing did not load")).toBeTruthy();
    expect(screen.queryByText("Nothing has been asked for yet")).toBeNull();

    control.list = "empty";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    const first = await screen.findByRole("button", { name: "Ask to buy something" });
    expect(screen.queryByText("Purchasing did not load")).toBeNull();
    /* One main action on the screen, declared (clarity step 2). */
    expect(first.getAttribute("data-variant")).toBe("primary");
  });

  it("tells somebody whose role may not ask, and who can change it (D18-2)", async () => {
    as("stores");
    control.mayRaise = false;
    control.maySet = false;
    go("/h/PU2/purchasing");
    render(<App />);

    expect(await screen.findByText(/cannot raise a purchase request/)).toBeTruthy();
    expect(screen.getByText(/owner or an administrator changes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask to buy" })).toBeNull();
  });

  it("shows an order with an unpriced line as a dash, never 0", async () => {
    as("stores");
    go("/h/PU3/purchasing");
    render(<App />);

    /* IN THE TABLE. DataTable draws the same rows twice below `sm` - a table
       and a card list, one of them hidden by CSS the test browser does not
       apply - so a bare findByText finds two (the front desk's FD-4 is the
       same markup). The table is the one this test is about. */
    await screen.findByRole("table");
    const row = within(screen.getByRole("table"))
      .getByText("PO-5EL-2609-0001").closest("tr") as HTMLElement;
    expect(within(row).getByText("Waiting for approval")).toBeTruthy();
    /* The total column: a dash, and nowhere a ₹0.00. */
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
    expect(within(row).queryByText("₹0.00")).toBeNull();
  });

  it("offers Approve only to somebody the CORE queue says may decide", async () => {
    /* A purchase is decided where it is, exactly as equipment decides its
       own; the Approvals screen (PUR-2, below) is a second view on the same
       engine. `mayDecide` is the core's answer, never a copy of its
       rule here, so the button and the server cannot disagree. */
    as("stores");
    control.approval = "mine";
    go("/h/PU4/purchasing/waiting");
    render(<App />);

    expect(await screen.findByText(/Waiting for the general manager/)).toBeTruthy();
    /* The person who ASKED is not offered it, and is told why. */
    expect(await screen.findByText(/You asked for this one/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve this purchase" })).toBeNull();
    /* And no Send while a line has no agreed price. */
    expect(screen.queryByRole("button", { name: "Send the order" })).toBeNull();
    expect(screen.getByText(/One line has no agreed price/)).toBeTruthy();
  });

  /* PUR-2 (the owner's D18-19): one Approvals screen at /h/:code/approvals,
     in the menu, a second VIEW on the core engine and not a second engine.
     It lists the waiting purchase request and decides it through the same
     core endpoint the purchase order posts to. */
  it("lists a waiting purchase on the Approvals screen and decides it through the core (PUR-2)", async () => {
    as("gm");
    expect(flatNavigationFor("gm", "PUA").map((i) => i.to)).toContain("/h/PUA/approvals");

    const real = apiModule.api;
    const posted: string[] = [];
    vi.spyOn(apiModule, "api").mockImplementation((async (url: string, init?: RequestInit) => {
      if (url === "/api/hotels/PUA/approvals?status=pending") {
        return {
          me: { staffId: "44444444-4444-4444-4444-444444444444", role: "gm" },
          rows: [{
            id: "ap1", kind: "purchase", subject: { table: "purchase_requests", id: "waiting" },
            reason: "The rice is down to two days", amount: null, status: "pending",
            approverRole: "gm", requestedBy: "Store Keeper",
            requestedAt: "2026-09-18T06:00:00.000Z", decidedBy: null, decidedAt: null,
            decisionNote: null, mayDecide: true,
          }],
        };
      }
      if (url.startsWith("/api/hotels/PUA/approvals/")) {
        posted.push(`${init?.method} ${url}`);
        return {};
      }
      return real(url, init as never);
    }) as never);
    try {
      go("/h/PUA/approvals");
      render(<App />);

      expect(await screen.findByRole("heading", { level: 1, name: "Approvals" })).toBeTruthy();
      expect(await screen.findByText("The rice is down to two days")).toBeTruthy();
      // PUR-3: the link opens the request on purchasing's own page.
      expect(screen.getByRole("link", { name: "Purchase request" }).getAttribute("href"))
        .toBe("/h/PUA/purchasing/waiting");

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await vi.waitFor(() =>
        expect(posted).toEqual(["POST /api/hotels/PUA/approvals/ap1/approved"]));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("lets the general manager approve it, and refuses a refusal with no words", async () => {
    as("gm");
    control.approval = "theirs";
    go("/h/PUC/purchasing/waiting");
    render(<App />);

    const approve = await screen.findByRole("button", { name: "Approve this purchase" });
    expect(approve.getAttribute("data-variant")).toBe("primary");

    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Refuse it" }));
    await vi.waitFor(() => expect(control.decided).toHaveLength(1));
    /* The server is the one that refuses an empty reason; the screen sends
       what was typed and shows the sentence it gets back. */
    expect(control.decided).toEqual([{ decision: "rejected", note: "" }]);
  });

  it("prices a line, and blank puts it back to not agreed", async () => {
    as("stores");
    go("/h/PU5/purchasing/waiting");
    render(<App />);

    const field = await screen.findByLabelText("Agreed price for Basmati rice");
    fireEvent.change(field, { target: { value: "62" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(control.priced).toHaveLength(1));
    expect(control.priced).toEqual([{ lineId: "l1", unitPrice: 62 }]);

    control.priced.splice(0);
    const second = screen.getByLabelText("Agreed price for Sunflower oil");
    fireEvent.change(second, { target: { value: "" } });
    fireEvent.blur(second);
    await vi.waitFor(() => expect(control.priced).toHaveLength(1));
    /* NULL, not 0 — nobody has agreed a price, which is a different fact. */
    expect(control.priced).toEqual([{ lineId: "l2", unitPrice: null }]);
  });

  it("does not offer Send on an approved order that still has an unpriced line", async () => {
    /* The button and the server must agree: the database refuses an
       unpriced order, so the button is not there to be pressed. */
    as("gm");
    go("/h/PUD/purchasing/half-priced");
    render(<App />);

    await screen.findByText(/One line has no agreed price/);
    expect(screen.queryByRole("button", { name: "Send the order" })).toBeNull();
    /* And the order on paper IS offered - somebody reads it over first. */
    expect(screen.getByRole("button", { name: "Download the order" })).toBeTruthy();
  });

  it("offers Send once it is approved and priced, and says the order goes by hand (D18-3)", async () => {
    as("stores");
    go("/h/PU6/purchasing/ready");
    render(<App />);

    const send = await screen.findByRole("button", { name: "Send the order" });
    expect(send.getAttribute("data-variant")).toBe("primary");
    expect(screen.getByRole("button", { name: "Download the order" })).toBeTruthy();

    fireEvent.click(send);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/sent BY HAND/)).toBeTruthy();
  });

  it("keeps what was ordered beside what came", async () => {
    as("stores");
    go("/h/PU7/purchasing/received");
    render(<App />);

    const row = (await screen.findByText("Basmati rice")).closest("tr") as HTMLElement;
    /* BOTH figures on the record: 50 ordered, 45 came. */
    expect(within(row).getByText("50")).toBeTruthy();
    expect(within(row).getByText("45")).toBeTruthy();
    expect(screen.getByText(/Five kilos short/)).toBeTruthy();
    /* Delivered: nothing left to send or receive. */
    expect(screen.queryByRole("button", { name: "Record the delivery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("records a delivery that differs from the order", async () => {
    as("stores");
    go("/h/PU8/purchasing/ordered");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Record the delivery" }));
    const dialog = await screen.findByRole("dialog");
    const came = within(dialog).getByLabelText("How much of the Basmati rice came");
    /* It starts from what was ordered, and is typed over. */
    expect((came as HTMLInputElement).value).toBe("50");
    fireEvent.change(came, { target: { value: "45" } });
    fireEvent.change(within(dialog).getByLabelText("What the Basmati rice cost each"),
      { target: { value: "64" } });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Record the delivery" })[0]!);

    await vi.waitFor(() => expect(control.delivered).toHaveLength(1));
    expect(control.delivered).toEqual([{
      note: undefined,
      lines: [{ lineId: "l1", receivedQuantity: 45, receivedUnitCost: 64 }],
    }]);
  });

  it("records the bill's GST on a delivered line: the amount filled from the rate, claimable asked (D27-238)", async () => {
    as("stores");
    go("/h/PU8/purchasing/ordered");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Record the delivery" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What the Basmati rice cost each"), { target: { value: "60" } });
    fireEvent.change(within(dialog).getByLabelText(/GST rate on the Basmati rice/), { target: { value: "5" } });
    expect((within(dialog).getByLabelText("GST amount on the Basmati rice") as HTMLInputElement).value)
      .toBe("150.00");
    const record = within(dialog).getAllByRole("button", { name: "Record the delivery" })[0]!;
    fireEvent.click(record);
    expect(await within(dialog).findByRole("alert")).toBeTruthy();       // claimable not said
    expect(control.delivered).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Can the GST on the Basmati rice be claimed/), { target: { value: "yes" } });
    fireEvent.click(record);
    await vi.waitFor(() => expect(control.delivered).toHaveLength(1));
    expect(control.delivered[0]).toEqual({
      note: undefined,
      lines: [{ lineId: "l1", receivedQuantity: 50, receivedUnitCost: 60,
                gstRate: 5, gstAmount: 150, gstClaimable: true }],
    });
  });

  it("raises a request, and leaves the price blank where nothing is agreed", async () => {
    as("stores");
    go("/h/PU9/purchasing");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Ask to buy" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Item on line 1"),
      { target: { value: "rice" } });
    fireEvent.change(within(dialog).getByLabelText("How much on line 1"),
      { target: { value: "50" } });
    fireEvent.change(within(dialog).getByLabelText(/What is it for/),
      { target: { value: "The rice is down to two days" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));

    await vi.waitFor(() => expect(control.sent).toHaveLength(1));
    expect(control.sent).toEqual([{
      storeId: "main",
      reason: "The rice is down to two days",
      lines: [{ itemId: "rice", quantity: 50, unitPrice: null }],
    }]);
    /* The END of the act, not the request going out (MEMORY 291): the
       dialog is gone. */
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses a request with no reason, on the screen, before it is sent", async () => {
    as("stores");
    go("/h/PUA/purchasing");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Ask to buy" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Item on line 1"),
      { target: { value: "rice" } });
    fireEvent.change(within(dialog).getByLabelText("How much on line 1"),
      { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(control.sent).toEqual([]);
  });

  it("switches a department head on, and the list says so at once (D18-2)", async () => {
    as("owner");
    go("/h/PUB/purchasing/who-may-ask");
    render(<App />);

    const row = (await screen.findByText("Kitchen Manager")).closest("li") as HTMLElement;
    expect(within(row).getByText("Cannot raise a request")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Switch on" }));

    expect(await screen.findByText("Can raise a request")).toBeTruthy();
    expect(control.switched).toEqual([{ role: "kitchen_manager", mayRaise: true }]);
  });
});
