import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import App from "@/App";
import * as apiModule from "@/lib/api";
import { noteUnreachable } from "@/lib/offline";
import { HOTEL, go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   D27-271, THE OWNER (4 October, from the manual)

   (2) The menu's words on the page: the switches say "Upcoming" and
       "In house now", as the menu does, not "Next fourteen days" and
       "Current stays".
   (4) Offline, In house and Due out keep each guest's balance from the
       last load, and say how old it is.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);
afterEach(() => {
  /* The connection is module state: back on for the next test, BEFORE the
     unmount - React Query stops listening for it once nothing is mounted,
     and would stay offline. */
  window.dispatchEvent(new Event("online"));
  cleanup();
  vi.restoreAllMocks();
});

describe("the menu's words on the page", () => {
  it("Arrivals: Today and Upcoming", async () => {
    go(`/h/${HOTEL}/arrivals`);
    render(<App />);
    expect(await screen.findByRole("tab", { name: /^Upcoming/ })).toBeDefined();
    expect(screen.queryByText(/Next fourteen days/)).toBeNull();
  });

  it("In house: In house now and Due out", async () => {
    go(`/h/${HOTEL}/in-house`);
    render(<App />);
    expect(await screen.findByRole("tab", { name: /^In house now/ })).toBeDefined();
    expect(screen.queryByText(/Current stays/)).toBeNull();
  });
});

const AS_OF = /^Balances as of \d{1,2}:\d{2} [AP]M, may be out of date\.$/;
const loaded = () => screen.findByRole("tab", { name: /^In house now\d+$/ }, { timeout: 10000 });

describe("balances offline", () => {
  it("are marked with the time they loaded, and only while offline", async () => {
    go(`/h/${HOTEL}/in-house`);
    render(<App />);
    await loaded();
    expect(screen.queryByText(AS_OF)).toBeNull();

    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(await screen.findByText(AS_OF)).toBeDefined();

    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.queryByText(AS_OF)).toBeNull());
  }, 20000);

  it("on Due out too", async () => {
    go(`/h/${HOTEL}/in-house/due-out`);
    render(<App />);
    await screen.findByRole("tab", { name: /^Due out\d+$/ }, { timeout: 10000 });
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(await screen.findByText(AS_OF)).toBeDefined();
  }, 20000);

  /* The wifi up and the line down: the browser says online, the read fails.
     That is offline by isOnline() too, and the list stays on screen. */
  it("stay on screen when a read fails for want of the server", async () => {
    go(`/h/${HOTEL}/in-house`);
    render(<App />);
    await loaded();
    const real = apiModule.api;
    vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
      if (url.split("?")[0] === `/api/hotels/${HOTEL}/stays`) {
        noteUnreachable();
        return Promise.reject(new apiModule.ApiError(0, "Could not reach the server."));
      }
      return real(url, init);
    }) as typeof real);

    /* Money is re-checked when the screen comes back into view (FIN-3).
       Again until it fails: one still on its way when the screen opened
       (this file's earlier tests left the list cached) takes the first. */
    await waitFor(() => {
      window.dispatchEvent(new Event("visibilitychange"));
      expect(screen.getByText(AS_OF)).toBeDefined();
    });
    /* The rows, not the read's error in their place. */
    expect(screen.queryByText("Could not reach the server.")).toBeNull();
    expect(document.querySelector("[data-stay-cards]")).not.toBeNull();
  }, 20000);
});
