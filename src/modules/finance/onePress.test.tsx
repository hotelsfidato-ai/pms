import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   ONE PRESS, ONE LINE (28 September, the release review)

   Post charge and Take payment stayed live while the request was on its
   way, so a double tap posted twice. Each now waits, and sends one key per
   press that the server keeps (api/test/modules/finance/onePress.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(1000 as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function panel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a double tap", () => {
  it("posts one charge, and sends a key with it", async () => {
    const sent = vi.spyOn(postings, "postCharge").mockImplementation(() => new Promise(() => {}));
    panel();
    fireEvent.click(await screen.findByRole("button", { name: /Add charge/ }));
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "Two coffees" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
    const post = screen.getByRole("button", { name: "Post charge" }) as HTMLButtonElement;
    fireEvent.click(post);
    fireEvent.click(post);
    await waitFor(() => expect(post.disabled).toBe(true));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![3]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("takes one payment", async () => {
    const sent = vi.spyOn(postings, "settle").mockImplementation(() => new Promise(() => {}));
    panel();
    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    await screen.findByLabelText("Amount");
    const take = screen.getByRole("button", { name: "Take payment" }) as HTMLButtonElement;
    fireEvent.click(take);
    fireEvent.click(take);
    await waitFor(() => expect(take.disabled).toBe(true));
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
