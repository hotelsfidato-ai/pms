import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { HOTEL, TEST_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import PeoplePage from "@/modules/admin/pages/People";

/* ══════════════════════════════════════════════════════════════════
   MAKING AND RUNNING TEST HOTELS, AND THE PEOPLE IN THEM
   (the owner's D27-296 (3), (6), (10))

   Properties: beside each real hotel, for a group administrator only,
   "Make a test hotel"; once made, its name with TEST, Open, Reset and
   Re-copy setup - each of the last two going only once its word (RESET,
   RE-COPY) is typed, then saying what it did in the server's figures, or
   the server's own sentence. A test hotel is not a card of its own.

   People: the Test switch in Add somebody (a group administrator's), on =
   only test hotels, with "Works only in the test hotel, never the real
   one"; off = only real hotels, as before. Give a property lists test
   hotels with TEST, for a group administrator only; a person's test-hotel
   access carries TEST. Anybody else never sees a test hotel to give.

   The server's half - who may, and what is deleted and copied - is the
   API helper's (test-hotels-core).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
type Call = { path: string; method: string; body: unknown };

const sessionHotel = (id: string, code: string, name: string, testOf: string | null = null) => ({
  id, code, name, city: "Akkalkot", state: "MH", gstin: null, timezone: "Asia/Kolkata",
  currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-08-25", testOf,
});
const HOTELS = [
  sessionHotel("h-5el", HOTEL, "5 Elements Akkalkot"),
  sessionHotel("h-agr", "AGR", "Fidato Agra"),
  /* Named without TEST: it is `testOf` that makes it one. */
  sessionHotel("h-test", TEST_HOTEL, "Akkalkot practice", HOTEL),
];

const asGroupAdmin = () => signedIn({
  scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
           fullName: "Group Owner", isGroupAdmin: true, hotels: [] },
  hotels: HOTELS, hotelId: "h-5el",
});
const asGm = () => signedIn({
  scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "gm@fidato.in",
           fullName: "A Manager", isGroupAdmin: false, hotels: [{ hotelId: "h-5el", role: "gm" }] },
  hotels: [HOTELS[0]!], hotelId: "h-5el",
});

/** Answers by "METHOD path"; an answer that throws is the server refusing. */
function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(404, "Not found.");
    return answer(body) as never;
  });
  return calls;
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string, element: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={path} element={element} /><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const adminRow = (code: string, name: string) => ({
  id: `h-${code}`, code, name, city: "Akkalkot", state: "MH", gstin: null, phone: null, email: null,
  addressLine: null, isActive: true, rooms: 10, roomTypes: ["Deluxe"], checkedIn: 0,
});
/* The admin list as it is today: every hotel, the test one too, and no
   testOf on it - the session's GET /api/hotels says which is which. */
const ADMIN_LIST = { hotels: [adminRow(HOTEL, "5 Elements Akkalkot"), adminRow("AGR", "Fidato Agra"),
                              adminRow(TEST_HOTEL, "Akkalkot practice")] };

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Properties: a real hotel's test hotel", () => {
  beforeEach(asGroupAdmin);

  it("is under its real hotel, with TEST, and is no card of its own", async () => {
    server({ "GET /api/admin/hotels": () => ADMIN_LIST });
    renderAt("/properties", <PropertiesPage />);
    const own = await screen.findByText("Akkalkot practice");
    const section = own.closest("[data-test-hotel]") as HTMLElement;
    expect(section.getAttribute("data-test-hotel")).toBe(HOTEL);
    expect(within(section).getByText("TEST")).toBeTruthy();
    for (const name of ["Open", "Reset", "Re-copy setup"]) {
      expect(within(section).getByRole("button", { name })).toBeTruthy();
    }
    /* Two properties, not three: the test hotel is counted nowhere. */
    expect(screen.getByText("2 open")).toBeTruthy();
    expect(screen.getAllByText("Akkalkot practice")).toHaveLength(1);
  });

  it("offers a real hotel without one Make a test hotel, and says what it is", async () => {
    const calls = server({
      "GET /api/admin/hotels": () => ADMIN_LIST,
      "POST /api/admin/hotels/AGR/test-hotel": () => ({ code: "AGRT", name: "Fidato Agra · TEST" }),
    });
    /* The session's re-read, watched: the stub server has no new hotel to give. */
    const original = useSession.getState().refresh;
    const refresh = vi.fn(async () => {});
    useSession.setState({ refresh });
    try {
      renderAt("/properties", <PropertiesPage />);
      const section = (await screen.findAllByText("Make a test hotel"))[0]!.closest("[data-test-hotel]") as HTMLElement;
      expect(section.getAttribute("data-test-hotel")).toBe("AGR");
      expect(within(section).getByText("A practice copy of this hotel's whole setup, with no guests or money."))
        .toBeTruthy();
      fireEvent.click(within(section).getByRole("button", { name: "Make a test hotel" }));
      await waitFor(() => expect(calls.find((c) => c.method === "POST")?.path)
        .toBe("/api/admin/hotels/AGR/test-hotel"));
      /* The session learns the new hotel, so the switcher and the stripe do. */
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    } finally {
      useSession.setState({ refresh: original });
    }
  });

  it("says the server's sentence when it will not make one", async () => {
    const SENTENCE = "Fidato Agra already has a test hotel.";
    server({
      "GET /api/admin/hotels": () => ADMIN_LIST,
      "POST /api/admin/hotels/AGR/test-hotel": () => { throw new ApiError(409, SENTENCE); },
    });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Make a test hotel" }))[0]!);
    expect((await screen.findByRole("alert")).textContent).toBe(SENTENCE);
  });

  it("resets only once RESET is typed, says what goes and what stays, then how many went", async () => {
    const calls = server({
      "GET /api/admin/hotels": () => ADMIN_LIST,
      [`POST /api/admin/hotels/${TEST_HOTEL}/test-reset`]: () => ({ removed: 42 }),
    });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/every booking, bill,\s+invoice, restaurant order, guest, company, cash entry, stock move and night audit/))
      .toBeTruthy();
    expect(within(dialog).getByText(/and the people testing in it/)).toBeTruthy();

    const go = within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    const box = within(dialog).getByLabelText("Type RESET to confirm");
    fireEvent.change(box, { target: { value: "reset" } });
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    fireEvent.change(box, { target: { value: "RESET" } });
    expect(go.disabled).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);

    fireEvent.click(go);
    expect(await within(dialog).findByText("Removed 42 records.")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      { path: `/api/admin/hotels/${TEST_HOTEL}/test-reset`, method: "POST", body: { confirm: "RESET" } },
    ]);
  });

  it("shows the server's sentence when a reset is refused", async () => {
    const SENTENCE = "Only the owner or a group administrator resets a test hotel.";
    server({
      "GET /api/admin/hotels": () => ADMIN_LIST,
      [`POST /api/admin/hotels/${TEST_HOTEL}/test-reset`]: () => { throw new ApiError(403, SENTENCE); },
    });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(SENTENCE);
  });

  it("re-copies only once RE-COPY is typed, naming the real hotel, then what it did", async () => {
    const calls = server({
      "GET /api/admin/hotels": () => ADMIN_LIST,
      [`POST /api/admin/hotels/${TEST_HOTEL}/test-recopy`]: () => ({ removed: 3, copied: 120 }),
    });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-copy setup" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(
      "Brings 5 Elements Akkalkot's rooms, rates, menu and settings again; test activity is deleted first.",
    )).toBeTruthy();
    const go = within(dialog).getByRole("button", { name: "Re-copy setup" }) as HTMLButtonElement;
    const box = within(dialog).getByLabelText("Type RE-COPY to confirm");
    fireEvent.change(box, { target: { value: "RESET" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "RE-COPY" } });
    fireEvent.click(go);
    expect(await within(dialog).findByText(
      "Removed 3 records. Copied 120 records of setup from 5 Elements Akkalkot.",
    )).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")).toEqual(
      { path: `/api/admin/hotels/${TEST_HOTEL}/test-recopy`, method: "POST", body: { confirm: "RE-COPY" } });
  });

  it("opens the test hotel: the property every screen reads, then its Rooms", async () => {
    server({ "GET /api/admin/hotels": () => ADMIN_LIST });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/h/${TEST_HOTEL}/stay`));
    expect(useUi.getState().hotelId).toBe(TEST_HOTEL);
    expect(useSession.getState().hotelId).toBe("h-test");
  });
});

describe("Properties for anybody else", () => {
  it("offers no test hotel to make, reset or re-copy", async () => {
    asGm();
    server({ "GET /api/hotels": () => ({ hotels: [] }) });
    renderAt("/properties", <PropertiesPage />);
    expect(await screen.findByText("The properties you can reach.")).toBeTruthy();
    expect(screen.queryByText("Make a test hotel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("not even were the admin list handed to somebody who is not a group administrator", async () => {
    asGm();
    server({ "GET /api/admin/hotels": () => ADMIN_LIST });
    renderAt("/properties", <PropertiesPage />);
    expect(await screen.findByText("Fidato Agra")).toBeTruthy();
    expect(screen.queryByText("Make a test hotel")).toBeNull();
    expect(document.querySelector("[data-test-hotel]")).toBeNull();
  });
});

/* ── People ───────────────────────────────────────────────────────── */

const ROLES_ALL = ["admin", "gm", "hotel_manager", "front_desk", "housekeeping", "pos", "read_only"];
const person = (over: Record<string, unknown> = {}) => ({
  id: "p-1", email: "asha@fidato.in", name: "Asha", phone: null, canSignIn: true,
  isGroupAdmin: false, isActive: true, homeScreen: "dashboard",
  mayEdit: true, maySwitch: true, maySetPassword: true,
  access: [{ code: HOTEL, role: "front_desk" }], ...over,
});

function peopleServer(staff: unknown[], rosterAt: unknown[], sent: Call[] = []) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/admin/staff") return { staff, rosterAt } as never;
    if (method === "POST") {
      sent.push({ path: url, method, body: JSON.parse(String(init?.body)) });
      return { ok: true, id: "p-new", existed: false } as never;
    }
    throw new ApiError(404, "Not found.");
  });
  return sent;
}
const place = (code: string, name: string) => ({ code, name, roles: ROLES_ALL });
const ROSTER = [place(HOTEL, "5 Elements Akkalkot"), place("AGR", "Fidato Agra"), place(TEST_HOTEL, "Akkalkot practice")];

const fillIn = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByLabelText(/Their name/), { target: { value: "Tara Tester" } });
  fireEvent.change(within(dialog).getByLabelText(/The email they will sign in with/),
    { target: { value: "tara@fidato.in" } });
  fireEvent.change(within(dialog).getByLabelText(/A password for them/),
    { target: { value: "a-long-password-1" } });
};

describe("People, for a group administrator", () => {
  beforeEach(asGroupAdmin);

  it("adds somebody with Test on AT a test hotel only, and says they work only there", async () => {
    const sent = peopleServer([person()], ROSTER);
    renderAt("/people", <PeoplePage />);
    await screen.findByText("Asha");
    fireEvent.click(screen.getByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");

    /* Off, as today: no place asked of a group administrator. */
    const toggle = within(dialog).getByRole("switch", { name: /Test/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).queryByLabelText(/Where they work/)).toBeNull();

    fireEvent.click(toggle);
    const where = within(dialog).getByLabelText(/Where they work/) as HTMLSelectElement;
    expect([...where.options].map((o) => o.value)).toEqual([TEST_HOTEL]);
    expect(where.options[0]!.textContent).toBe(`${TEST_HOTEL} · Akkalkot practice · TEST`);
    expect(within(dialog).getByText("Works only in the test hotel, never the real one.")).toBeTruthy();

    fillIn(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ path: "/api/admin/staff",
      body: { email: "tara@fidato.in", hotelCode: TEST_HOTEL, role: "front_desk" } });
  });

  it("with Test off, offers no test hotel and adds as before", async () => {
    const sent = peopleServer([person()], ROSTER);
    renderAt("/people", <PeoplePage />);
    await screen.findByText("Asha");
    fireEvent.click(screen.getByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Works only in the test hotel/)).toBeNull();
    fillIn(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).not.toHaveProperty("hotelCode");
  });

  it("gives a real member of staff a test hotel as a second place, listed with TEST", async () => {
    peopleServer([person()], ROSTER);
    renderAt("/people", <PeoplePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Give a property/ }));
    const dialog = await screen.findByRole("dialog");
    const which = within(dialog).getByLabelText(/Which property/) as HTMLSelectElement;
    expect([...which.options].map((o) => o.textContent)).toEqual([
      "Choose…", "AGR · Fidato Agra", `${TEST_HOTEL} · Akkalkot practice · TEST`,
    ]);
  });

  it("offers somebody who works only in test hotels no real hotel", async () => {
    peopleServer([person({ access: [{ code: TEST_HOTEL, role: "front_desk" }] })], ROSTER);
    renderAt("/people", <PeoplePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Give a property/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nothing left to give")).toBeTruthy();
  });

  it("shows TEST beside a test hotel on a person's places, and not beside a real one", async () => {
    peopleServer([person({ access: [{ code: HOTEL, role: "front_desk" }, { code: TEST_HOTEL, role: "gm" }] })], ROSTER);
    renderAt("/people", <PeoplePage />);
    const test = (await screen.findByText(TEST_HOTEL)).closest("li") as HTMLElement;
    expect(within(test).getByText("TEST")).toBeTruthy();
    const real = screen.getByText(HOTEL).closest("li") as HTMLElement;
    expect(within(real).queryByText("TEST")).toBeNull();
  });
});

describe("People, for a GM", () => {
  it("has no Test switch, and never offers a test hotel", async () => {
    asGm();
    /* Even were the server to list one, a GM is not offered it. */
    peopleServer([person()], [place(HOTEL, "5 Elements Akkalkot"), place(TEST_HOTEL, "Akkalkot practice")]);
    useSession.setState((s) => ({ hotels: [...s.hotels, HOTELS[2]!] }));
    renderAt("/people", <PeoplePage />);
    await screen.findByText("Asha");
    /* Asha is already at the GM's one real hotel: nothing is left to give. */
    expect(screen.queryByRole("button", { name: /Give a property/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("switch", { name: /Test/ })).toBeNull();
    const where = within(dialog).getByLabelText(/Where they work/) as HTMLSelectElement;
    expect([...where.options].map((o) => o.value)).toEqual([HOTEL]);
  });
});
