import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, useLocation } from "react-router";
import type { ReactElement } from "react";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { useToastStore } from "@/components/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { TooltipProvider } from "@/components/ui";
import { TopBar } from "@/components/app/TopBar";
import { flatNavigationFor, mayReach, navItemFor, sidebarFor } from "@/components/app/navigation";
import { SETTINGS_PAGES, addressOf } from "@/components/app/settingsConsole";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { SetupStillToDo } from "@/modules/admin";
import SetupPage from "@/modules/admin/setup/SetupPage";
import {
  GROUPS, SETUP_PAGE, STEPS, STEP_IDS, TOTAL_STEPS, screenAddress, type StepId,
} from "@/modules/admin/setup/steps";
import type { SetupStepState, SetupView, StepState } from "@/modules/admin/data/setup";

/* ══════════════════════════════════════════════════════════════════
   SET UP THIS HOTEL - the screens' half of the owner's D27-311

   18 steps in three groups and a summary; each opens the real screen with
   ?setup=<step>; Completed is drawn only where the server could not tell
   (`automatic` false); Later and Remind me send their choice; Next moves
   without asking the server; any screen opened with ?setup shows "Back to
   setup"; the Dashboard lists the steps put off, only while one waits and
   only for the owner, an Admin and the GM.

   The server's half (derived states, the bell) is the API helper's: these
   tests answer the two calls themselves, as the contract describes them.
   ══════════════════════════════════════════════════════════════════ */

const TODAY = "2026-10-13";
const HOTEL = {
  id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra", state: "UP", gstin: null,
  timezone: "Asia/Kolkata", currency: "INR", checkInTime: "14:00", checkOutTime: "11:00",
  businessDate: TODAY, today: TODAY,
};

function as(role: Role) {
  signedIn({
    scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
      isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
    },
    hotels: [HOTEL],
  });
  useUi.setState({ hotelId: "AGR" });
}

/* Derived by the server (no Completed): the five a first booking needs and
   the payment methods. The rest only a person can say. */
const AUTOMATIC: readonly StepId[] = ["profile", "taxes", "room-types", "rooms", "prices", "payments"];

function stepOf(id: StepId, state: StepState = "todo", over: Partial<SetupStepState> = {}): SetupStepState {
  return {
    id, state, automatic: AUTOMATIC.includes(id), detail: null, remindOn: null, by: null, at: null, ...over,
  };
}

/** Profile, room types done; taxes, rooms, prices still to do; payments put
    off; the front desk to be reminded; the rest to do. */
function sampleView(over: Partial<Record<StepId, Partial<SetupStepState> & { state: StepState }>> = {}): SetupView {
  const base: Partial<Record<StepId, Partial<SetupStepState> & { state: StepState }>> = {
    profile: { state: "done" },
    taxes: { state: "todo", detail: "No tax rule for rooms yet." },
    "room-types": { state: "done" },
    rooms: { state: "todo", detail: "No rooms yet." },
    prices: { state: "todo", detail: "Deluxe has no price." },
    payments: { state: "later", automatic: false },
    "front-desk": { state: "remind", remindOn: "2026-10-20" },
    ...over,
  };
  return {
    steps: STEP_IDS.map((id) => stepOf(id, base[id]?.state ?? "todo", base[id] ?? {})),
    ready: false,
  };
}

type Call = { path: string; method: string; body: unknown };

/** The two calls, with a server that remembers what it was told. */
function serve(view: SetupView = sampleView(), refuse?: string) {
  const sent: Call[] = [];
  const asked: string[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    asked.push(path);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { choice: string; remindOn?: string };
      sent.push({ path, method: "PUT", body });
      if (refuse) throw new apiModule.ApiError(409, refuse, { ok: false, reason: refuse });
      const id = path.split("/").pop() as StepId;
      const next: Record<string, StepState> = { completed: "done", later: "later", remind: "remind", clear: "todo" };
      view = { ...view, steps: view.steps.map((s) => s.id !== id ? s : {
        ...s, state: next[body.choice]!, remindOn: body.choice === "remind" ? body.remindOn ?? null : null,
      }) };
      return { ok: true } as never;
    }
    if (path === "/api/hotels/AGR/setup") return view as never;
    return new Promise(() => {}) as never;
  });
  return { sent, asked };
}

const Where = () => <p data-testid="where">{useLocation().pathname}{useLocation().search}</p>;

const show = (node: ReactElement, at = "/x") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider><MemoryRouter initialEntries={[at]}>{node}<Where /></MemoryRouter></TooltipProvider>
  </QueryClientProvider>,
);

const wizard = (at = "/x?step=profile") => show(<SetupPage />, at);
const header = (n: number) => screen.getByRole("button", { name: new RegExp(`^Step ${n}:`) });
const where = () => screen.getByTestId("where").textContent;
/** The page has the steps (the heading comes first, with the skeleton). */
const loaded = () => screen.findByRole("heading", { level: 2, name: "Optional" }, { timeout: 5000 });

beforeEach(() => { as("gm"); useToastStore.setState({ toasts: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the 18 steps", () => {
  it("are in the owner's order, in three groups and a summary", () => {
    expect(STEPS.map((s) => `${s.number} ${s.id}`)).toEqual([
      "1 profile", "2 taxes", "3 room-types", "4 rooms", "5 prices",
      "6 payments", "7 front-desk", "8 cancellation", "9 charges", "10 booking-sources", "11 people",
      "12 messages", "13 modules",
      "14 branding", "15 policies", "16 lists", "17 connections",
      "18 go-live",
    ]);
    expect(TOTAL_STEPS).toBe(18);
    expect(GROUPS.map((g) => `${g.title}: ${STEPS.filter((s) => s.group === g.key).map((s) => s.number).join(",")}`))
      .toEqual([
        "Must be done before the first booking: 1,2,3,4,5",
        "Before opening: 6,7,8,9,10,11,12,13",
        "Optional: 14,15,16,17",
        "Ready to go live: 18",
      ]);
  });

  it("each open a screen that exists, and the owner, an Admin and the GM can reach every one", () => {
    const pages = new Set(SETTINGS_PAGES.filter((p) => "load" in p).map(addressOf));
    for (const step of STEPS) {
      if (step.id === "go-live") { expect(step.screens).toEqual([]); continue; }
      expect(step.screens.length, step.id).toBeGreaterThan(0);
      for (const screen of step.screens) {
        const real = screen.to.startsWith("/settings/") ? pages.has(screen.to) : !!navItemFor(screen.to);
        expect(real, `${step.id}: ${screen.to}`).toBe(true);
        for (const role of ["owner", "admin"] as const) {
          expect(mayReach(role, screen.to.replace(":code", "AGR")), `${role} ${screen.to}`).toBe(true);
        }
      }
    }
  });

  it("use plain words: no tenant, commissioning, provisioning or folio, and no long dash", () => {
    const words = STEPS.flatMap((s) => [s.title, s.what, s.why, ...s.screens.map((x) => x.label)]).join("\n");
    expect(words).not.toMatch(/tenant|commissioning|provisioning|folio|—/i);
  });

  it("open each screen with ?setup=<step>", () => {
    const rates = STEPS.find((s) => s.id === "prices")!.screens[0]!;
    expect(screenAddress(rates, "AGR", "prices")).toBe("/h/AGR/rates?setup=prices");
    const roomTypes = STEPS.find((s) => s.id === "rooms")!.screens[0]!;
    expect(screenAddress(roomTypes, "AGR", "rooms")).toBe("/settings/rooms/room-types?setup=rooms");
  });
});

describe("Set up this hotel in the Settings menu", () => {
  it("is offered to the owner, an Admin and the GM, and to nobody else", () => {
    const names = (role: Role) => sidebarFor(role, "AGR", undefined, "settings")
      .flatMap((s) => s.items.map((i) => i.label));
    for (const role of ["owner", "admin", "gm"] as const) {
      expect(names(role), role).toContain("Set up this hotel");
      expect(flatNavigationFor(role, "AGR").some((i) => i.to === SETUP_PAGE), role).toBe(true);
      expect(mayReach(role, SETUP_PAGE), role).toBe(true);
    }
    for (const role of ["front_desk", "housekeeping", "finance", "read_only"] as const) {
      expect(names(role), role).not.toContain("Set up this hotel");
      expect(mayReach(role, SETUP_PAGE), role).toBe(false);
    }
  });

  it("comes after Profile, so the console still opens on Profile", () => {
    const property = sidebarFor("gm", "AGR", undefined, "settings").find((s) => s.key === "settings-property")!;
    expect(property.items.slice(0, 2).map((i) => i.label)).toEqual(["Profile", "Set up this hotel"]);
  });
});

describe("the setup page", () => {
  it("shows the three groups, then the summary, and every step in order", async () => {
    serve();
    wizard();
    await loaded();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Must be done before the first booking", "Before opening", "Optional"]);
    expect(screen.getByRole("region", { name: "Ready to go live" })).toBeTruthy();
    expect([...document.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-step"))).toEqual([...STEP_IDS]);
    expect(screen.getByText("2 of 5 done")).toBeTruthy();
  });

  it("asks the server again each time it opens, so work done on the real screen shows", async () => {
    const { asked } = serve();
    /* The app keeps every read forever (App.tsx): the same default here. */
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const open = () => render(
      <QueryClientProvider client={client}>
        <TooltipProvider><MemoryRouter initialEntries={["/x?step=profile"]}><SetupPage /></MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    const first = open();
    await loaded();
    first.unmount();
    open();
    await loaded();
    await waitFor(() => expect(asked.filter((p) => p === "/api/hotels/AGR/setup")).toHaveLength(2));
  });

  it("shows each step's state, with the date for Remind me, and what is missing when not done", async () => {
    serve();
    wizard("/x?step=taxes");
    await loaded();
    const state = (id: string) => document.querySelector(`[data-step="${id}"] button span.rounded-full:not([aria-hidden])`)?.textContent;
    expect(state("profile")).toBe("Done");
    expect(state("taxes")).toBe("To do");
    expect(state("payments")).toBe("Later");
    expect(state("front-desk")).toBe("Remind me 20 Oct");
    /* The open step says what it is, why, and what is missing. */
    const panel = document.getElementById("setup-panel-taxes")!;
    expect(within(panel).getByText("The GST added to room charges, by price slab.")).toBeTruthy();
    expect(within(panel).getByText("What is missing")).toBeTruthy();
    expect(within(panel).getByText("No tax rule for rooms yet.")).toBeTruthy();
  });

  it("says nothing is missing on a step that is done", async () => {
    serve();
    wizard("/x?step=profile");
    const panel = await waitFor(() => {
      const p = document.getElementById("setup-panel-profile");
      expect(p?.textContent).toBeTruthy();
      return p!;
    });
    expect(within(panel).queryByText("What is missing")).toBeNull();
  });

  it("opens the step the address names, and by default the first one still to do", async () => {
    serve();
    wizard("/x?step=lists");
    await loaded();
    expect(header(16).getAttribute("aria-expanded")).toBe("true");
    expect(header(1).getAttribute("aria-expanded")).toBe("false");
    cleanup();

    serve();
    wizard("/x");
    await waitFor(() => expect(header(2).getAttribute("aria-expanded")).toBe("true"));
    await waitFor(() => expect(where()).toBe("/x?step=taxes"));
  });

  it("opens the real screen with ?setup=<step>", async () => {
    serve();
    wizard("/x?step=prices");
    const link = await screen.findByRole("link", { name: "Open Rates" });
    expect(link.getAttribute("href")).toBe("/h/AGR/rates?setup=prices");
    fireEvent.click(header(4));
    expect((await screen.findByRole("link", { name: "Open Room types" })).getAttribute("href"))
      .toBe("/settings/rooms/room-types?setup=rooms");
  });

  it("shows a screen the role cannot open disabled, with the reason, not hidden", async () => {
    /* Modules is the owner's and an Admin's; the GM opens Settings but not that. */
    serve();
    wizard("/x?step=modules");
    const button = await screen.findByRole("button", { name: "Open Modules" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Your role cannot open Modules. Ask the owner or an Admin.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Modules" })).toBeNull();
  });

  it("offers Completed only where the server could not tell", async () => {
    serve();
    wizard("/x?step=taxes");
    await screen.findByRole("group", { name: "Choices for Taxes" });
    expect(screen.queryByRole("button", { name: "Completed" })).toBeNull();
    for (const name of ["Next", "Later", "Remind me"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(header(16));
    await screen.findByRole("group", { name: "Choices for The lists" });
    expect(screen.getByRole("button", { name: "Completed" })).toBeTruthy();
  });

  it("sends Completed for a step only a person can tick, and shows it done", async () => {
    const { sent } = serve();
    wizard("/x?step=lists");
    fireEvent.click(await screen.findByRole("button", { name: "Completed" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/setup/lists", method: "PUT", body: { choice: "completed" } },
    ]));
    await waitFor(() => expect(document.querySelector('[data-step="lists"]')!.getAttribute("data-state")).toBe("done"));
  });

  it("sends Later, and shows the step as Later", async () => {
    const { sent } = serve();
    wizard("/x?step=taxes");
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/setup/taxes", method: "PUT", body: { choice: "later" } },
    ]));
    await waitFor(() => expect(document.querySelector('[data-step="taxes"]')!.getAttribute("data-state")).toBe("later"));
  });

  it("sends Remind me for tomorrow, in 3 days, in a week - from the hotel's own today", async () => {
    const { sent } = serve();
    for (const [label, remindOn] of [["Tomorrow", "2026-10-14"], ["In 3 days", "2026-10-16"], ["In a week", "2026-10-20"]] as const) {
      sent.length = 0;
      wizard("/x?step=prices");
      fireEvent.click(await screen.findByRole("button", { name: "Remind me" }));
      fireEvent.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => expect(sent).toEqual([
        { path: "/api/hotels/AGR/setup/prices", method: "PUT", body: { choice: "remind", remindOn } },
      ]));
      cleanup();
    }
  });

  it("sends Remind me for a date, never one that is not after today", async () => {
    const { sent } = serve();
    wizard("/x?step=prices");
    fireEvent.click(await screen.findByRole("button", { name: "Remind me" }));
    const date = screen.getByLabelText("Remind me on this date");
    const set = screen.getByRole("button", { name: "Remind me on this date" }) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    fireEvent.change(date, { target: { value: "2026-10-13" } });
    expect(set.disabled).toBe(true);
    expect(screen.getByText("Pick a day after today.")).toBeTruthy();
    fireEvent.change(date, { target: { value: "2026-11-02" } });
    expect(set.disabled).toBe(false);
    fireEvent.click(set);
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/setup/prices", method: "PUT", body: { choice: "remind", remindOn: "2026-11-02" } },
    ]));
  });

  it("takes a choice back with Undo", async () => {
    const { sent } = serve();
    wizard("/x?step=payments");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/setup/payments", method: "PUT", body: { choice: "clear" } },
    ]));
  });

  it("moves to the next step on Next, and asks the server for nothing", async () => {
    const { sent, asked } = serve();
    wizard("/x?step=taxes");
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(header(3).getAttribute("aria-expanded")).toBe("true"));
    expect(header(2).getAttribute("aria-expanded")).toBe("false");
    expect(where()).toBe("/x?step=room-types");
    expect(sent).toEqual([]);
    expect(asked.filter((p) => p !== "/api/hotels/AGR/setup")).toEqual([]);
    /* ...and from the last working step to the summary. */
    fireEvent.click(header(17));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(header(18).getAttribute("aria-expanded")).toBe("true"));
  });

  it("shows the server's sentence when a choice is refused, and changes nothing", async () => {
    serve(sampleView(), "Pick a day after today.");
    wizard("/x?step=taxes");
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => `${t.title}: ${t.description}`))
      .toEqual(["Not saved: Pick a day after today."]));
    expect(document.querySelector('[data-step="taxes"]')!.getAttribute("data-state")).toBe("todo");
  });

  it("says when the steps did not load", async () => {
    vi.spyOn(apiModule, "api").mockRejectedValue(new apiModule.ApiError(500, "boom"));
    wizard();
    expect(await screen.findByText("The setup steps did not load")).toBeTruthy();
  });
});

describe("step 18, ready to go live", () => {
  it("lists what is done and what waits, and says it is not ready while the first five are not done", async () => {
    serve();
    wizard("/x?step=go-live");
    const panel = await waitFor(() => {
      const p = document.getElementById("setup-panel-go-live");
      expect(p?.textContent).toBeTruthy();
      return p!;
    });
    expect(panel.querySelector("[data-ready]")).toBeNull();
    expect(within(panel).getByText(/Not ready yet\./)).toBeTruthy();
    expect(panel.textContent).toContain("Taxes, Rooms, Prices");
    /* Still to do: the 15 steps not done, those put off first. */
    expect(within(panel).getByRole("heading", { name: "Still to do (15)" })).toBeTruthy();
    const waiting = within(panel).getAllByRole("button").map((b) => b.textContent);
    expect(waiting.slice(0, 2)).toEqual([
      "Step 6, Payment methods and bank detailsLater",
      "Step 7, Front desk times and rulesRemind me 20 Oct",
    ]);
    expect(within(panel).getByRole("heading", { name: "Done (2)" })).toBeTruthy();
    /* A step in the list opens that step. */
    fireEvent.click(within(panel).getByRole("button", { name: /^Step 8, Cancellation terms/ }));
    await waitFor(() => expect(where()).toBe("/x?step=cancellation"));
  });

  it("says Ready to go live once steps 1 to 5 are done, and has no button that changes anything", async () => {
    serve({ ...sampleView({ taxes: { state: "done" }, rooms: { state: "done" }, prices: { state: "done" } }), ready: true });
    wizard("/x?step=go-live");
    const panel = await waitFor(() => {
      const p = document.getElementById("setup-panel-go-live");
      expect(p?.querySelector("[data-ready]")).toBeTruthy();
      return p!;
    });
    expect(panel.querySelector("[data-ready]")!.textContent).toContain("Ready to go live.");
    expect(panel.textContent).toContain("Nothing is locked");
    expect(panel.querySelector("[data-not-ready]")).toBeNull();
    /* The only buttons are the steps still to do, and they only open that step. */
    for (const name of ["Completed", "Later", "Remind me", "Next", "Undo", /go live/i, /switch/i, /open the hotel/i]) {
      expect(within(panel).queryByRole("button", { name }), String(name)).toBeNull();
    }
    expect(within(panel).queryAllByRole("link")).toEqual([]);
  });
});

describe("Back to setup", () => {
  const bar = (at: string, hotel = "AGR") => {
    useUi.setState({ hotelId: hotel });
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
    return show(<TopBar />, at);
  };

  it("says which step of 18 this is on any screen opened with ?setup=<step>, and links back to it", () => {
    bar("/h/AGR/rates?setup=prices");
    expect(screen.getByRole("status").textContent)
      .toBe("Setting up this hotel: step 5 of 18, PricesBack to setup");
    expect(screen.getByRole("link", { name: "Back to setup" }).getAttribute("href")).toBe("/h/AGR/setup?step=prices");
  });

  it("is the same on a Settings screen", () => {
    bar("/settings/money/bank?setup=payments");
    expect(screen.getByRole("status").textContent).toContain("step 6 of 18, Payment methods and bank details");
    expect(screen.getByRole("link", { name: "Back to setup" }).getAttribute("href")).toBe("/h/AGR/setup?step=payments");
  });

  it("is not there without ?setup, or for a step that does not exist", () => {
    bar("/h/AGR/rates");
    expect(document.querySelector("[data-setup-bar]")).toBeNull();
    cleanup();
    bar("/h/AGR/rates?setup=nonsense");
    expect(document.querySelector("[data-setup-bar]")).toBeNull();
  });

  it("is not offered to somebody who could not open the setup", () => {
    as("front_desk");
    bar("/h/AGR/rates?setup=prices");
    expect(document.querySelector("[data-setup-bar]")).toBeNull();
  });
});

describe("Still to do on the Dashboard", () => {
  const list = () => show(<SetupStillToDo code="AGR" />);

  it("lists the steps put off, each opening the setup at that step", async () => {
    serve();
    list();
    const region = await screen.findByRole("region", { name: "Still to do" });
    const links = within(region).getAllByRole("link");
    expect(links.map((a) => `${a.textContent} ${a.getAttribute("href")}`)).toEqual([
      "Set up this hotel /h/AGR/setup",
      "Step 6, Payment methods and bank detailsLater /h/AGR/setup?step=payments",
      "Step 7, Front desk times and rulesRemind me 20 Oct /h/AGR/setup?step=front-desk",
    ]);
  });

  it("is not drawn while nothing waits", async () => {
    const { asked } = serve(sampleView({ payments: { state: "todo" }, "front-desk": { state: "todo" } }));
    list();
    await waitFor(() => expect(asked).toContain("/api/hotels/AGR/setup"));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-setup-still]")).toBeNull();
  });

  it("shows a few and says how many more", async () => {
    const all: Partial<Record<StepId, { state: StepState }>> = {};
    for (const id of STEP_IDS.slice(0, 7)) all[id] = { state: "later" };
    serve(sampleView(all));
    list();
    const region = await screen.findByRole("region", { name: "Still to do" });
    expect(within(region).getAllByRole("link")).toHaveLength(1 + 4);
    expect(region.textContent).toContain("and 3 more");
  });

  it("is not drawn, and asks nothing, for a role without Settings", async () => {
    as("front_desk");
    const { asked } = serve();
    list();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-setup-still]")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("says nothing when the server cannot answer", async () => {
    vi.spyOn(apiModule, "api").mockRejectedValue(new apiModule.ApiError(500, "boom"));
    list();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-setup-still]")).toBeNull();
  });
});

describe("the way in", () => {
  it("/h/:code/setup lands on the page in Settings, with ?step= kept", async () => {
    serve();
    const { routes } = await import("@/modules/admin/routes");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/h/AGR/setup?step=prices"]}><Routes>{routes}</Routes><Where /></MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await loaded();
    expect(where()).toBe(`${SETUP_PAGE}?step=prices`);
    expect(header(5).getAttribute("aria-expanded")).toBe("true");
  });

  it("is refused to a role without Settings", async () => {
    as("front_desk");
    serve();
    const { routes } = await import("@/modules/admin/routes");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider><MemoryRouter initialEntries={["/h/AGR/setup"]}><Routes>{routes}</Routes></MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("This page is not part of your role")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Set up this hotel" })).toBeNull();
  });
});

describe("the property checklist", () => {
  it("links to the setup", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
      if (path === "/api/hotels/AGR/commissioning") {
        return {
          property: "Fidato Agra", done: 0, total: 1, canTakeABooking: false, blockedBy: ["gstin"],
          checks: [{ id: "gstin", label: "GSTIN", done: false, detail: "No GSTIN.", blocking: true, to: "/settings/property" }],
        } as never;
      }
      return new Promise(() => {}) as never;
    });
    show(<CommissioningCard hotelId="AGR" />);
    const link = await screen.findByRole("link", { name: /Set up this hotel, step by step/ });
    expect(link.getAttribute("href")).toBe("/h/AGR/setup");
  });
});
