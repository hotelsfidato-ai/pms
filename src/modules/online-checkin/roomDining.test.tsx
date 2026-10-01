import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import RoomDining from "@/modules/online-checkin/RoomDining";

/* ══════════════════════════════════════════════════════════════════
   IN-ROOM DINING ON THE GUEST'S PAGE (D27-224, D27-225)

   A tap puts a dish in the basket, a dish with choices asks them in the
   waiter's pop-up without its per-dish note (Q2), the one note goes with
   the order (Q3), prices say "GST added on your bill"; nothing to show,
   nothing drawn. The server's half: api/test/modules/pos/roomDining.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const dish = (over: Record<string, unknown>) => ({
  id: "i-1", name: "Butter Roti", price: 40, isVeg: true, variations: [], addonGroups: [], ...over,
});
const PAU = dish({ id: "i-2", name: "Bhaaji Pau", price: 1,
  variations: [{ id: "v-1", label: "Oil", price: 300, typeNo: 1, kind: "option", heading: "Cooked in" }] });

function serve(menu: unknown[], orders: unknown[] = []) {
  const posts: { path: string; body: unknown }[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ path: url, body: JSON.parse(String(init.body)) });
      return { id: "g-1" } as never;
    }
    if (url.endsWith("/menu")) return { sections: menu.length ? [{ name: "Main course", items: menu }] : [] } as never;
    return { orders } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RoomDining token="tok" onUnlockGone={() => {}} />
    </QueryClientProvider>,
  );
  return posts;
}

beforeEach(() => vi.stubGlobal("fetch", () => new Promise(() => {})));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the guest's room-service order", () => {
  it("taps a dish twice into one line, sends one note, and says GST is added", async () => {
    const posts = serve([dish({})]);
    const roti = await screen.findByRole("button", { name: /Butter Roti/ });
    fireEvent.click(roti);
    fireEvent.click(roti);
    expect(screen.getAllByRole("button", { name: "One less Butter Roti" })).toHaveLength(1);
    expect(screen.getAllByText(/GST added on your bill/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("A note for the kitchen"), { target: { value: "No butter" } });
    fireEvent.click(screen.getByRole("button", { name: "Order" }));
    await vi.waitFor(() => expect(posts[0]).toMatchObject({ path: "/api/guest/tok/orders",
      body: { lines: [{ itemId: "i-1", qty: 2 }], note: "No butter" } }));
  });

  it("asks a dish's choices in the waiter's pop-up, without a note per dish", async () => {
    serve([PAU]);
    fireEvent.click(await screen.findByRole("button", { name: /Bhaaji Pau/ }));
    expect(await screen.findByText("Cooked in")).toBeTruthy();
    expect(screen.queryByText("Note for the kitchen"), "a per-dish note for the guest").toBeNull();
  });

  it("draws nothing when the restaurant is not taking orders and none are waiting", async () => {
    serve([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Order to your room")).toBeNull();
  });
});
