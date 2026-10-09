import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "@/App";
import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import {
  TEST_DOCUMENT, TEST_STRIPE, hotelLabel, isTestHotel, plainName,
} from "@/lib/testHotel";
import { AccountMenu } from "./AccountMenu";
import {
  HOTEL, TEST_HOTEL, go, signedIn, startSignedIn, withDemoHotel, withTestHotel,
} from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   A TEST HOTEL IN THE SHELL (the owner's D27-296 (9))

   GET /api/hotels names a test hotel's real hotel in `testOf`. With one
   in view, an orange stripe reading exactly "TEST HOTEL · practice only ·
   nothing here is real" is across the top of every screen, with nothing
   to close it; paper printed from the shell carries TEST · NOT VALID; and
   the account menu's hotel list says TEST beside it. A real hotel shows
   none of it.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => { startSignedIn(); withDemoHotel(); });
afterEach(cleanup);

describe("which hotel is a test hotel", () => {
  it("is the server's testOf, never the name", () => {
    expect(isTestHotel({ testOf: HOTEL })).toBe(true);
    expect(isTestHotel({ testOf: null })).toBe(false);
    /* An older server sends no testOf: every hotel is real. */
    expect(isTestHotel({})).toBe(false);
    expect(isTestHotel({ name: "Hotel Amrapali · TEST", testOf: null } as never)).toBe(false);
  });

  it("names a test hotel with TEST once, whatever the server called it", () => {
    expect(hotelLabel({ name: "Akkalkot practice", testOf: HOTEL })).toBe("Akkalkot practice · TEST");
    expect(hotelLabel({ name: "Hotel Amrapali · TEST", testOf: "AMR" })).toBe("Hotel Amrapali · TEST");
    expect(plainName({ name: "Hotel Amrapali · TEST", testOf: "AMR" })).toBe("Hotel Amrapali");
    /* A real hotel's name is never touched, even one that ends in TEST. */
    expect(hotelLabel({ name: "The Best · TEST", testOf: null })).toBe("The Best · TEST");
  });
});

describe("the stripe", () => {
  it("is across the top of the shell in a test hotel, in the owner's words, with nothing to close it", async () => {
    withTestHotel();
    go("/notifications");
    render(<App />);
    const stripe = await screen.findByText(TEST_STRIPE);
    expect(stripe.textContent).toBe("TEST HOTEL · practice only · nothing here is real");
    /* Above the rail and the top bar: the shell's first thing. */
    expect(stripe.parentElement?.firstElementChild).toBe(stripe);
    expect(stripe.parentElement?.contains(screen.getByRole("main"))).toBe(true);
    expect(within(stripe).queryByRole("button")).toBeNull();
    /* The brand's orange, on the step white reads on. */
    expect(stripe.className).toContain("bg-brand-orange-600");
  });

  it("stays when the screen changes", async () => {
    withTestHotel();
    go("/notifications");
    render(<App />);
    await screen.findByText(TEST_STRIPE);
    cleanup();
    go(`/h/${TEST_HOTEL}/approvals`);
    render(<App />);
    expect(await screen.findByText(TEST_STRIPE)).toBeTruthy();
  });

  it("puts TEST · NOT VALID on every page printed from the shell, on paper only", async () => {
    withTestHotel();
    go("/notifications");
    render(<App />);
    await screen.findByText(TEST_STRIPE);
    const mark = document.querySelector("[data-test-watermark]")!;
    expect(mark.textContent).toBe(TEST_DOCUMENT);
    expect(mark.className).toMatch(/\bhidden\b/);
    expect(mark.className).toContain("print:flex");
    expect(mark.className).toContain("fixed");
  });

  it("is nowhere in a real hotel", async () => {
    withTestHotel({ inView: false });
    useUi.setState({ hotelId: HOTEL });
    go("/notifications");
    render(<App />);
    expect(await screen.findByRole("main")).toBeTruthy();
    expect(screen.queryByText(TEST_STRIPE)).toBeNull();
    expect(document.querySelector("[data-test-watermark]")).toBeNull();
  });
});

describe("the account menu's hotel list", () => {
  const hotel = (id: string, code: string, name: string, testOf: string | null) => ({
    id, code, name, city: "Akkalkot", state: "MH", gstin: null, timezone: "Asia/Kolkata",
    currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-08-25", testOf,
  });

  it("says TEST beside a test hotel's name, and nothing beside a real one's", async () => {
    signedIn({
      scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "gm@fidato.in",
               fullName: "A Manager", isGroupAdmin: false,
               hotels: [{ hotelId: "h-1", role: "gm" }, { hotelId: "h-2", role: "gm" }] },
      /* Named without TEST: it is `testOf` that makes it one. */
      hotels: [hotel("h-1", HOTEL, "5 Elements Akkalkot", null), hotel("h-2", TEST_HOTEL, "Akkalkot practice", HOTEL)],
      hotelId: "h-1",
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/notifications"]}><AccountMenu /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Account and property/ }), { key: "Enter" });
    const practice = (await screen.findByText("Akkalkot practice")).closest("[role=menuitem]") as HTMLElement;
    expect(within(practice).getByText("TEST")).toBeTruthy();
    const real = screen.getByText("5 Elements Akkalkot").closest("[role=menuitem]") as HTMLElement;
    expect(within(real).queryByText("TEST")).toBeNull();
    expect(useSession.getState().hotels).toHaveLength(2);
  });
});
