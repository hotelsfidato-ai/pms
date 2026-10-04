import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/* ══════════════════════════════════════════════════════════════════
   SIGNING OUT OF A SHARED DESK MACHINE (28 September, the release review)

   Sign-out used to leave the offline copy of the lists, the lists in
   memory and the remembered session behind, so the next person opened on
   the last one's floor and arrivals. The outbox is the exception, by the
   owner's choice: unsent changes stay, under the name of whoever made
   them, and that person is told. jsdom has no IndexedDB, so the two stores
   are stood in for.
   ══════════════════════════════════════════════════════════════════ */

const { removeClient, held } = vi.hoisted(() => ({
  removeClient: vi.fn(async () => {}),
  held: vi.fn(async (): Promise<{ subject: string }[]> => []),
}));
vi.mock("@/lib/persist", async (orig) => ({
  ...(await orig<typeof import("@/lib/persist")>()),
  queryPersister: { removeClient },
}));
vi.mock("@/lib/outbox", async (orig) => ({
  ...(await orig<typeof import("@/lib/outbox")>()),
  waiting: held,
}));

import { useSession } from "@/lib/session";
import { AccountMenu } from "@/components/app/AccountMenu";
import SignInPage from "@/pages/SignIn";
import { signedIn } from "@/test/app";

beforeEach(() => {
  removeClient.mockClear();
  held.mockResolvedValue([]);
  signedIn();
});

describe("sign-out on a shared machine", () => {
  it("forgets the offline copy of the lists and the remembered session", async () => {
    localStorage.setItem("fidato-last-session", JSON.stringify({ at: Date.now() }));
    await useSession.getState().signOut();
    expect(removeClient).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("fidato-last-session")).toBeNull();
    expect(useSession.getState()).toMatchObject({ status: "signed-out", scope: null, notice: null });
  });

  it("empties the lists in memory from the account menu", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["arrivals", "AGR"], [{ guest: "The last clerk's guest" }]);
    /* In a router: picking a property moves the address (D27-271). */
    render(<QueryClientProvider client={qc}><MemoryRouter><AccountMenu /></MemoryRouter></QueryClientProvider>);

    fireEvent.keyDown(screen.getByRole("button", { name: /Account and property/ }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Sign out"));

    await waitFor(() => expect(qc.getQueryCache().getAll()).toHaveLength(0));
    expect(useSession.getState().status).toBe("signed-out");
  });

  it("keeps this person's unsent changes, and says so on the sign-in screen", async () => {
    held.mockResolvedValue([{ subject: "stub-staff" }, { subject: "stub-staff" }, { subject: "someone-else" }]);
    await useSession.getState().signOut();
    render(<SignInPage />);
    expect(screen.getByRole("status").textContent).toBe(
      "2 changes are kept on this computer and will be sent when you sign in here again.");
  });
});
