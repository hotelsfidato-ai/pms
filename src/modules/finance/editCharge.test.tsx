import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";
import { TooltipProvider } from "@/components/ui";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   EDIT A CHARGE (the owner's D27-157, D27-162)

   The owner, an administrator or the GM put a charge's price or words right
   with a reason, in one press; reception does not see the pencil. It is off,
   saying why, on a line whose day the night audit has closed and on a bill
   with a tax invoice. The server's half: api/test/modules/finance/editCharge.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", status: "in-house", arrival: "2026-09-20", departure: "2026-09-22",
} as unknown as Stay;

const line = (id: string, description: string, extra: object = {}) => ({
  id, folioId: "f-guest", stayId: "stay-1", billTo: "guest", company: null,
  businessDate: "2026-09-21", category: "laundry", description,
  amount: 200, tax: 10, kind: "charge", reversed: false, createdAt: "2026-09-21T10:00:00Z",
  user: "Test", dayClosed: false, invoice: null, ...extra,
});
const LINES = [
  line("p-1", "Laundry · 2 shirts"),
  line("p-2", "Room 204 · 1 night", { category: "room", dayClosed: true, businessDate: "2026-09-20" }),
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bill(role: Role) {
  signedIn({ scope: {
    staffId: "44444444-4444-4444-4444-444444444444", email: `${role}@fidato.in`,
    fullName: role, isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
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

describe("Edit on a charge", () => {
  it("corrects the price with a reason in one press, for the GM; off on a closed day; not reception's", async () => {
    const posts = bill("gm");
    const edit = await screen.findByRole("button", { name: "Edit Laundry · 2 shirts" });
    expect((screen.getByRole("button", { name: "Edit Room 204 · 1 night" }) as HTMLButtonElement).disabled,
      "a closed day's line is Closed days' to correct").toBe(true);

    fireEvent.click(edit);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Price before tax"), { target: { value: "150" } });
    const press = within(dialog).getByRole("button", { name: "Correct the charge" }) as HTMLButtonElement;
    expect(press.disabled, "corrected with no reason").toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: "One shirt, not two" } });
    fireEvent.click(press);
    await waitFor(() => expect(posts).toEqual([{
      url: "/api/hotels/5EL/stays/stay-1/charges/p-1/edit",
      body: { description: "Laundry · 2 shirts", amount: 150, reason: "One shirt, not two" },
    }]));

    cleanup();
    bill("front_desk");
    await screen.findByText("Laundry · 2 shirts");
    expect(screen.queryByRole("button", { name: "Edit Laundry · 2 shirts" })).toBeNull();
  });
});

describe("Change rate on the stay", () => {
  it("sends the new rate a night with its reason, for the GM; reception has no such button", async () => {
    const posts = bill("gm");
    fireEvent.click(await screen.findByRole("button", { name: "Change rate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/New rate a night/), { target: { value: "8000" } });
    const press = within(dialog).getByRole("button", { name: "Change the rate" }) as HTMLButtonElement;
    expect(press.disabled, "changed with no reason").toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: "Corporate rate" } });
    fireEvent.click(press);
    await waitFor(() => expect(posts).toEqual([{
      url: "/api/hotels/5EL/stays/stay-1/rate", body: { rate: 8000, reason: "Corporate rate" } }]));

    cleanup();
    bill("front_desk");
    await screen.findByText("Laundry · 2 shirts");
    expect(screen.queryByRole("button", { name: "Change rate" })).toBeNull();
  });
});
