import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { MoveRoomFlow } from "@/modules/front-desk/flows/MoveRoomFlow";
import type { Stay } from "@/data/repositories";

/* D27-204, D27-205: the first night is posted at check-in, and a move with a
   new rate on the arrival day puts that night right. So the Move dialog no
   longer says "Nights already posted stay as they are" - tonight's may not. */

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Move dialog's words about money", () => {
  it("say the nights before tonight stay as they are", () => {
    startSignedIn();
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
    const stay = { id: "stay-1", hotelId: "5EL", guest: "A Guest", roomNumber: "210",
      arrival: "2026-09-30", departure: "2026-10-03", nights: 3, status: "in-house",
      offeredTariff: 3809.52 } as unknown as Stay;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MoveRoomFlow hotelId="5EL" stay={stay} businessDate="2026-09-30" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const words = screen.getByText(/Moving rooms changes no charge on its own/).textContent!;
    expect(words).toContain("Nights before tonight stay as they are - the guest slept in 210 for them.");
    expect(words).toContain("A new rate applies from tonight forward");
    expect(words).not.toContain("already posted");
  });
});
