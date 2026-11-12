import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "@/App";
import * as apiModule from "@/lib/api";
import { HOTEL, go, signedIn, startSignedIn, withDemoHotel } from "@/test/app";
import { LIST_SCREENS, exportBody, exportRefusal } from "@/modules/reports/data/listExport";

/* ══════════════════════════════════════════════════════════════════
   A LIST SCREEN AS A FILE, on the screen (D27-383 item 1)

   What a list sends is what it shows: a search narrows the file to its own
   rows. A role that may open a list of money but not download reports sees
   the buttons disabled, with the reason in words. The server's own
   refusals are api/test/listFiles.test.ts.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  startSignedIn();
  try { localStorage.setItem("fidato-stay-view", "table"); } catch { /* not fatal */ }
});

describe("the body a list sends", () => {
  it("keeps raw values, and a missing figure as null, never 0", () => {
    const body = exportBody(
      [{ label: "Guest", value: (r: { g: string; b?: number }) => r.g }, { label: "Balance", value: (r) => r.b, kind: "money" }],
      [{ g: "Asha" }, { g: "Ben", b: 12.5 }],
      [["Search", ""], ["Showing", "All"]],
    );
    expect(body.rows).toEqual([["Asha", null], ["Ben", 12.5]]);
    expect(body.columns[1]).toEqual({ label: "Balance", kind: "money" });
    expect(body.facts, "an empty filter is left out").toEqual([{ label: "Showing", value: "All" }]);
  });
});

describe("a filtered list", () => {
  it("exports only the rows its search leaves, with the search on the file", async () => {
    signedIn({ scope: { staffId: "s", email: "gm@fidato.in", fullName: "GM", isGroupAdmin: true, hotels: [] } });
    withDemoHotel();
    const download = vi.spyOn(apiModule, "downloadFile").mockResolvedValue("x.xlsx");
    go(`/h/${HOTEL}/arrivals`);
    render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    const table = document.querySelector('div[class~="sm:block"] table')!;
    const all = table.querySelectorAll("tbody tr").length;
    expect(all).toBeGreaterThan(1);

    /* The first row's reference: a search that leaves exactly that stay. */
    const reference = within(table.querySelector("tbody tr") as HTMLElement).getByText(/^[A-Z]+-/).textContent!;
    fireEvent.change(screen.getByLabelText("Filter this list"), { target: { value: reference } });
    await waitFor(() => expect(table.querySelectorAll("tbody tr").length).toBeLessThan(all));
    const left = document.querySelectorAll('div[class~="sm:block"] table tbody tr').length;

    fireEvent.click(within(document.querySelector('[data-export="arrivals"]') as HTMLElement).getByRole("button", { name: /Excel/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const [path, body] = download.mock.calls[0]! as [string, ReturnType<typeof exportBody>];
    expect(path).toBe(`/api/hotels/${HOTEL}/exports/arrivals.xlsx`);
    expect(body.rows).toHaveLength(left);
    for (const r of body.rows) expect(r).toContain(reference);
    expect(body.facts).toContainEqual({ label: "Search", value: reference });
    download.mockRestore();
  });
});

describe("a role without the reports' download right", () => {
  it("sees a list of money's buttons disabled, with the reason", async () => {
    withDemoHotel();
    go(`/h/${HOTEL}/folios`);
    render(<App />);
    const pair = await waitFor(() => {
      const el = document.querySelector('[data-export="folios"]');
      if (!el) throw new Error("no export buttons");
      return el as HTMLElement;
    });
    for (const b of within(pair).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(pair.textContent).toContain("download reports");
  });

  it("takes no Guest ledger CSV either: the files' right, decided under D27-396", async () => {
    withDemoHotel();
    go("/reports/guest-ledger");
    render(<App />);
    const csv = await waitFor(() => {
      const b = screen.getAllByRole("button").find((x) => x.textContent?.trim() === "CSV");
      if (!b) throw new Error("no CSV button");
      return b as HTMLButtonElement;
    }, { timeout: 8000 });
    expect(csv.disabled).toBe(true);
    expect(csv.title).toContain("download reports");
  });
});

describe("a screen with an export right of its own (second part)", () => {
  it("names who holds it: the Equipment register asks `export` on `equipment`", () => {
    expect(exportRefusal("front_desk", LIST_SCREENS["equipment"])).toBe(
      "Exporting the equipment register is for the owner, an administrator, the general manager "
      + "or the accountant. Ask one of them.");
    expect(exportRefusal("finance", LIST_SCREENS["equipment"])).toBeNull();
    /* Not the reports' right: the revenue manager downloads reports, not this. */
    expect(exportRefusal("revenue_manager", LIST_SCREENS["equipment"])).not.toBeNull();
  });
});
