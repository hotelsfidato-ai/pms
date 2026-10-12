import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import GroupPanelPage from "@/modules/reservations/pages/GroupPanel";
import type { GroupDetail, GroupRoom } from "@/modules/reservations/data/groups";

/* ══════════════════════════════════════════════════════════════════
   SETTLE THE MASTER BILL ON THE GROUP'S PAGE (the owner's D27-305 (10))

   The host's account carries the bill's own Settle - any of the hotel's
   ways, "Bill to company" to the city ledger, the GM's reason over the
   credit limit - and Invoices' own "are you sure". The server's half is
   api/test/modules/finance/masterBill.test.ts; this is the page's: what it
   offers to whom, and the requests it sends.
   ══════════════════════════════════════════════════════════════════ */

const SAID = "MBL Travels is over its credit limit by ₹4,000.00.";

const room = (reservationId: string, status: string): GroupRoom => ({
  reservationId, reference: `FH-${reservationId}`, guest: `Guest ${reservationId}`, room: "201",
  roomType: "Deluxe", checkIn: "2026-08-24", checkOut: "2026-08-25", nights: 1, status,
  agreedRate: 3000, routed: true, balance: 0, adults: 2, children: 0,
});

const group = (balance: number, status: string, invoice: string | null = null): GroupDetail => ({
  id: "grp-1", name: "MBL Wedding", blockCode: null, company: null, notes: null, leadId: "a",
  rooms: [room("a", status), room("b", status)],
  master: {
    id: "fol-1", balance, company: "MBL Travels", invoice,
    lines: [{ date: "2026-08-24", description: "Room night", category: "room", amount: 3150, room: "201" }],
  },
  guestBalance: 0,
});

let shown: GroupDetail;
const posted: Array<{ path: string; body: unknown }> = [];
/** The answer the next POST gets: none, taken; a refusal, thrown as the API does. */
let refusal: { reason: string; needs?: string } | null = null;

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  refusal = null;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      if (refusal) {
        /* What the browser holds: the sentence, and the body that names the need. */
        throw Object.assign(new apiModule.ApiError(409, refusal.reason), { body: refusal });
      }
      return { ok: true, number: "MBL/2026-27/00001" } as never;
    }
    if (path.includes("invoice-series")) return [] as never;
    return shown as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: string) => useSession.setState((s) => ({
  scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] },
}));

function open(g: GroupDetail) {
  shown = g;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/h/5EL/groups/grp-1"]}>
          <Routes><Route path="/h/:code/groups/:id" element={<GroupPanelPage />} /></Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function settle(method: string, amount: string) {
  fireEvent.click(await screen.findByRole("button", { name: /Settle/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Method"), { target: { value: method } });
  fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: amount } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Take payment" }));
  return dialog;
}

describe("the host's account on the group's page", () => {
  it("says who the bill is addressed to, and settles it through this group's own payment door", async () => {
    open(group(6300, "checked_in"));
    expect(await screen.findByText("Billed to MBL Travels. Every line says which room it is for.")).toBeTruthy();
    await settle("UPI", "1300");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      path: "/api/hotels/5EL/groups/grp-1/payments",
      body: { method: "UPI", amount: 1300 },
    });
  });

  it("sends it to the city ledger past the credit limit only with the GM's reason", async () => {
    refusal = { reason: SAID, needs: "credit-limit" };
    open(group(5000, "checked_in"));
    const dialog = await settle("Bill to company", "5000");
    expect(await within(dialog).findByText(SAID)).toBeTruthy();
    expect(within(dialog).getByText("The owner, an administrator or the general manager can allow it.")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Why it is allowed")).toBeNull();
  });

  it("lets the GM allow it with a reason, which is sent", async () => {
    as("gm");
    refusal = { reason: SAID, needs: "credit-limit" };
    open(group(5000, "checked_in"));
    const dialog = await settle("Bill to company", "5000");
    await within(dialog).findByText(SAID);
    refusal = null;
    fireEvent.change(within(dialog).getByLabelText("Why it is allowed"), { target: { value: "Cleared by the owner" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow, with reason" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.body).toMatchObject({
      method: "Bill to company", amount: 5000, overLimitReason: "Cleared by the owner" });
  });

  it("offers the tax invoice once every room has left and nothing is owed, and asks first", async () => {
    /* Nothing owed, but a room still staying; every room gone, but money owed. */
    for (const [balance, status] of [[0, "checked_in"], [6300, "checked_out"]] as const) {
      open(group(balance, status));
      expect((await screen.findByRole("button", { name: /Issue tax invoice/ })).hasAttribute("disabled")).toBe(true);
      cleanup();
    }

    open(group(0, "checked_out"));
    fireEvent.click(await screen.findByRole("button", { name: /Issue tax invoice/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("MBL Travels")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue the invoice" }));
    await waitFor(() => expect(posted).toEqual([{ path: "/api/hotels/5EL/groups/grp-1/invoice", body: null }]));
  });

  it("links the invoice once it stands", async () => {
    open(group(0, "checked_out", "MBL/2026-27/00001"));
    const link = await screen.findByRole("link", { name: /Tax invoice MBL\/2026-27\/00001/ });
    expect(link.getAttribute("href")).toBe("/h/5EL/invoices/doc/MBL/2026-27/00001");
    expect(screen.queryByRole("button", { name: /Issue tax invoice/ })).toBeNull();
  });

  it("offers a Viewer neither Settle nor the invoice", async () => {
    as("read_only");
    open(group(6300, "checked_out"));
    await screen.findByText("Billed to MBL Travels. Every line says which room it is for.");
    expect(screen.queryByRole("button", { name: /Settle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Issue tax invoice/ })).toBeNull();
  });
});
