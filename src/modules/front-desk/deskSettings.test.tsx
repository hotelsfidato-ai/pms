import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as lists from "@/modules/front-desk/data/lists";
import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { startSignedIn } from "@/test/app";
import { registered, problems, addressOf } from "@/components/app/settingsConsole";
import { ReadyReasons } from "@/modules/front-desk";
import { GuestIdFields, noGuestId } from "@/modules/guests";
import FrontDeskPage from "@/modules/front-desk/settings/FrontDeskPage";
import type { DeskRules } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   PHASE 5 OF THE SETTINGS PLAN (the owner's D27-260)
   The front desk's pages in the console, the ready reasons, the IDs a
   hotel does not take, and the Front desk page's switches.
   ══════════════════════════════════════════════════════════════════ */

const RULES = {
  defaultPaymentMethod: "Cash", deskMayOverbook: true, advanceBeforeCheckIn: "none",
  weekendDays: [0, 6], defaultIdType: null, defaultNationality: "IN", defaultTitle: null,
  defaultGuarantee: "confirmed", defaultBillTo: "guest", requiredBookingFields: [],
  hkDirtyAfterMove: true, hkDirtyAfterUnblock: true, hkStayoverDirtyAtAudit: false,
  idTypesOff: ["voter"], statusColours: null, posRoundOff: "manual",
  kpiDayUseHalf: false, kpiCompAsSold: true, holidays: [],
} as DeskRules;

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

beforeEach(() => {
  startSignedIn();
  useUi.setState({ hotelId: "AGR" });
  useSession.setState((s) => ({ hotels: s.hotels.map((h) => ({ ...h, deskRules: RULES })) }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the front desk's pages in the Settings console", () => {
  it("takes over front-desk/front-desk and adds the six lists, as the contract asks", () => {
    const mine = registered().filter((p) => p.group === "front-desk" || p.group === "lists")
      .filter((p) => !p.standIn).map(addressOf);
    expect(mine).toEqual(expect.arrayContaining([
      "/settings/front-desk/front-desk", "/settings/lists/market-segments",
      "/settings/lists/reservation-types", "/settings/lists/reasons", "/settings/lists/holidays",
      "/settings/lists/id-types", "/settings/lists/vip",
    ]));
    expect(problems(registered())).toEqual([]);
  });
});

describe("the ready reasons", () => {
  it("offers the hotel's reasons that are On, and a tap fills the box", async () => {
    vi.spyOn(lists, "listOf").mockResolvedValue([
      { id: "1", label: "Guest changed plans", colour: null, sort: 10, active: true },
      { id: "2", label: "Old reason", colour: null, sort: 20, active: false },
    ]);
    const pick = vi.fn();
    wrap(<ReadyReasons kind="reason_cancel" onPick={pick} />);
    fireEvent.click(await screen.findByRole("button", { name: "Guest changed plans" }));
    expect(pick).toHaveBeenCalledWith("Guest changed plans");
    expect(screen.queryByRole("button", { name: "Old reason" })).toBeNull();
  });
});

describe("the IDs a hotel does not take", () => {
  it("leaves them off the desk's ID choice", () => {
    wrap(<GuestIdFields value={noGuestId("IN")} onChange={() => {}} today="2026-08-25" />);
    const options = [...(screen.getByLabelText("Document") as HTMLSelectElement).options].map((o) => o.text);
    expect(options).toContain("Aadhaar");
    expect(options).not.toContain("Voter ID");
  });
});

describe("the Front desk page", () => {
  it("saves a switch as the hotel's setting", async () => {
    const save = vi.spyOn(lists, "saveDeskSettings").mockResolvedValue({ ok: true });
    wrap(<FrontDeskPage />);
    fireEvent.click(screen.getByRole("switch", { name: /A complimentary room counts as sold/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("AGR", { kpiCompAsSold: false }));
  });
});
