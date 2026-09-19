import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import GuestPage from "@/modules/online-checkin/pages/GuestPage";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S PAGE — what a stranger holding the link can see

   The screen's half of the door's rules (api/src/routes/guestDoor.ts).
   The server keeps its own half and is tested beside it; these say the
   page does not leak what the server withholds, and does not tell a
   wrong phone number from a right one.

   `api` is stubbed per path: the page must never call anything else,
   and an unlisted call fails the test rather than answering empty.
   ══════════════════════════════════════════════════════════════════ */

const TOKEN = "a-token-from-the-desk";
const OPEN = `/api/guest/${TOKEN}`;

const BOOKING = {
  hotel: { code: "5EL", name: "5 Elements Akkalkot" },
  booking: {
    reference: "FH-2609-5001", guestName: "A. Guest",
    checkIn: "2026-08-25", checkOut: "2026-08-27", status: "confirmed",
  },
  verified: false,
  phoneHint: "…4321",
};

function server(routes: Record<string, () => unknown>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const answer = routes[url.split("?")[0]!];
    if (!answer) throw new apiModule.ApiError(500, `the page called ${url}`);
    return answer() as never;
  });
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/g/${TOKEN}`]}>
        <Routes><Route path="/g/:token" element={<GuestPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { document.title = ""; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("before the six digits are answered", () => {
  it("shows what a clerk would say across the counter, and no more", async () => {
    server({ [OPEN]: () => BOOKING });
    open();

    expect(await screen.findByText("A. Guest")).toBeTruthy();
    expect(screen.getByText("FH-2609-5001")).toBeTruthy();
    /* The number itself is never here — only the last four digits the
       door sent, and only as a hint about where the code is going. */
    expect(screen.getByText(/ending …4321/)).toBeTruthy();
    expect(screen.queryByText(/Verified/)).toBeNull();
  });

  it("asks the server for nothing else — no bill, no identity, no requests", async () => {
    const spy = server({ [OPEN]: () => BOOKING });
    open();
    await screen.findByText("A. Guest");

    /* One call, and it is the one the token names. A screen that
       fetched the bill and hid it would be a leak with a stylesheet. */
    expect(spy.mock.calls.map((c) => c[0])).toEqual([OPEN]);
  });

  it("says the same nothing for a link that is dead, whatever killed it", async () => {
    server({});  // any failure at all
    open();

    expect(await screen.findByRole("heading", {
      name: "This link is not usable. Ask the desk for a new one.",
    })).toBeTruthy();
    expect(screen.queryByText("A. Guest")).toBeNull();
  });
});

describe("the number that gets the code", () => {
  /* ⚠ THE ONE THAT MATTERS. The door answers a wrong number and a right
     one identically; if this screen ever decided anything from that
     answer, trying numbers until the page changed would find the
     guest's own. Both cases are driven here and the screens compared. */
  it("looks exactly the same whether or not the number was the booking's", async () => {
    const answer = {
      sent: true,
      message: "If that is the number on the booking, the code has been sent to it.",
    };

    const shown = async (phone: string) => {
      server({ [OPEN]: () => BOOKING, [`${OPEN}/code`]: () => answer });
      open();
      await screen.findByText("A. Guest");
      fireEvent.change(screen.getByLabelText("Your phone number"), { target: { value: phone } });
      fireEvent.click(screen.getByRole("button", { name: "Send me the code" }));
      await screen.findByText(answer.message);
      const text = screen.getByRole("main").textContent ?? "";
      cleanup();
      vi.restoreAllMocks();
      return text;
    };

    /* One number ENDS IN THE FOUR DIGITS the door showed as the hint and
       the other does not: the only thing the screen could tell them
       apart by is the hint it was given, so that is what is driven. */
    expect(await shown("9812344321")).toBe(await shown("0000000000"));
  });

  /* OCI-1. The door refuses to send while n8n is not connected and says
     what to do instead, in the body's `message` with a 503 — a field
     `api()` does not lift into the error. The guest read "Request failed
     (503)." until this was found by opening the screen. */
  it("prints the door's refusal to send, not its status code", async () => {
    const message = "Codes cannot be sent yet - WhatsApp is not connected to this "
      + "server. Ask the desk to send you the link instead.";
    /* ⚠ SHAPED BY HAND, NOT `new ApiError(...)`, AND THAT IS THE POINT.
       In the browser `api()` builds an ApiError carrying the parsed body;
       under vitest the class's optional `body` is dropped by the
       transform (measured 19 September — `Object.keys` is
       ["status","name"] here and ["status","body","name"] in the dev
       server). Constructing one here would therefore test the transform
       and not this screen. This is the object the browser really hands
       it. */
    server({
      [OPEN]: () => BOOKING,
      [`${OPEN}/code`]: () => {
        throw Object.assign(new Error("Request failed (503)."),
          { status: 503, body: { sent: false, message } });
      },
    });
    open();
    await screen.findByText("A. Guest");

    fireEvent.change(screen.getByLabelText("Your phone number"), { target: { value: "9800000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me the code" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/Request failed/)).toBeNull();
  });

  it("opens the booking once the right code is answered", async () => {
    let verified = false;
    server({
      [OPEN]: () => ({ ...BOOKING, verified }),
      [`${OPEN}/verify`]: () => { verified = true; return { verified: true }; },
    });
    open();
    await screen.findByText("A. Guest");

    fireEvent.change(screen.getByLabelText("The six digits"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my booking" }));

    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(screen.queryByLabelText("The six digits")).toBeNull();
  });

  it("prints the server's refusal of a wrong code, and stays shut", async () => {
    server({
      [OPEN]: () => BOOKING,
      [`${OPEN}/verify`]: () => {
        throw new apiModule.ApiError(401,
          "That code is not right, or it has expired. Ask for a new one.");
      },
    });
    open();
    await screen.findByText("A. Guest");

    fireEvent.change(screen.getByLabelText("The six digits"), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my booking" }));

    await waitFor(() => expect(screen.getByText(
      "That code is not right, or it has expired. Ask for a new one.")).toBeTruthy());
    expect(screen.queryByText("Verified")).toBeNull();
  });
});
