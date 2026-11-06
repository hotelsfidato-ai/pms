import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";
import { TooltipProvider } from "@/components/ui";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   HOW IT WAS PAID (the owner's D27-397): a payment line on the Bill tab
   gets "Change how it was paid" - the owner, an Admin or the GM, with a
   reason; the front desk asks the GM. Off, saying why, on a closed day. The
   server's half: api/test/modules/front-desk/afterCheckIn.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", status: "in-house", arrival: "2026-09-20", departure: "2026-09-22",
} as unknown as Stay;

const pay = (id: string, description: string, extra: object = {}) => ({
  id, folioId: "f-guest", stayId: "stay-1", billTo: "guest", company: null,
  businessDate: "2026-09-21", category: "payment", description,
  amount: -1500, tax: 0, kind: "payment", reversed: false, createdAt: "2026-09-21T10:00:00Z",
  user: "Test", dayClosed: false, invoice: null, ...extra,
});
const LINES = [
  pay("p-1", "Received - Cash"),
  pay("p-2", "Received - UPI", { dayClosed: true, businessDate: "2026-09-20" }),
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bill(role: Role) {
  signedIn({ scope: {
    staffId: "44444444-4444-4444-4444-444444444444", email: `${role}@fidato.in`,
    fullName: role, isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
  useSession.setState((s) => ({ hotels: s.hotels.map((h) => ({ ...h, deskRules: {
    paymentMethods: [{ label: "Cash", kind: "cash" }, { label: "UPI", kind: "upi" },
      { label: "Bill to company", kind: "city_ledger" }],
  } as apiModule.DeskRules })) }));
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    return (url === "/api/hotels/5EL/stays/stay-1/postings" ? LINES : new Promise(() => {})) as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-21" /></MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return posts;
}

describe("Change how it was paid", () => {
  it("the GM changes it with a reason; never to Bill to company; off on a closed day", async () => {
    const posts = bill("gm");
    const press = await screen.findByRole("button", { name: "Change how it was paid: Received - Cash" });
    expect((screen.getByRole("button", { name: "Change how it was paid: Received - UPI" }) as HTMLButtonElement).disabled,
      "a closed day's payment is not changed").toBe(true);
    fireEvent.click(press);
    const dialog = await screen.findByRole("dialog");
    const ways = within(dialog).getByLabelText(/How it was really paid/) as HTMLSelectElement;
    expect([...ways.options].map((o) => o.value)).toEqual(["", "Cash", "UPI"]);
    fireEvent.change(ways, { target: { value: "UPI" } });
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: "Typed Cash, paid by UPI" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change it" }));
    await waitFor(() => expect(posts).toEqual([{
      url: "/api/hotels/5EL/stays/stay-1/payments/p-1/method",
      body: { method: "UPI", reason: "Typed Cash, paid by UPI" },
    }]));
  });

  it("the front desk asks the GM", async () => {
    const posts = bill("front_desk");
    fireEvent.click(await screen.findByRole("button", { name: "Ask the GM to change how it was paid: Received - Cash" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/How it was really paid/), { target: { value: "UPI" } });
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: "Paid by UPI" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to the GM" }));
    await waitFor(() => expect(posts).toEqual([{
      url: "/api/hotels/5EL/stays/stay-1/requests",
      body: { kind: "payment_method", reason: "Paid by UPI", postingId: "p-1", method: "UPI" },
    }]));
  });
});
