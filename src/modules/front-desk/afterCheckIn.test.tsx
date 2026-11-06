import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as operations from "@/modules/front-desk/data/operations";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { StayActions } from "@/modules/front-desk/flows/StayActions";
import { AmendStayFlow } from "@/modules/front-desk/flows/AmendStayFlow";
import { FrontDeskRulesCard } from "@/modules/front-desk";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   AFTER CHECK-IN, ON THE GUEST'S MENU (the owner's D27-397)

   Undo check-in, Cancel and Void on a guest in house: the owner and an
   Admin always; the GM while Front desk rules' "The GM may undo a
   check-in" is on; the front desk sees "Ask the GM to ..." instead. The
   switch off: the old lock, with its reason. Change rate and Change room
   type on a guest in house too, and the arrival's field in Change dates.
   ══════════════════════════════════════════════════════════════════ */

const IN_HOUSE = {
  id: "stay-7", hotelId: "5EL", reference: "FH-2611-0007", guest: "Asha Rao",
  roomNumber: "101", roomType: "Deluxe", ratePlan: "EP", arrival: "2026-08-24",
  departure: "2026-08-27", nights: 3, adults: 1, children: 0, status: "in-house",
  offeredTariff: 3000, isComplimentary: false,
} as unknown as Stay;

const posted: Array<{ path: string; body: unknown }> = [];

const as = (role: string, isGroupAdmin = false) => signedIn({ scope: {
  staffId: "22222222-2222-2222-2222-222222222222", email: `${role}@fidato.in`,
  fullName: role, isGroupAdmin, hotels: [{ hotelId: AGRA_HOTEL, role: role as never }],
} });
const switchOff = () => useSession.setState((s) => ({
  hotels: s.hotels.map((h) => ({ ...h, deskRules: { gmMayUndoCheckIn: false } as apiModule.DeskRules })),
}));

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const openMenu = async (stay: Stay = IN_HOUSE) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><StayActions hotelId="5EL" stay={stay} businessDate="2026-08-25" /></MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /More options/ }), { key: "Enter" });
  return screen.findByRole("menu");
};
const item = (menu: HTMLElement, name: RegExp) => within(menu).queryByRole("menuitem", { name });

describe("the front desk, on a guest in house", () => {
  it("asks the GM to undo, cancel, void and change the rate - and may change the room type itself", async () => {
    const menu = await openMenu();
    expect(item(menu, /Ask the GM to undo the check-in/)).not.toBeNull();
    expect(item(menu, /Ask the GM to cancel this booking/)).not.toBeNull();
    expect(item(menu, /Ask the GM to void this booking/)).not.toBeNull();
    expect(item(menu, /Ask the GM to change the rate/)).not.toBeNull();
    expect(item(menu, /Change room type/)).not.toBeNull();
    expect(item(menu, /^Undo check-in/)).toBeNull();
  });

  it("sends the request with the reason", async () => {
    fireEvent.click(item(await openMenu(), /Ask the GM to undo the check-in/)!);
    fireEvent.change(await screen.findByLabelText(/^Why/), { target: { value: "Checked in the wrong booking" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the GM" }));
    await waitFor(() => expect(posted).toEqual([{
      path: "/api/hotels/5EL/stays/stay-7/requests",
      body: { kind: "undo_check_in", reason: "Checked in the wrong booking" },
    }]));
  });

  it("with the switch off: the old lock, said", async () => {
    switchOff();
    const menu = await openMenu();
    expect(item(menu, /Ask the GM to (undo|cancel|void)/)).toBeNull();
    /* The rate is not the switch's: the front desk still asks for it. */
    expect(item(menu, /Ask the GM to change the rate/)).not.toBeNull();
    const undo = item(menu, /Undo check-in/)!;
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(undo.textContent).toContain("Undoing a check-in is off at this hotel (Settings, Front desk rules).");
    expect(item(menu, /Cancel this booking/)!.textContent).toContain("They have arrived, and undoing a check-in is off at this hotel.");
  });

  it("before arrival there is no check-in to undo", async () => {
    const menu = await openMenu({ ...IN_HOUSE, status: "due-in" } as Stay);
    expect(item(menu, /Undo check-in/)).toBeNull();
    expect(item(menu, /Change room type/)).toBeNull();
  });
});

describe("the GM, on a guest in house", () => {
  it("undoes the check-in with a reason", async () => {
    as("gm");
    fireEvent.click(item(await openMenu(), /^Undo check-in/)!);
    fireEvent.change(await screen.findByLabelText(/^Why/), { target: { value: "Wrong guest" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo check-in" }));
    await waitFor(() => expect(posted).toEqual([
      { path: "/api/hotels/5EL/stays/stay-7/undo-check-in", body: { reason: "Wrong guest" } },
    ]));
  });

  it("cancels and voids directly, and changes the rate", async () => {
    as("gm");
    const menu = await openMenu();
    for (const name of [/Cancel this booking/, /Void this booking/, /Change rate/]) {
      expect(item(menu, name)?.getAttribute("aria-disabled")).not.toBe("true");
    }
    expect(item(menu, /Ask the GM/)).toBeNull();
  });

  it("is locked with the switch off; the owner is not", async () => {
    as("gm");
    switchOff();
    expect(item(await openMenu(), /Undo check-in/)!.getAttribute("aria-disabled")).toBe("true");
    cleanup();
    as("owner", true);
    switchOff();
    expect(item(await openMenu(), /Undo check-in/)!.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("the arrival of a guest in house, in Change dates or guests", () => {
  const open = () => render(
    <QueryClientProvider client={new QueryClient()}>
      <AmendStayFlow hotelId="5EL" stay={IN_HOUSE} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );

  it("is locked for the front desk, who may ask the GM", async () => {
    open();
    expect((screen.getByLabelText(/^Arrival/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("They have already arrived. The GM may change it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask the GM to change the arrival date" })).toBeTruthy();
  });

  it("is open to the GM, with its limits said", async () => {
    as("gm");
    open();
    expect((screen.getByLabelText(/^Arrival/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("They have arrived: no later than today, and never a closed day.")).toBeTruthy();
  });
});

describe("Front desk rules: The GM may undo a check-in", () => {
  it("reads Yes to begin with, and saves the switch off", async () => {
    const save = vi.spyOn(operations, "saveDeskRules").mockResolvedValue({ ok: true });
    vi.spyOn(apiModule, "getSession").mockResolvedValue({ scope: null, hotels: [] } as never);
    render(<FrontDeskRulesCard hotelId={AGRA_HOTEL} />);
    expect(screen.getByText("GM may undo a check-in").nextElementSibling?.textContent).toBe("Yes");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("switch", { name: /The GM may undo a check-in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(AGRA_HOTEL, expect.objectContaining({ gmMayUndoCheckIn: false })));
  });
});
