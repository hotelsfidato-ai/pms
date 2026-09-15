import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { HOTEL, startSignedIn } from "@/test/app";

/* Reports' screens, rendered through the whole application — the shell,
   the session and the route included. Moved here from `src/App.test.tsx`
   when the screen tests were split by service; where every test starts
   is `src/test/app.ts`. */

beforeEach(startSignedIn);

/* "Group" became the Dashboard on 14 September, the owner's call: the
   numbers a hotel lives by, and quick reports. The table of every hotel
   is still there — below the tiles, for somebody who reads more than
   one; this fixture has one, so the tiles are what these assert. */
describe("the dashboard at /", () => {
  it("is called Dashboard and leads with the hotel's own numbers", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeDefined();
    expect(await screen.findByText("Occupancy")).toBeDefined();
    expect(await screen.findByText("Room revenue")).toBeDefined();
  });

  it("opens the list behind each count in the house", async () => {
    /* A count a clerk cannot follow is a number to read and nothing to
       do — each tile in "The house now" is the door to its list. */
    render(<App />);
    /* Inside the page, not the sidebar — the menu has an Arrivals link
       of its own. And for THE PROPERTY IN VIEW: the first version of
       the page settled on the first hotel in the list, and this found
       a tile pointing at AGR under a sidebar on 5EL. */
    const main = await screen.findByRole("main");
    const arrivals = await within(main).findByRole("link", { name: /Arrivals/ });
    expect(arrivals.getAttribute("href")).toBe(`/h/${HOTEL}/arrivals`);
  });
});
