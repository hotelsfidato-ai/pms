import { describe, it, expect, beforeEach } from "vitest";
import {
  render, screen, within, fireEvent, waitFor, cleanup,
} from "@testing-library/react";
import App from "@/App";
import { AGRA_HOTEL, HOTEL, go, signedIn, startSignedIn } from "@/test/app";

/* The front desk's screens, rendered through the whole application —
   the shell, the session and the route included. Moved here from
   `src/App.test.tsx` when the screen tests were split by service; where
   every test starts is `src/test/app.ts`. */

beforeEach(startSignedIn);

describe("the tape chart at /h/:code/stay", () => {
  beforeEach(() => {
    go(`/h/${HOTEL}/stay`);
    /* The view is the ADDRESS since 14 September — /stay is Rooms,
       /calendar is the chart — and no longer a choice kept in
       localStorage. Cleared anyway: jsdom shares it between tests in a
       file, and nothing here should depend on what the last one left. */
    try { localStorage.clear(); } catch { /* not fatal */ }
  });

  /* ⚠ THE CHART IS NO LONGER THE DEFAULT VIEW. Rooms is, since the owner
     asked for it on 8 September: a manager signing in wants the house as
     it stands, not a fortnight of planning.

     So a test about the chart has to ASK for the chart. Four of these
     used to pass by accident of the default, which meant they were also
     silently asserting what the screen opens on — a thing none of them
     was named after. That assertion now lives in one place, below. */
  const showCalendar = async () => {
    fireEvent.click(await screen.findByRole("tab", { name: "Calendar" }));
    await screen.findAllByText(/Superior|Deluxe/i);
  };

  it("opens on Rooms, not the chart", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    /* No date columns means no chart, which is the whole assertion. */
    expect(container.querySelectorAll("[data-date-col]")).toHaveLength(0);
    expect(
      (await screen.findByRole("tab", { name: "Rooms" }))
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  /* D24-18: a control the server refuses is not offered. "Assign room" is
     roleGate's ROOMING (reservation edit); housekeeping read Rooms and hold
     no such grant. Who may do what is unchanged. */
  it("offers Assign room to reception, and not to housekeeping, whom the server refuses", async () => {
    render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(screen.getByRole("button", { name: /Assign room/ })).toBeTruthy();
    cleanup();

    signedIn({ scope: {
      staffId: "44444444-4444-4444-4444-444444444444", email: "hk@fidato.in",
      fullName: "Housekeeper", isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }],
    } });
    render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(screen.getByRole("tab", { name: "Rooms" }).getAttribute("aria-selected"),
      "the Rooms board is open to them").toBe("true");
    expect(screen.queryByRole("button", { name: /Assign room/ })).toBeNull();
  });

  it("renders fourteen date columns", async () => {
    const { container } = render(<App />);
    await showCalendar();
    expect(container.querySelectorAll("[data-date-col]")).toHaveLength(14);
  });

  it("renders the seventeen sellable rooms, not the eighteen physical ones", async () => {
    const { container } = render(<App />);
    await showCalendar();
    expect(container.querySelectorAll("[data-room-row]")).toHaveLength(17);
  });

  it("draws booking bars from the demo data", async () => {
    const { container } = render(<App />);
    await showCalendar();
    expect(container.querySelectorAll("[data-booking-bar]").length).toBeGreaterThan(0);
  });

  /* FD-13: a cell with only a column was auto-placed into a second row
     wherever a bar held its column, so a room with a booking was two rows
     tall with "Book room" buttons under the bar. jsdom has no layout, so
     the placement itself is what is checked. */
  it("keeps a room with a booking one row tall: every empty cell is on the bar's row", async () => {
    const { container } = render(<App />);
    await showCalendar();
    const row = container.querySelector("[data-booking-bar]")!.closest("[data-room-row]")!;
    const cells = [...row.querySelectorAll<HTMLElement>('button[aria-label^="Book room"]')];
    expect(cells).toHaveLength(14);
    expect(cells.map((c) => c.style.gridRow)).toEqual(cells.map(() => "1"));
  });

  it("offers every filter pill with a live count", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    const pills = [...container.querySelectorAll("[data-filter-pill]")].map((p) =>
      p.getAttribute("data-filter-pill"),
    );
    /* Arrivals earns its own pill: a check-in must visibly move a number,
       and it is the one that drops when a guest is checked in. */
    expect(pills).toEqual([
      "All", "Vacant", "Occupied", "Arrivals", "Reserved", "Blocked", "Due Out", "Dirty",
    ]);
  });

  it("names the pills in the legend's own words", async () => {
    /* The pills said Vacant / Occupied / Dirty / Blocked above a legend
       saying Free / In house / Needs cleaning / Out of service — the same
       rooms in two languages (clarity plan, 15 September). The keys above
       stay; this is what a person reads. "Empty", not "Free": it counts
       every room without a guest, including the ones still to clean. */
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    const words = [...container.querySelectorAll("[data-filter-pill]")].map((p) =>
      p.firstChild?.textContent,
    );
    expect(words).toEqual([
      "All", "Empty", "In house", "Arriving", "Reserved", "Out of service", "Due out", "Needs cleaning",
    ]);
  });

  it("shows one main action on each tab of the stay panel", async () => {
    /* One orange button, and it is the next step (clarity plan, step 2).
       stay-turn-out is due out with ₹5,715.15 owed: on Stay the act is
       "Settle and check out"; on Bill it is Settle, while Check out waits,
       blocked and NOT orange — two primaries would say neither. */
    go(`/h/${HOTEL}/stay?res=stay-turn-out`);
    render(<App />);
    const panel = await screen.findByRole("dialog");
    const primaries = () => [...panel.querySelectorAll('[data-variant="primary"]')];

    await within(panel).findByText("Settle and check out");
    expect(primaries().map((b) => b.textContent?.trim())).toEqual(["Settle and check out"]);

    fireEvent.mouseDown(within(panel).getByRole("tab", { name: "Bill" }), { button: 0 });
    await waitFor(() =>
      expect(primaries().map((b) => b.textContent?.trim())).toEqual(["Settle"]),
    );
  });

  it("opens the detail panel from a deep link, with the chart still behind it", async () => {
    go(`/h/${HOTEL}/stay?res=stay-overpaid`);
    const { container } = render(<App />);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Kalyani Rege")).toBeDefined();
    /* The clerk must not lose their place — the screen is still THERE,
       behind the panel.

       Asserted on the ROOMS view, because that is what a deep link now
       opens behind. The chart cannot be reached from here at all: an
       open dialog marks the rest of the document `aria-hidden`, so
       clicking its tab finds nothing. `data-room-tile` is the floor's
       row marker; `data-room-row` belongs to the chart. */
    expect(container.querySelectorAll("[data-room-tile]").length).toBe(17);
  });

  it("shows the house as tiles, and no tile contradicts itself", async () => {
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    await screen.findAllByText("Superior");

    /* `role="tab"` — Segmented is a tablist, not a row of buttons. */
    fireEvent.click(screen.getByRole("tab", { name: "Rooms" }));

    /* ⚠ THE BUG THIS HOLDS SHUT. The tile's guest was read from the
       chart's BARS and its label from `room.state`, and the two answer
       different questions: a checked-out stay still covers today — its
       arrival is behind us and its departure is this morning — so tiles
       read "FREE" with a guest's name printed underneath. A screen
       contradicting itself in the space of two lines.

       Asserted as an invariant rather than against a fixture room,
       because the next way to break it will not be the same way. */
    /* `data-room-tile`, not "a button whose first span is a number" —
       that also matched every filter pill above the grid. */
    await waitFor(() => {
      expect(document.querySelectorAll("[data-room-tile]").length)
        .toBeGreaterThan(0);
    });

    /* AND WAIT FOR THE NAMES. Who is in each room is a second query,
       enabled only in this view, so the tiles render before it lands.
       The first version asserted immediately, found no guest on any
       tile, and therefore passed with the bug reintroduced — which is
       the exact failure it exists to prevent.

       Verified the other way round: with the old `arrival <= today <=
       departure` rule put back, this fails. */
    await waitFor(() => {
      expect(document.querySelectorAll("[data-tile-guest]").length)
        .toBeGreaterThan(0);
    });

    const tiles = [...document.querySelectorAll("[data-room-tile]")];
    const free = tiles.filter((t) => (t.textContent ?? "").includes("Free"));
    expect(free.length, "no free rooms in the fixture to check").toBeGreaterThan(0);

    for (const tile of free) {
      expect(
        tile.querySelector("[data-tile-guest]"),
        `a tile said Free and named a guest: ${tile.textContent}`,
      ).toBeNull();
    }
  });

  it("names the group a stay belongs to, rather than saying 'Group'", async () => {
    /* This pill read "Group" and nothing else — true, useless, and a
       dead end. A clerk holding a phone wants to know WHICH group and
       how many rooms are in it. The relationship was on the query all
       along and thrown away at the last step. */
    go(`/h/${HOTEL}/stay?res=stay-grp-1`);
    render(<App />);
    const panel = await screen.findByRole("dialog");

    /* The BUTTON, not any text — the stay's own note happens to mention
       the same function, and matching on text alone would pass on the
       note while the pill was missing. */
    const pill = within(panel).getByRole("button", {
      name: /Pancham Hall function/,
    });
    expect(pill.textContent).toMatch(/one of 3 rooms/);

    /* And it OPENS the group's rooms beside the stay rather than
       navigating away. "Who else is in this booking" is asked while
       looking at one, and answering it by leaving makes somebody find
       their way back. */
    fireEvent.click(pill);
    const rooms = await screen.findByText(/Group reservation list/i);
    expect(rooms).toBeDefined();
  });
});


/* ══════════════════════════════════════════════════════════════════
   A PHONE GETS THE CARDS, WHATEVER THE TOGGLE SAYS

   16 September, the owner's decision. These five screens share
   `StayTable`, which has had a purpose-built card view behind a
   remembered table/cards toggle since the start — so a clerk whose
   toggle said "table" met a table wider than their phone inside a
   sideways scroller.

   The breakpoint decides which of the two renders, and jsdom has no
   breakpoints, so what is asserted here is the STRUCTURE the breakpoint
   acts on: the cards exist, in a wrapper that hides them from `sm` up,
   while the table sits in one that hides it below. If somebody removes
   either wrapper, one of the two is shown at every width — two copies
   of the same list on one screen — and this fails.
   ══════════════════════════════════════════════════════════════════ */
describe("the stay lists on a phone", () => {
  beforeEach(() => {
    /* The toggle is remembered in localStorage, and "table" is what a
       clerk who has never touched it has. That is the case this is
       about. */
    try { localStorage.setItem("fidato-stay-view", "table"); } catch { /* not fatal */ }
  });

  it("renders the cards below sm and the table from sm up", async () => {
    go(`/h/${HOTEL}/arrivals`);
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);

    /* `[class~=]` rather than an escaped `.sm\:hidden`: a class with a
       colon in it must be escaped in a selector, and it is easy to write
       one backslash where JavaScript needs two — which silently matches
       nothing and makes the test pass for the wrong reason. An exact
       match on the whole class token cannot be got wrong that way. */
    const cards = container.querySelector('div[class~="sm:hidden"] > ul[data-stay-cards]');
    expect(cards, "the stay cards are not rendered on a phone").not.toBeNull();
    expect(cards!.querySelectorAll("li").length).toBeGreaterThan(0);

    /* One list, not two: these cards belong to THIS screen, and if the
       toggle ever renders them as well a phone shows the same stays
       twice down the page. */
    expect(container.querySelectorAll("[data-stay-cards]")).toHaveLength(1);

    const table = container.querySelector('div[class~="sm:block"] table');
    expect(table, "the table is not hidden below sm").not.toBeNull();
  });

  it("hides the table/cards toggle on a phone, where there is nothing to choose", async () => {
    go(`/h/${HOTEL}/arrivals`);
    render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);

    const toggle = screen.getByLabelText("Show as cards").parentElement!;
    expect(toggle.className).toContain("hidden");
    expect(toggle.className).toContain("sm:flex");
  });
});
