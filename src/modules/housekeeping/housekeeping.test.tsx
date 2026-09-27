import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn } from "@/test/app";
import {
  COST_RECORDERS, COST_VIEWERS, REPAIR_REPORTERS, recordsCosts, seesCosts,
} from "@/modules/housekeeping/repairRoles";

/* ══════════════════════════════════════════════════════════════════
   HOUSEKEEPING — the screen's half

   The room card's three words and why a grey one is grey (the owner,
   D17-8), the room that is already out saying what its button does, and
   the Work orders list refusing to read a failure as "nothing
   outstanding". The server's half — repairs on equipment, costs with
   proof, every role at every door — is api/test/modules/housekeeping/.

   The stub serves the demo rooms, every one clean but 308, which is out.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

/* The board's room list, counted, and made to fail on demand — a refresh
   on a stairwell with the signal gone. Everything else passes through. */
const board = vi.hoisted(() => ({
  calls: 0, failing: false,
  /* When set, the rooms are not answered until it settles. */
  hold: null as null | Promise<void>,
  /* When set, the Work orders list answers with it (D22-34's test). */
  orders: null as null | { mayUpdate: boolean },
}));
vi.mock("@/modules/housekeeping/data/housekeeping", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/housekeeping/data/housekeeping")>();
  return {
    ...real,
    listHousekeeping: async (...args: Parameters<typeof real.listHousekeeping>) => {
      board.calls += 1;
      if (board.failing) throw new Error("Could not reach the server.");
      if (board.hold) await board.hold;
      return real.listHousekeeping(...args);
    },
    /* The stub answers no room write; the server's half of marking a room
       is api/test. Here a mark lands, so the board can say it did. */
    markRoom: async () => ({ ok: true }),
    listWorkOrders: async (...args: Parameters<typeof real.listWorkOrders>) => {
      if (!board.orders) return real.listWorkOrders(...args);
      return {
        orders: [{
          id: "wo-1", room: "204", title: "Dripping tap", detail: null, category: "plumbing",
          priority: "normal", status: "open", raisedBy: "Asha", raisedAt: "2026-09-21",
          assignedTo: null, daysOpen: 1, blocksRoom: false, closedBy: null, closedAt: null,
          resolution: null, equipment: null,
        }],
        open: 1, closed: 0, closedShown: 50,
        mayRecordCosts: false, maySeeCosts: false, mayUpdate: board.orders.mayUpdate,
      };
    },
  };
});

const card = async (room: string) => {
  const heading = await screen.findByText(room, { selector: "span" });
  return heading.closest<HTMLElement>("[data-hk-room]")!;
};

describe("the room card (D17-8)", () => {
  it("puts a word under each icon - Clean, Inspected, Repair", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const room = within(await card("201"));
    expect(room.getByRole("button", { name: "Mark room 201 clean" }).textContent).toBe("Clean");
    expect(room.getByRole("button", { name: "Mark room 201 inspected" }).textContent).toBe("Inspected");
    expect(room.getByRole("button", { name: "Report a repair in room 201" }).textContent).toBe("Repair");
  });

  it("says why a grey button is grey when it is tapped - and marks nothing", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const el = await card("201");
    const clean = within(el).getByRole("button", { name: "Mark room 201 clean" });
    expect(clean.getAttribute("aria-disabled")).toBe("true");

    /* Before the tap it says nothing; the status line is there, empty,
       so a screen reader is already listening. */
    const said = within(el).getByRole("status");
    expect(said.textContent).toBe("");

    fireEvent.click(clean);
    expect(said.textContent).toBe("Room 201 is already marked clean.");
    /* Still clean: a grey tap sends nothing. */
    expect(clean.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not grey Inspected on a clean room, nor Repair on any room", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const room = within(await card("202"));
    expect(room.getByRole("button", { name: "Mark room 202 inspected" }).getAttribute("aria-disabled")).toBeNull();
    expect(room.getByRole("button", { name: "Report a repair in room 202" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("opens Report a repair for that room, with taking it out a second choice, unticked", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    fireEvent.click(within(await card("209")).getByRole("button", { name: "Report a repair in room 209" }));
    const dialog = await screen.findByRole("dialog", { name: "Report a repair · Room 209" });
    const box = within(dialog).getByText("Take room 209 out of service too")
      .closest("label")!.querySelector<HTMLElement>("[role='checkbox']")!;
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).getByRole("button", { name: "Out of service without a repair" })).toBeDefined();
  });

  /* The owner, 28 September: "I tried to click inspect and that thing is not
     working". It had marked the room; nothing said so, and the room left the
     card's place a second later. */
  it("says at once that a room is inspected - the owner, 28 September", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    fireEvent.click(within(await card("202")).getByRole("button", { name: "Mark room 202 inspected" }));
    expect(await screen.findByText("Room 202 is inspected.")).toBeDefined();
  });

  it("moves the room the moment it is marked, not when the rooms come back", async () => {
    let answer!: () => void;
    try {
      go(`/h/${HOTEL}/housekeeping`);
      render(<App />);
      await card("201");
      /* An empty clean room: one in house stays under In house. */
      const el = document.querySelector<HTMLElement>('[data-hk-group="clean"] [data-hk-room]')!;
      const n = el.dataset.hkRoom!;
      board.hold = new Promise<void>((r) => { answer = r; });
      fireEvent.click(within(el).getByRole("button", { name: `Mark room ${n} inspected` }));
      await waitFor(() =>
        expect(document.querySelector(`[data-hk-group="inspected"] [data-hk-room="${n}"]`)).not.toBeNull());
    } finally {
      answer?.();
      board.hold = null;
    }
  });

  it("jumps from a count at the top to its group; a zero or Due out does not look pressable", async () => {
    const jumped: string[] = [];
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { jumped.push(this.id); };
    try {
      go(`/h/${HOTEL}/housekeeping`);
      render(<App />);
      await card("201");
      fireEvent.click(screen.getByRole("button", { name: /^Out of service/ }));
      expect(jumped).toEqual(["hk-out-of-service"]);
      /* Nothing needs cleaning in the stub, and Due out has no group here. */
      expect(screen.queryByRole("button", { name: /^Needs cleaning/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Due out/ })).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it("says Put back on a room that is already out - the owner, 17 September", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const out = await screen.findByText("Put back");
    expect(out.closest("button")?.getAttribute("data-hk-put-back")).toBe("308");
    expect(screen.queryByText("Take out of service")).toBeNull();
  });
});

describe("the board refreshes itself (HK-1, D17-39)", () => {
  it("reads the rooms again on its own, and keeps them when that read fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      board.failing = false;
      go(`/h/${HOTEL}/housekeeping`);
      render(<App />);
      await card("201");
      const before = board.calls;

      /* Thirty seconds with nobody touching it: the board asks again. */
      await act(async () => { vi.advanceTimersByTime(31_000); });
      await waitFor(() => expect(board.calls).toBeGreaterThan(before));

      /* And the next time the line is down. React Query keeps the rooms it
         had and marks the query failed; the board must keep showing them —
         the offline board the critique called the reference. */
      board.failing = true;
      const failedFrom = board.calls;
      await act(async () => { vi.advanceTimersByTime(31_000); });
      await waitFor(() => expect(board.calls).toBeGreaterThan(failedFrom));
      await act(async () => { await Promise.resolve(); });

      expect(screen.queryByText("The rooms did not load")).toBeNull();
      expect(await card("201")).toBeDefined();
    } finally {
      board.failing = false;
      vi.useRealTimers();
    }
  });

  /* The live half (f4cccf5): the board is told the moment a room changes.
     The server's half is api/test/live.test.ts; this is the board's own -
     a `housekeeping` event on the channel, and the rooms asked for again. */
  it("reads the rooms again the moment the live channel says housekeeping", async () => {
    let line: ReadableStreamDefaultController<Uint8Array> | undefined;
    let atConnect = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!String(url).endsWith(`/api/hotels/${HOTEL}/live`)) return new Promise(() => {});
      atConnect = board.calls;
      return { ok: true, body: new ReadableStream<Uint8Array>({ start: (c) => { line = c; } }) };
    });
    try {
      board.failing = false;
      go(`/h/${HOTEL}/housekeeping`);
      render(<App />);
      await card("201");
      await waitFor(() => expect(line, "the board never opened the live channel").toBeDefined());
      /* Connecting reads everything once; that read lands first. */
      await waitFor(() => expect(board.calls).toBeGreaterThan(atConnect));
      const before = board.calls;

      line!.enqueue(new TextEncoder().encode("event: changed\ndata: housekeeping\n\n"));
      await waitFor(() => expect(board.calls).toBeGreaterThan(before));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still says the rooms did not load when it never had any", async () => {
    board.failing = true;
    try {
      /* Agra, whose board nothing in this file has loaded: the app keeps one
         query cache per file, so 5 Elements' rooms are already in it. */
      go(`/h/AGR/housekeeping`);
      render(<App />);
      expect(await screen.findByText("The rooms did not load")).toBeDefined();
    } finally {
      board.failing = false;
    }
  });
});

describe("Work orders", () => {
  it("says the list did not load, rather than 'Nothing outstanding'", async () => {
    /* The stub answers no /work-orders address, which is a failure. The
       list used to turn every failure into an empty one (root MEMORY 251's
       fault, in this service). */
    go(`/h/${HOTEL}/work-orders`);
    render(<App />);
    expect(await screen.findByText("Work orders did not load")).toBeDefined();
    expect(screen.queryByText("Nothing outstanding")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Open/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /^Closed/ })).toBeDefined();
  });

  /* A property each, because the app's one query cache would hand the second
     render the first one's list. */
  it.each([[true, "AGR"], [false, HOTEL]] as const)(
    "offers Start and Close only where the server says so (D22-34): %s", async (mayUpdate, code) => {
    board.orders = { mayUpdate };
    try {
      go(`/h/${code}/work-orders`);
      render(<App />);
      const order = await screen.findByText("Dripping tap");
      const cardEl = order.closest<HTMLElement>("[data-work-order]")!;
      expect(within(cardEl).queryByRole("button", { name: "Start" }) !== null).toBe(mayUpdate);
      expect(within(cardEl).queryByRole("button", { name: /Close/ }) !== null).toBe(mayUpdate);
      expect(document.querySelector("[data-repair-who]") !== null).toBe(!mayUpdate);
    } finally {
      board.orders = null;
    }
  });
});

describe("who sees and records repair costs", () => {
  it("is the owner's list: five record, the accountant also sees, nobody else does", () => {
    expect([...COST_RECORDERS].sort()).toEqual(["admin", "gm", "hotel_manager", "owner", "stores"]);
    expect([...COST_VIEWERS].sort()).toEqual(["admin", "finance", "gm", "hotel_manager", "owner", "stores"]);
    expect(recordsCosts("finance")).toBe(false);
    expect(seesCosts("finance")).toBe(true);
    for (const role of ["front_desk", "housekeeping", "chef", "kitchen_manager", "read_only"] as const) {
      expect(seesCosts(role), role).toBe(false);
    }
    /* Reporting a repair is wider: everybody who works with the things. */
    expect(REPAIR_REPORTERS).toContain("housekeeping");
    expect(REPAIR_REPORTERS).not.toContain("finance");
  });
});
