import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { useSession } from "@/lib/session";
import { TwoStepGate } from "@/modules/admin";

/* ══════════════════════════════════════════════════════════════════
   TWO-STEP SIGN-IN ON THE WEBSITE (D27-396)

   A right password whose sign-in still owes a code is not a sign-out: the
   person stays, on the code screen, and nothing else loads until the
   server takes a code. The refusals themselves are the server's, proved in
   api/test/modules/admin/twoStep.test.ts.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  useSession.setState({ status: "signed-out", twoStep: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* What the browser hands over: under vitest a real ApiError drops its body
   (root MEMORY, "ApiError has two shapes"), so the shape is built here. */
const owes = (twoStep: "code" | "setup") =>
  Object.assign(new Error("Two-step sign-in: type the 6-digit code from your authenticator app to go on."),
    { status: 403, body: { ok: false, twoStep } });

const SESSION = {
  scope: { staffId: "s1", email: "gm@test", fullName: "Test GM", isGroupAdmin: false, hotels: [] },
  hotels: [],
} as unknown as apiModule.HotelsResponse;

describe("a sign-in that owes its second step", () => {
  it("stays signed in, on the code screen; a wrong code says so; a right one opens the system", async () => {
    const session = vi.spyOn(apiModule, "getSession").mockRejectedValueOnce(owes("code"));
    await useSession.getState().refresh();
    expect(useSession.getState()).toMatchObject({ status: "two-step", twoStep: "code" });

    const sent: unknown[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/two-step" && init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        if (sent.length === 1) throw new apiModule.ApiError(409, "That code is not right.");
        return { ok: true, recoveryLeft: 10 } as never;
      }
      throw new apiModule.ApiError(500, "Request failed (500).");
    });
    session.mockResolvedValueOnce(SESSION);

    render(<QueryClientProvider client={new QueryClient()}><TwoStepGate /></QueryClientProvider>);
    const box = screen.getByLabelText("Code from the app");
    const goOn = screen.getByRole("button", { name: "Go on" }) as HTMLButtonElement;
    fireEvent.change(box, { target: { value: "12a34" } });
    expect(goOn.disabled, "six digits, nothing else").toBe(true);

    fireEvent.change(box, { target: { value: "123456" } });
    fireEvent.click(goOn);
    expect(await screen.findByText("That code is not right.")).toBeDefined();
    expect(useSession.getState().status).toBe("two-step");

    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Go on" }));
    await waitFor(() => expect(useSession.getState().status).toBe("signed-in"));
    expect(sent).toEqual([{ code: "123456" }, { code: "654321" }]);
  });

  it("whose role needs it is asked to set it up, not for a code", async () => {
    vi.spyOn(apiModule, "getSession").mockRejectedValueOnce(owes("setup"));
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    await useSession.getState().refresh();
    expect(useSession.getState()).toMatchObject({ status: "two-step", twoStep: "setup" });
    render(<QueryClientProvider client={new QueryClient()}><TwoStepGate /></QueryClientProvider>);
    expect(screen.getByText(/Your role needs it/)).toBeDefined();
    expect(screen.getByText("1. Put an authenticator app on your phone")).toBeDefined();
  });

  it("any other refusal is still a refusal, not the code screen", async () => {
    vi.spyOn(apiModule, "getSession").mockRejectedValueOnce(
      Object.assign(new Error("No active staff record for this account."), { status: 401 }));
    await expect(useSession.getState().refresh()).rejects.toThrow("No active staff record");
    expect(useSession.getState().status).not.toBe("two-step");
  });
});
