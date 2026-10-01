import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import { GuestOrders } from "@/modules/pos/components/GuestOrders";

/* In-room dining on the Terminal (D27-224): a guest's order waits with its
   room; Accept and send goes to the batch route with guestOrderId; Decline
   asks why before anything is sent. */

const API = `/api/hotels/${HOTEL}`;

function serve() {
  const posts: { path: string; body: unknown }[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ path: url, body: JSON.parse(String(init.body)) });
      return { ok: true, id: "o-9", lines: [] } as never;
    }
    return { orders: [{ id: "g-1", room: "201", note: "No chilli", createdAt: "2026-10-01T19:00",
      lines: [{ name: "Dal Tadka", qty: 2, unitPrice: 260 }] }] } as never;
  });
  const accepted = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GuestOrders hotelId={HOTEL} onAccepted={accepted} />
    </QueryClientProvider>,
  );
  return { posts, accepted };
}

beforeEach(() => { startSignedIn(); vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("guests' room-service orders on the Terminal", () => {
  it("shows the room and the dishes; Accept and send asks the batch route for that guest order", async () => {
    const { posts, accepted } = serve();
    expect(await screen.findByText("Room 201")).toBeTruthy();
    expect(screen.getByText("2 × Dal Tadka")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept and send" }));
    await vi.waitFor(() => expect(posts[0]).toEqual({ path: `${API}/till/orders/batch`, body: { guestOrderId: "g-1" } }));
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledWith("o-9"));
  });

  it("Decline asks why first", async () => {
    const { posts } = serve();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("The guest reads your reason");
    expect(posts, "declined without a reason").toEqual([]);
  });
});
