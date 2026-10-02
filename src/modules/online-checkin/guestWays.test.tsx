import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { withUnlock } from "@/modules/online-checkin/data/guestPage";
import ByRoomPage from "@/modules/online-checkin/pages/ByRoom";
import DigiLockerReturn from "@/modules/online-checkin/pages/DigiLockerReturn";
import { DigiLockerButton } from "@/modules/online-checkin/DigiLockerButton";

/* ══════════════════════════════════════════════════════════════════
   TWO MORE WAYS IN (D27-235 2.4, 2.5)

   The room and the phone: the page sends what was typed and nothing else,
   shows the door's own sentence, and on the right code keeps the unlock
   where the guest's page reads it, then opens the stay.
   DigiLocker: nothing at all while the server says it is off; the token
   only in this tab's sessionStorage while the guest is at DigiLocker; the
   unlock kept on the way back.
   ══════════════════════════════════════════════════════════════════ */

const TICKET = "a-ticket-from-the-door-0123456789abcdef";
const SENT = "If the room and the number match a guest staying now, a code is on its way to that number on WhatsApp.";

type Answer = (init?: RequestInit) => unknown;
function server(routes: Record<string, Answer>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = routes[url.split("?")[0]!];
    if (!answer) throw new apiModule.ApiError(500, `the page called ${url}`);
    return answer(init) as never;
  });
}
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

function mount(path: string, element: React.ReactNode, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
          <Route path="/g/:token" element={<p>the guest's page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the room and the phone (D27-235 2.4)", () => {
  it("sends the room and the phone, then the code, and opens the stay unlocked", async () => {
    const calls: unknown[] = [];
    server({
      "/api/guest/by-room/send": (init) => { calls.push(bodyOf(init)); return { sent: true, ticket: TICKET, message: SENT }; },
      "/api/guest/by-room/open": (init) => { calls.push(bodyOf(init)); return { verified: true, unlock: "the-unlock" }; },
    });
    mount("/g/h/5el", <ByRoomPage />, "/g/h/:hotel");

    fireEvent.change(await screen.findByLabelText("Your room number"), { target: { value: " 204 " } });
    fireEvent.change(screen.getByLabelText("Your phone number"), { target: { value: "98765 43210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(await screen.findByText(SENT)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("The six digits"), { target: { value: "424242" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my stay" }));
    expect(await screen.findByText("the guest's page")).toBeTruthy();
    expect(calls).toEqual([
      { hotel: "5el", room: "204", phone: "98765 43210" },
      { ticket: TICKET, code: "424242" },
    ]);
    /* Kept where the guest's page looks for it. */
    expect((withUnlock(TICKET).headers as Record<string, string>)["authorization"]).toBe("Guest the-unlock");
  });

  it("prints the door's own refusal, and stays", async () => {
    server({
      "/api/guest/by-room/send": () => ({ sent: true, ticket: TICKET, message: SENT }),
      "/api/guest/by-room/open": () => { throw new apiModule.ApiError(401, "That did not work. Check the code, or ask the desk."); },
    });
    mount("/g/h/5el", <ByRoomPage />, "/g/h/:hotel");
    fireEvent.change(await screen.findByLabelText("Your room number"), { target: { value: "204" } });
    fireEvent.change(screen.getByLabelText("Your phone number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    fireEvent.change(await screen.findByLabelText("The six digits"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my stay" }));
    expect(await screen.findByText("That did not work. Check the code, or ask the desk.")).toBeTruthy();
    expect(screen.queryByText("the guest's page")).toBeNull();
  });
});

describe("DigiLocker (D27-235 2.5)", () => {
  it("keeps the token in this tab only, and goes to DigiLocker", async () => {
    const go = vi.fn();
    server({
      "/api/guest/tok-1/digilocker": () => ({ url: "https://digilocker.example/authorize?state=s" }),
    });
    mount("/x", <DigiLockerButton token="tok-1" go={go} />, "/x");
    fireEvent.click(await screen.findByRole("button", { name: "Continue with DigiLocker" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("https://digilocker.example/authorize?state=s"));
    expect(sessionStorage.getItem("guest-digilocker")).toBe("tok-1");
  });

  it("comes back, keeps the unlock and opens the stay", async () => {
    sessionStorage.setItem("guest-digilocker", TICKET);
    let sent: unknown = null;
    server({ "/api/guest/digilocker/finish": (init) => { sent = bodyOf(init); return { verified: true, unlock: "dl-unlock" }; } });
    mount("/g-digilocker?code=the-code&state=the-state", <DigiLockerReturn />, "/g-digilocker");
    expect(await screen.findByText("the guest's page")).toBeTruthy();
    expect(sent).toEqual({ code: "the-code", state: "the-state" });
    expect((withUnlock(TICKET).headers as Record<string, string>)["authorization"]).toBe("Guest dl-unlock");
    expect(sessionStorage.getItem("guest-digilocker")).toBeNull();
  });

  it("says so when DigiLocker sent the guest back without an answer, and asks nothing", async () => {
    sessionStorage.setItem("guest-digilocker", TICKET);
    const spy = server({});
    mount("/g-digilocker?error=access_denied", <DigiLockerReturn />, "/g-digilocker");
    expect(await screen.findByText(/DigiLocker did not confirm it/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to my booking" }).getAttribute("href")).toBe(`/g/${TICKET}`);
  });
});
