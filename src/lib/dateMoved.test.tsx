import { it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { useSession } from "@/lib/session";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";
import { startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   A DAY CLOSED ON ANOTHER DESK (the owner, 28 September)

   A device learned the business date at sign-in and kept it: after the
   night audit elsewhere it showed yesterday until reloaded. Now each
   screen that opens re-reads the dates, and moves when one has moved.
   ══════════════════════════════════════════════════════════════════ */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("moves this device to the new day when a screen opens after the audit elsewhere", async () => {
  startSignedIn();
  const { scope, hotels } = useSession.getState();
  expect(hotels[0]!.businessDate).toBe("2026-08-24");
  vi.spyOn(apiModule, "getSession").mockResolvedValue(
    { scope, hotels: [{ ...hotels[0]!, businessDate: "2026-08-25" }] } as never);

  render(<App />);

  await waitFor(() => expect(useSession.getState().hotels[0]!.businessDate).toBe("2026-08-25"));
  expect(BUSINESS_DATE).toBe("2026-08-25");
});
