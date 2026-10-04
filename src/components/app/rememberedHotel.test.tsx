import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import App from "@/App";
import { useUi } from "@/lib/ui";
import { go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE REMEMBERED HOTEL MUST BE ONE OF THIS PERSON'S (4 October)

   After the fresh start (D27-248) 5 Elements was gone from live, but
   browsers still remembered it - and the store starts on "5EL" - so
   Settings asked for a hotel that does not exist and drew nothing.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

describe("a remembered hotel that is not the person's", () => {
  it("becomes their first hotel, so the screens have one to show", async () => {
    useUi.setState({ hotelId: "GONE" });
    go("/settings/property/profile");
    render(<App />);
    /* `startSignedIn` signs in a clerk whose only hotel is Agra. */
    await waitFor(() => expect(useUi.getState().hotelId).toBe("AGR"));
  });

  it("is left alone when it is one of theirs", async () => {
    useUi.setState({ hotelId: "AGR" });
    go("/");
    render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(useUi.getState().hotelId).toBe("AGR");
  });
});
