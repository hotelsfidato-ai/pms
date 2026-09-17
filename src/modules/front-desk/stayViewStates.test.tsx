import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   ROOMS WHEN THE SERVER DOES NOT ANSWER

   `/stay` was `if (isLoading || !data) return <twelve grey bars>` and
   nothing else, so with the API unreachable the front desk's first screen
   loaded forever (design critique, 16 September, P0). These pin the other
   states: a skeleton shaped like the house while it loads, an error with a
   retry when nothing ever loaded, and the last good house kept on screen,
   with its age, when a later read fails.

   The house's read is switched per test. Everything else still goes
   through the shared transport stub in `src/test/setup.ts`.

   ⚠ ORDER MATTERS IN THIS FILE. The application's query cache lives as
   long as the file does (App.tsx creates it once), so the first test is
   the only one that meets a cache with no house in it — which is exactly
   the case it is about.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  mode: "answer" as "answer" | "unreachable" | "hold",
  held: [] as Array<() => void>,
}));

vi.mock("@/modules/front-desk/data/stayview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/front-desk/data/stayview")>();
  const { ApiError } = await import("@/lib/api");
  return {
    ...actual,
    getStayView: async (...args: Parameters<typeof actual.getStayView>) => {
      if (control.mode === "hold") {
        await new Promise<void>((release) => control.held.push(release));
      }
      if (control.mode === "unreachable") {
        /* What `api()` throws when the request never left the machine. */
        throw new ApiError(0, "Could not reach the server. Showing the last data received.");
      }
      return actual.getStayView(...args);
    },
  };
});

const tiles = () => document.querySelectorAll("[data-room-tile]");

beforeEach(() => {
  startSignedIn();
  go(`/h/${HOTEL}/stay`);
  control.mode = "answer";
});

/* A read left holding would hang the next test on the same cache key, and
   that test would then fail for a reason that is not its own. */
afterEach(() => {
  control.mode = "answer";
  control.held.splice(0).forEach((release) => release());
});

describe("Rooms when the server does not answer", () => {
  it("loads in the house's shape, then says it failed and offers a retry - never grey bars forever", async () => {
    control.mode = "hold";
    render(<App />);

    /* Loading: the skeleton is the floor's, not a list's. */
    await waitFor(() =>
      expect(document.querySelector('[data-rooms-skeleton="floor"]')).not.toBeNull());

    /* The server never answers. */
    control.mode = "unreachable";
    control.held.splice(0).forEach((release) => release());

    expect(await screen.findByText("The rooms did not load")).toBeTruthy();
    /* Not api()'s "Showing the last data received" — there is none. */
    expect(screen.getByText(/no rooms from earlier to show/)).toBeTruthy();
    expect(document.querySelector("[data-rooms-skeleton]")).toBeNull();

    /* The line comes back, and Try again brings the house. */
    control.mode = "answer";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(tiles().length).toBeGreaterThan(0));
    expect(screen.queryByText("The rooms did not load")).toBeNull();
  });

  it("keeps the last good house on screen, with its age, when the next fortnight fails", async () => {
    render(<App />);
    await waitFor(() => expect(tiles().length).toBeGreaterThan(0));
    const shown = tiles().length;

    control.mode = "unreachable";
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));

    const strip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-stale-rooms]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(strip.textContent).toMatch(/No connection - these rooms are as they were at /);
    expect(strip.textContent).toMatch(/has not loaded/);
    /* The house did not go anywhere. */
    expect(tiles().length).toBe(shown);
    expect(screen.queryByText("The rooms did not load")).toBeNull();

    control.mode = "answer";
    fireEvent.click(within(strip).getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(document.querySelector("[data-stale-rooms]")).toBeNull());
    expect(tiles().length).toBe(shown);
  });
});
