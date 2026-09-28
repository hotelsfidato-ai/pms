import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import * as stayExtras from "@/modules/front-desk/data/stayExtras";
import * as staysData from "@/modules/front-desk/data/stays";
import * as operations from "@/modules/front-desk/data/operations";
import { LateCheckOutFlow } from "@/modules/front-desk/flows/LateCheckOutFlow";
import { AGRA_HOTEL, HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   A CONTROL THE SERVER REFUSES IS NOT OFFERED (the owner's D24-18,
   D24-27, and their answers of 24 September)

   Each control asks the question roleGate asks of its write, from the one
   matrix: a walk-in is `reservation: create`; a check-in, the stay's
   changes and a move are `reservation: edit`; the VIP mark and the
   WhatsApp tick are the guest's record, `customer: edit`; "Settle and
   check out" is for whoever may take the payment OR check out; the late
   check-out's waive is the server's own `mayWaive`. Who may do what is
   unchanged - only what is drawn.
   ══════════════════════════════════════════════════════════════════ */

const realListStays = staysData.listStays;

beforeEach(() => {
  startSignedIn();
  try { localStorage.clear(); } catch { /* not fatal */ }
  /* The marks load for everybody; waiting for the pill proves the tick had
     its chance to appear. */
  vi.spyOn(stayExtras, "getGuestMarks")
    .mockResolvedValue({ stayedBefore: 2, whatsappAgreed: false });
  /* The fixtures' stays carry no guest id, and the VIP mark needs one. */
  vi.spyOn(staysData, "listStays").mockImplementation(async (h) =>
    (await realListStays(h)).map((s) => ({ ...s, guestId: `guest-${s.id}` })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: Role) => signedIn({ scope: {
  staffId: "44444444-4444-4444-4444-444444444444", email: `${role}@fidato.in`,
  fullName: role, isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
} });

const freeTiles = () => [...document.querySelectorAll("[data-room-tile]")]
  .filter((t) => (t.textContent ?? "").includes("Free"));

describe("the Rooms board and the Calendar", () => {
  it("opens a walk-in from a free room's tile for reception; for housekeeping the tile is no control", async () => {
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    await waitFor(() => expect(freeTiles().length).toBeGreaterThan(0));
    expect(freeTiles().map((t) => t.tagName)).not.toContain("DIV");
    cleanup();

    as("housekeeping");
    render(<App />);
    await waitFor(() => expect(freeTiles().length).toBeGreaterThan(0));
    expect(freeTiles().map((t) => t.tagName)).not.toContain("BUTTON");
  });

  it("offers the Calendar's Book room cells to reception, and none to housekeeping", async () => {
    go(`/h/${HOTEL}/calendar`);
    const first = render(<App />);
    await waitFor(() => expect(first.container.querySelectorAll("[data-room-row]")).toHaveLength(17));
    expect(screen.getAllByRole("button", { name: /^Book room/ }).length).toBeGreaterThan(0);
    cleanup();

    as("housekeeping");
    const second = render(<App />);
    await waitFor(() => expect(second.container.querySelectorAll("[data-room-row]")).toHaveLength(17));
    expect(screen.queryAllByRole("button", { name: /^Book room/ })).toHaveLength(0);
  });

  /* The owner, 24 September: a tile names the guest IN the room. 204's
     guest (Ganesh Patil) leaves today and the room is held for today's
     arrival (Lata Bhosale); the tile said "Due out" over her name. */
  it("names the guest in the room, not the arrival it is held for", async () => {
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll("[data-tile-guest]").length).toBeGreaterThan(0));
    const tile = document.querySelector('[data-room-tile="204"]')!;
    expect(tile.querySelector("[data-tile-guest]")?.textContent).toBe("Ganesh Patil");
  });
});

/* What the stay panel offers, read off the panel for one booking. */
async function offered(stayId: string) {
  go(`/h/${HOTEL}/stay?res=${stayId}`);
  render(<App />);
  const panel = await screen.findByRole("dialog");
  await within(panel).findByText("Stayed with the group 2 times");
  const has = (role: string, name: RegExp) => !!within(panel).queryByRole(role, { name });
  const seen = {
    checkIn: has("button", /^Check in$/),
    settle: has("button", /Settle and check out/),
    vip: has("button", /Mark VIP|Remove VIP/),
    whatsapp: has("checkbox", /Agreed to WhatsApp/),
    more: has("button", /More options/),
    /* D27-143: the Bill tab only for a role given bills. */
    bill: has("tab", /^Bill$/),
  };
  cleanup();
  return seen;
}

describe("the stay panel", () => {
  it("offers reception every act, and housekeeping none of them", async () => {
    /* stay-comp is in the house (206); stay-turn-in arrives today (204). */
    expect(await offered("stay-comp")).toEqual(
      { checkIn: false, settle: true, vip: true, whatsapp: true, more: true, bill: true });
    expect((await offered("stay-turn-in")).checkIn).toBe(true);

    as("housekeeping");
    expect(await offered("stay-comp")).toEqual(
      { checkIn: false, settle: false, vip: false, whatsapp: false, more: false, bill: false });
    expect((await offered("stay-turn-in")).checkIn).toBe(false);
  });

  it("keeps Settle and check out for the accountant, who may take the payment", async () => {
    as("finance");
    expect(await offered("stay-comp")).toEqual(
      { checkIn: false, settle: true, vip: false, whatsapp: false, more: false, bill: true });
  });
});

describe("the late check-out's waive", () => {
  const STAY = {
    id: "stay-1", hotelId: "5EL", reference: "FH-2608-4858", guest: "Rekha Gaikwad",
    roomNumber: "201", status: "due-out",
  } as unknown as Stay;

  function openAs(role: Role, serverMayWaive: boolean) {
    as(role);
    vi.spyOn(operations, "earlyArrival").mockResolvedValue({
      isEarly: false, checkInTime: "14:00", checkOutTime: "11:00", charge: null,
      lateCharge: 1000, mayWaive: serverMayWaive,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LateCheckOutFlow hotelId="5EL" stay={STAY} checkOutTime="11:00" charge={1000}
          open onOpenChange={() => {}} onDone={() => {}} />
      </QueryClientProvider>,
    );
  }

  /* A hotel's own administrator holds `reservation: approve`, which the
     dialog used to ask; the server's mayWaive (an owner or GM there, or a
     group administrator) refuses them - as FD-14 found for the check-in. */
  it("offers no waive to a hotel administrator the server would refuse", async () => {
    openAs("admin", false);
    await screen.findByText(/A manager can waive it/);
    expect(screen.queryByText(/Waive the/)).toBeNull();
  });

  it("offers it to somebody the server takes a waive from", async () => {
    openAs("gm", true);
    expect(await screen.findByText(/Waive the/)).toBeTruthy();
  });
});
