import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import QRCode from "qrcode";
import * as apiModule from "@/lib/api";
import * as notice from "@/modules/online-checkin/privacyNotice";
import * as googleRedirect from "@/modules/online-checkin/googleRedirect";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import GuestPage from "@/modules/online-checkin/pages/GuestPage";
import GoogleReturn from "@/modules/online-checkin/pages/GoogleReturn";
import DeskPage from "@/modules/online-checkin/pages/Desk";
import { MessagesToTheDesk, WaitingDetailsLink } from "@/modules/online-checkin";
import { signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S PAGE — what a stranger holding the link can see

   The screen's half of the door's rules (api/src/routes/guestDoor.ts).
   The server keeps its own half and is tested beside it
   (api/test/guestDoor*.test.ts); these say the page does not leak what
   the server withholds, does not tell a wrong phone number from a right
   one, and carries THIS TAB's unlock - never the link alone (D21-6).

   `api` is stubbed per path: the page must never call anything else,
   and an unlisted call fails the test rather than answering empty.
   ══════════════════════════════════════════════════════════════════ */

const TOKEN = "a-token-from-the-desk";
const OPEN = `/api/guest/${TOKEN}`;

const BOOKING = {
  kind: "booking" as const,
  hotel: { code: "5EL", name: "5 Elements Akkalkot" },
  room: null,
  occupied: true,
  booking: {
    reference: "FH-2609-5001", guestName: "A. Guest",
    checkIn: "2026-08-25", checkOut: "2026-08-27", status: "confirmed",
  },
  verified: false,
  phoneHint: "…4321",
  emailHint: "a…@example.com" as string | null,
  canSendCodes: true,
  cannotSend: null,
  googleClientId: null as string | null,
  offers: [] as string[],
};

/** The door's answer to "send me the code" (D27-105). */
const SENT = { sent: true, message: "We sent the code on WhatsApp to the number ending 4321." };
const ON_WHATSAPP = { name: "Send the code on WhatsApp" };
const BY_EMAIL = { name: "Send the code by email" };

type Answer = (init?: RequestInit) => unknown;

function server(routes: Record<string, Answer>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = routes[url.split("?")[0]!];
    if (!answer) throw new apiModule.ApiError(500, `the page called ${url}`);
    return answer(init) as never;
  });
}

const unlockSent = (init?: RequestInit) =>
  /^Guest (\S+)$/.exec((init?.headers as Record<string, string> | undefined)?.["authorization"] ?? "")?.[1];

function open(path = `/g/${TOKEN}`, route = "/g/:token", page = <GuestPage />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={page} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The dark modules a card's QR image draws, read back out of its SVG. */
function modulesDrawn(src: string): boolean[] {
  const svg = decodeURIComponent(src.replace("data:image/svg+xml;utf8,", ""));
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
  const path = /stroke="[^"]*" d="([^"]*)"/.exec(svg)![1]!;
  const dark = new Array<boolean>(size * size).fill(false);
  let x = 0, y = 0;
  for (const [, cmd, a, b] of path.matchAll(/([Mmh])(\d+)(?: ([\d.]+))?/g)) {
    if (cmd === "M") { x = Number(a); y = Math.floor(Number(b)); }
    else if (cmd === "m") x += Number(a);
    else for (let k = 0; k < Number(a); k++) dark[y * size + x++] = true;
  }
  return dark;
}
const modulesOf = (text: string) => Array.from(QRCode.create(text).modules.data, Boolean);

beforeEach(() => {
  document.title = "";
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom without storage */ }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("before the six digits are answered", () => {
  it("shows what a clerk would say across the counter, and no more", async () => {
    server({ [OPEN]: () => BOOKING, [`${OPEN}/code`]: () => SENT });
    open();

    expect(await screen.findByText("A. Guest")).toBeTruthy();
    expect(screen.getByText("FH-2609-5001")).toBeTruthy();
    expect(screen.getByText(/on the booking, ending 4321/)).toBeTruthy();
    expect(screen.queryByText(/Verified/)).toBeNull();
  });

  it("asks the server for nothing else — no details, no requests, and no code (D27-210)", async () => {
    const spy = server({ [OPEN]: () => BOOKING, [`${OPEN}/code`]: () => SENT });
    open();
    await screen.findByRole("button", ON_WHATSAPP);

    /* The link, and nothing more: opening sends no code (D27-210), and a
       screen that fetched what is behind the code and hid it would be a
       leak with a stylesheet. */
    expect(spy.mock.calls.map((c) => c[0])).toEqual([OPEN]);
  });

  /* D27-223: the hotel's logo, else the group's - an <img> on the door's
     own address for this link, which answers the picture and nothing else.
     Decorative: the hotel's name is printed under it. */
  it("shows the hotel's logo above its name, from the door, and nothing where it does not load", async () => {
    server({ [OPEN]: () => BOOKING });
    open();

    await screen.findByText("A. Guest");
    const logo = await waitFor(() => {
      const img = document.querySelector("header img");
      expect(img).toBeTruthy();
      return img!;
    });
    expect(logo.getAttribute("src")).toMatch(new RegExp(`/api/guest/${TOKEN}/logo$`));
    expect(logo.getAttribute("alt"), "the name is printed under it").toBe("");
    expect(logo.compareDocumentPosition(screen.getByText("5 Elements Akkalkot")) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    fireEvent.error(logo);   // no logo, or the link stopped opening: the door's 404
    expect(document.querySelector("header img"), "no broken picture").toBeNull();
  });

  it("says the same nothing for a link that is dead, whatever killed it", async () => {
    server({});
    open();

    expect(await screen.findByRole("heading", {
      name: "This link is not usable. Ask the desk for a new one.",
    })).toBeTruthy();
    expect(screen.queryByText("A. Guest")).toBeNull();
  });

  /* OCI-3. A request that never arrived said "Ask the desk for a new one"
     to a guest whose link was fine - found by opening the page while its
     server was still starting. */
  it("tells a line that is down from a link that is dead", async () => {
    server({ [OPEN]: () => { throw new apiModule.ApiError(0, "Could not reach the server."); } });
    open();

    expect(await screen.findByRole("heading", { name: "We could not reach the hotel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/Ask the desk for a new one/)).toBeNull();
  });

  /* D21-25: "Send me the code" was offered when nothing could send. */
  it("does not offer a code when none can be sent, and says why first", async () => {
    const cannot = "Codes cannot be sent yet - sending is not set up on this server. Ask the desk.";
    server({ [OPEN]: () => ({ ...BOOKING, canSendCodes: false, cannotSend: cannot }) });
    open();

    expect(await screen.findByText(cannot)).toBeTruthy();
    expect(screen.queryByRole("button", ON_WHATSAPP)).toBeNull();
    expect(screen.queryByRole("button", BY_EMAIL)).toBeNull();
    expect(screen.queryByLabelText("The six digits")).toBeNull();
  });
});

describe("a room's fixed card (D21-7)", () => {
  const CARD = {
    ...BOOKING, kind: "room" as const, room: "204", booking: null, phoneHint: null, emailHint: null,
  };

  it("shows the hotel and the room number, and nothing of the guest (D21-14)", async () => {
    const toTheRoom = "We sent the code on WhatsApp to the phone on the booking.";
    server({ [OPEN]: () => CARD, [`${OPEN}/code`]: () => ({ sent: true, message: toTheRoom }) });
    open();

    expect(await screen.findByRole("heading", { name: "Room 204" })).toBeTruthy();
    /* Both ways are offered: a card cannot say which the booking has. */
    expect(screen.getByRole("button", BY_EMAIL)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", ON_WHATSAPP));
    expect(await screen.findByText(toTheRoom), "the code goes, with no digits said").toBeTruthy();
    expect(screen.getByText("5 Elements Akkalkot")).toBeTruthy();
    expect(screen.queryByText(/ending/), "not even the last four digits").toBeNull();
    expect(screen.queryByText(/@/), "nor any of an address").toBeNull();
    expect(screen.queryByText("Arriving")).toBeNull();
  });

  it("says only that it opens once you are checked in, for an empty room (D21-15)", async () => {
    server({ [OPEN]: () => ({ ...CARD, occupied: false }) });
    open();

    expect(await screen.findByRole("heading", { name: "This opens once you're checked in" })).toBeTruthy();
    expect(screen.getByText("5 Elements Akkalkot")).toBeTruthy();
    expect(screen.queryByLabelText("Your phone number")).toBeNull();
  });
});

describe("the code, the way the guest chooses (D27-207, D27-210)", () => {
  const codeCalls = (spy: ReturnType<typeof server>) => spy.mock.calls.filter((c) => c[0] === `${OPEN}/code`);

  it("sends nothing on opening, and says where each way would go", async () => {
    const spy = server({ [OPEN]: () => BOOKING, [`${OPEN}/code`]: () => SENT });
    open();

    expect(await screen.findByText(
      "We send six digits on WhatsApp to the number on the booking, ending 4321, or by email to a…@example.com.",
    )).toBeTruthy();
    expect(screen.getByRole("button", ON_WHATSAPP)).toBeTruthy();
    expect(screen.getByRole("button", BY_EMAIL)).toBeTruthy();
    expect(screen.queryByLabelText("Your phone number"), "nothing to type but the code").toBeNull();
    expect(codeCalls(spy), "no code goes until the guest asks").toHaveLength(0);
  });

  it("sends by the way the guest presses, with nothing typed, and says where it went", async () => {
    const byEmail = { sent: true, message: "We sent the code by email to a…@example.com." };
    const spy = server({
      [OPEN]: () => BOOKING,
      [`${OPEN}/code`]: (init) => (String(init?.body).includes("email") ? byEmail : SENT),
    });
    open();

    fireEvent.click(await screen.findByRole("button", ON_WHATSAPP));
    expect(await screen.findByText(SENT.message)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", BY_EMAIL));
    expect(await screen.findByText(byEmail.message)).toBeTruthy();
    expect(codeCalls(spy).map((c) => c[1]?.body), "only the way goes: no number, no address")
      .toEqual(['{"by":"whatsapp"}', '{"by":"email"}']);
  });

  /* A booking's link already shows what the booking carries: a way that
     cannot work is not offered. */
  it("offers only the way the booking has, and Ask the desk when it has neither", async () => {
    server({ [OPEN]: () => ({ ...BOOKING, emailHint: null }) });
    open();
    expect(await screen.findByRole("button", ON_WHATSAPP)).toBeTruthy();
    expect(screen.queryByRole("button", BY_EMAIL)).toBeNull();
    cleanup();

    server({ [OPEN]: () => ({ ...BOOKING, phoneHint: null }) });
    open();
    expect(await screen.findByRole("button", BY_EMAIL)).toBeTruthy();
    expect(screen.queryByRole("button", ON_WHATSAPP)).toBeNull();
    expect(screen.queryByText(/ending/)).toBeNull();
    cleanup();

    const spy = server({ [OPEN]: () => ({ ...BOOKING, phoneHint: null, emailHint: null }) });
    open();
    expect(await screen.findByText(
      "There is no mobile number or email address on this booking, so no code can be sent. Ask the desk.")).toBeTruthy();
    expect(screen.queryByLabelText("The six digits"), "no code to wait for, no box").toBeNull();
    expect(codeCalls(spy), "nothing asked of the door").toHaveLength(0);
  });

  it("prints the door's refusal to send, not a status code", async () => {
    /* OCI-1's screen half. `api()` has read a refusal's `message` since
       21 September, so the sentence arrives as the error's own. */
    const message = "Codes cannot be sent yet - sending is not set up on this server. Ask the desk.";
    server({
      [OPEN]: () => BOOKING,
      [`${OPEN}/code`]: () => { throw new apiModule.ApiError(503, message); },
    });
    open();
    fireEvent.click(await screen.findByRole("button", ON_WHATSAPP));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/Request failed/)).toBeNull();
  });

  /* The development-only switch: the code on screen. In a built app the
     branch is compiled away and the build check refuses the name. */
  it("shows a development server's code on screen, in a development build", async () => {
    server({ [OPEN]: () => BOOKING, [`${OPEN}/code`]: () => ({ ...SENT, devCode: "482913" }) });
    open();
    fireEvent.click(await screen.findByRole("button", ON_WHATSAPP));
    expect(await screen.findByText("482913")).toBeTruthy();
    expect(screen.getByText(/Development only/)).toBeTruthy();
  });

  it("prints the server's refusal of a wrong code, and stays shut", async () => {
    server({
      [OPEN]: () => BOOKING,
      [`${OPEN}/code`]: () => SENT,
      [`${OPEN}/verify`]: () => {
        throw new apiModule.ApiError(401,
          "That code is not right, or it has expired. Ask for a new one.");
      },
    });
    open();
    await screen.findByText("A. Guest");

    fireEvent.change(screen.getByLabelText("The six digits"), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my booking" }));

    await waitFor(() => expect(screen.getByText(
      "That code is not right, or it has expired. Ask for a new one.")).toBeTruthy());
    expect(screen.queryByText(/Verified/)).toBeNull();
  });
});

describe("Continue with Google (D27-207), with no script of Google's (OCI-10)", () => {
  const CLIENT = "made-up-client.apps.googleusercontent.test";
  const WITH_GOOGLE = { ...BOOKING, googleClientId: CLIENT };
  const CONTINUE = { name: "Continue with Google" };
  const UNLOCK = "an-unlock-from-a-google-answer-0123456789";
  const KEPT = "google-sign-in";

  /** The browser leaving for Google, stood in for: the address it was sent to. */
  const leaving = () => vi.spyOn(googleRedirect.browser, "leaveFor").mockImplementation(() => undefined);

  /** Google's answer arriving back at /g-return, in the address's fragment. */
  function comeBack(hash: string) {
    window.history.replaceState(null, "", `/g-return${hash}`);
    open("/g-return", "/g-return", <GoogleReturn />);
  }

  afterEach(() => { window.history.replaceState(null, "", "/"); });

  it("is offered only where the server has its client id and the booking an email", async () => {
    server({ [OPEN]: () => WITH_GOOGLE });
    open();
    expect(await screen.findByRole("button", CONTINUE)).toBeTruthy();
    cleanup();

    server({ [OPEN]: () => BOOKING });
    open();
    await screen.findByRole("button", ON_WHATSAPP);
    expect(screen.queryByRole("button", CONTINUE), "no client id on the server").toBeNull();
    cleanup();

    server({ [OPEN]: () => ({ ...WITH_GOOGLE, emailHint: null }) });
    open();
    await screen.findByRole("button", ON_WHATSAPP);
    expect(screen.queryByRole("button", CONTINUE), "no email on the booking to match").toBeNull();
  });

  it("sends the guest to Google's own page with this system's id, the return address, a nonce and a state - and adds no script", async () => {
    const left = leaving();
    server({ [OPEN]: () => WITH_GOOGLE });
    open();
    fireEvent.click(await screen.findByRole("button", CONTINUE));

    expect(left).toHaveBeenCalledTimes(1);
    const to = new URL(left.mock.calls[0]![0]);
    expect(`${to.origin}${to.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(to.searchParams);
    expect(q).toMatchObject({
      client_id: CLIENT, redirect_uri: `${window.location.origin}/g-return`,
      response_type: "id_token", scope: "openid email",
    });
    expect(q["nonce"]!.length, "a nonce of its own").toBeGreaterThanOrEqual(16);
    expect(q["state"]!.length, "a state of its own").toBeGreaterThanOrEqual(16);
    expect(to.href, "the guest's link never goes to Google").not.toContain(TOKEN);

    /* Kept in THIS tab only, for the return. */
    expect(JSON.parse(sessionStorage.getItem(KEPT)!)).toEqual({ state: q["state"], nonce: q["nonce"], token: TOKEN });
    expect(document.querySelectorAll("script").length, "nothing of Google's runs on the page").toBe(0);
  });

  it("posts Google's answer with this tab's nonce, keeps the unlock and opens the booking", async () => {
    sessionStorage.setItem(KEPT, JSON.stringify({ state: "state-of-this-tab-0001", nonce: "nonce-of-this-tab-0001", token: TOKEN }));
    const spy = server({
      [`${OPEN}/google`]: () => ({ verified: true, unlock: UNLOCK }),
      [OPEN]: (init) => ({ ...WITH_GOOGLE, verified: unlockSent(init) === UNLOCK }),
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/messages`]: () => ({ thread: [] }),
      [`${OPEN}/requests`]: () => ({ offers: [], requests: [] }),
    });
    window.history.replaceState(null, "", "/g-return#state=state-of-this-tab-0001&id_token=googles-signed-answer");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/g-return"]}>
          <Routes>
            <Route path="/g-return" element={<GoogleReturn />} />
            <Route path="/g/:token" element={<GuestPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Verified on this phone")).toBeTruthy();
    const posted = spy.mock.calls.find((c) => c[0] === `${OPEN}/google`);
    expect(JSON.parse(String(posted![1]?.body))).toEqual({ credential: "googles-signed-answer", nonce: "nonce-of-this-tab-0001" });
    expect(localStorage.getItem(`guest-unlock:${TOKEN.slice(0, 12)}`), "the same unlock as a code").toBe(UNLOCK);
    expect(sessionStorage.getItem(KEPT), "used once").toBeNull();
    expect(window.location.hash, "Google's answer does not stay in the address").toBe("");
  });

  it("posts nothing when the answer's state is not this tab's, or the tab kept nothing", async () => {
    const spy = server({});
    sessionStorage.setItem(KEPT, JSON.stringify({ state: "state-of-this-tab-0001", nonce: "nonce-of-this-tab-0001", token: TOKEN }));
    comeBack("#state=somebody-elses-state&id_token=googles-signed-answer");
    expect(await screen.findByText(/Google sign-in did not finish/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your booking" }).getAttribute("href")).toBe(`/g/${TOKEN}`);
    cleanup();

    comeBack("#state=state-of-this-tab-0001&id_token=googles-signed-answer");   // nothing kept: a new tab
    expect(await screen.findByText(/Google sign-in did not finish/)).toBeTruthy();
    expect(spy, "nothing was posted").not.toHaveBeenCalled();
  });

  it("prints the door's refusal of another account, and stays shut", async () => {
    const refusal = "That Google account is not the one on this booking. "
      + "Use the email the booking was made with, or ask for a code.";
    server({ [`${OPEN}/google`]: () => { throw new apiModule.ApiError(401, refusal); } });
    sessionStorage.setItem(KEPT, JSON.stringify({ state: "state-of-this-tab-0001", nonce: "nonce-of-this-tab-0001", token: TOKEN }));
    comeBack("#state=state-of-this-tab-0001&id_token=somebody-elses-answer");

    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your booking" }).getAttribute("href")).toBe(`/g/${TOKEN}`);
    expect(localStorage.getItem(`guest-unlock:${TOKEN.slice(0, 12)}`)).toBeNull();
  });

  it("still offers Google where the server cannot send a code, and says why there is no code", async () => {
    const cannot = "Codes cannot be sent yet - sending is not set up on this server. Ask the desk.";
    server({ [OPEN]: () => ({ ...WITH_GOOGLE, canSendCodes: false, cannotSend: cannot }) });
    open();
    expect(await screen.findByRole("button", CONTINUE)).toBeTruthy();
    expect(screen.getByText(cannot)).toBeTruthy();
    expect(screen.queryByRole("button", ON_WHATSAPP)).toBeNull();
    expect(screen.queryByLabelText("The six digits")).toBeNull();
  });

  /* OCI-10's rule: nothing from outside is loaded onto the guest's page.
     Asked of the module's own source, so a script tag added later fails here. */
  it("has no code that adds a script to the page, or names Google's script", () => {
    const folder = join(process.cwd(), "src/modules/online-checkin");
    const files = (readdirSync(folder, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(join(folder, f), "utf8");
      expect(text, f).not.toMatch(/createElement\(\s*["']script["']/);
      expect(text, f).not.toContain("accounts.google.com/gsi");
    }
  });
});

describe("the unlock this phone holds (D21-6)", () => {
  const UNLOCK = "this-tab-only-unlock-0123456789abcdefghijk";

  /** A door that opens only with the unlock it handed back. */
  const door = () => ({
    [OPEN]: (init?: RequestInit) => ({ ...BOOKING, verified: unlockSent(init) === UNLOCK }),
    [`${OPEN}/code`]: () => SENT,
    [`${OPEN}/verify`]: () => ({ verified: true, unlock: UNLOCK }),
    [`${OPEN}/details`]: (init?: RequestInit) => {
      if (unlockSent(init) !== UNLOCK) throw new apiModule.ApiError(404, "no");
      return { sent: null };
    },
  });

  /* D27-169: a day, and closing the tab does not end it - the server ends
     it (162). So it is held where a new tab from WhatsApp finds it. */
  it("is kept on this phone past the tab, and carried on every call behind the code", async () => {
    const spy = server(door());
    open();
    await screen.findByText("A. Guest");

    fireEvent.change(screen.getByLabelText("The six digits"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my booking" }));
    expect(await screen.findByText("Verified on this phone")).toBeTruthy();

    expect(localStorage.getItem(`guest-unlock:${TOKEN.slice(0, 12)}`), "held for the day").toBe(UNLOCK);
    cleanup();
    open();
    expect(await screen.findByText("Verified on this phone"), "a new tab is still unlocked").toBeTruthy();

    await screen.findByLabelText("Your ID");
    const behind = spy.mock.calls.filter((c) => String(c[0]).endsWith("/details"));
    expect(behind.length).toBeGreaterThan(0);
    for (const call of behind) expect(unlockSent(call[1])).toBe(UNLOCK);
  });

  it("goes back to asking for the code when the door refuses it", async () => {
    localStorage.setItem(`guest-unlock:${TOKEN.slice(0, 12)}`, "an-unlock-that-has-expired");
    let opens = 0;
    server({
      /* The first open believes the tab; the door then refuses the
         details, and the page must ask again rather than show a fault. */
      [OPEN]: () => ({ ...BOOKING, verified: opens++ === 0 }),
      [`${OPEN}/details`]: () => { throw new apiModule.ApiError(404, "no"); },
    });
    open();

    expect(await screen.findByLabelText("The six digits")).toBeTruthy();
    expect(localStorage.getItem(`guest-unlock:${TOKEN.slice(0, 12)}`), "the dead unlock is dropped").toBeNull();
  });
});

describe("behind the code", () => {
  const UNLOCK = "unlocked-for-these-tests-0123456789abcdef";
  const unlocked = { ...BOOKING, verified: true };
  beforeEach(() => { localStorage.setItem(`guest-unlock:${TOKEN.slice(0, 12)}`, UNLOCK); });

  it("sends only the details the owner named, as a submission for the desk (D21-19)", async () => {
    let sent: Record<string, unknown> | null = null;
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: (init) => {
        if (init?.method === "POST") { sent = JSON.parse(String(init.body)); return { sent: true }; }
        return sent
          ? { sent: { status: "waiting", submittedAt: "2026-08-25T09:00:00Z", idType: "passport", idLastFour: "4567" } }
          : { sent: null };
      },
    });
    open();

    fireEvent.change(await screen.findByLabelText("Your ID"), { target: { value: "passport" } });
    /* A passport brings its own two dates and the visa - and nothing else. */
    expect(screen.getByLabelText("Passport expires")).toBeTruthy();
    expect(screen.getByLabelText("Visa expires")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("The number on it"), { target: { value: "Z1234567" } });
    fireEvent.change(screen.getByLabelText("Passport expires"), { target: { value: "2030-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Send my details" }));

    expect(await screen.findByText(/The desk will check them against your ID/)).toBeTruthy();
    const named = ["idType", "idNumber", "addressLine", "city", "country",
      "passportExpiry", "visaNumber", "visaExpiry"];
    expect(Object.keys(sent!).filter((k) => !named.includes(k)), "nothing else is asked").toEqual([]);
    expect(sent!.idType).toBe("passport");
    expect(screen.getByText("Passport ending 4567")).toBeTruthy();
  });

  /* D27-169: the arrival time and requests from everybody; Form III's
     person and visit from a foreign guest only - and a guest who filled
     them in, then chose Indian, sends none of them. A nationality not
     chosen is not sent, so one already on file is never overwritten. */
  it("sends Form III only for a foreign guest, and a nationality only when chosen", async () => {
    const sent: Record<string, unknown>[] = [];
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: (init) => {
        if (init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return { sent: true }; }
        return { sent: null };
      },
    });
    open();

    fireEvent.change(await screen.findByLabelText("Your ID"), { target: { value: "passport" } });
    fireEvent.change(screen.getByLabelText("The number on it"), { target: { value: "Z1234567" } });
    fireEvent.change(screen.getByLabelText("When do you expect to arrive?"), { target: { value: "14:30" } });
    fireEvent.change(screen.getByLabelText("Anything you would like us to know?"), { target: { value: "A quiet room" } });
    expect(screen.queryByLabelText("Purpose of the visit"), "no Form III until they say").toBeNull();

    fireEvent.change(screen.getByLabelText("Your nationality"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Which country?"), { target: { value: "Germany" } });
    fireEvent.change(screen.getByLabelText("Purpose of the visit"), { target: { value: "tourism" } });
    fireEvent.change(screen.getByLabelText("Arrived in India on"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Employed in India"), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "Send my details" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      nationality: "Germany", purpose: "tourism", arrivedInIndiaOn: "2026-08-20",
      employedInIndia: false, expectedArrival: "14:30", specialRequests: "A quiet room",
    });
    expect(sent[0], "remarks and the next destination stay with the desk")
      .not.toHaveProperty("nextDestination");
  });

  it("sends none of Form III once the guest says Indian", async () => {
    const sent: Record<string, unknown>[] = [];
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: (init) => {
        if (init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return { sent: true }; }
        return { sent: null };
      },
    });
    open();

    fireEvent.change(await screen.findByLabelText("Your ID"), { target: { value: "voter" } });
    fireEvent.change(screen.getByLabelText("The number on it"), { target: { value: "ABC1234567" } });
    fireEvent.change(screen.getByLabelText("Your nationality"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Purpose of the visit"), { target: { value: "business" } });
    fireEvent.change(screen.getByLabelText("Your nationality"), { target: { value: "IN" } });
    fireEvent.click(screen.getByRole("button", { name: "Send my details" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.nationality).toBe("IN");
    expect(sent[0]).not.toHaveProperty("purpose");
  });

  /* D25-39 (opt-in): the guest's own tick, off until they tick it. */
  it("sends the guest's yes to offers only when they tick it", async () => {
    const sent: Record<string, unknown>[] = [];
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: (init) => {
        if (init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return { sent: true }; }
        return { sent: null };
      },
    });
    open();

    fireEvent.change(await screen.findByLabelText("Your ID"), { target: { value: "voter" } });
    fireEvent.change(screen.getByLabelText("The number on it"), { target: { value: "ABC1234567" } });
    const tick = screen.getByRole("checkbox", { name: /Send me offers from/ });
    expect((tick as HTMLInputElement).checked).toBe(false);
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole("button", { name: "Send my details" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.offersAgreed).toBe(true);
  });

  /* D21-10: exactly the bill the desk prints. The page draws finance's own
     BillPrint from what the door sends, and asks for it with this tab's
     unlock like everything behind the code. */
  it("shows the desk's own bill, as an interim bill, and says where to pay", async () => {
    const BILL = {
      hotel: { name: "5 Elements Akkalkot", address: null, city: "Akkalkot", state: "Maharashtra",
        phone: null, gstin: null },
      stay: { reference: "FH-2609-5001", guest: "A. Guest", checkIn: "2026-08-25",
        checkOut: "2026-08-27", room: "204" },
      lines: [{ date: "2026-08-25", description: "Room charge", category: "room", amount: 1800,
        tax: 90, rate: 5, billTo: "guest", company: null }],
      taxes: [{ rate: 5, taxable: 1800, cgst: 45, sgst: 45 }],
      net: 1800, tax: 90, total: 1890, rounded: 1890, roundOff: 0, paid: 500, balance: 1390,
    };
    let billAsked: RequestInit | undefined;
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/bill`]: (init) => { billAsked = init; return BILL; },
    });
    open();

    const print = await waitFor(() => {
      const el = document.querySelector("[data-bill-print]");
      if (!el) throw new Error("no bill yet");
      return el as HTMLElement;
    });
    expect(print.textContent).toContain("Interim bill");
    expect(print.textContent, "not the final invoice").not.toContain("Tax Invoice");
    expect(print.textContent).toContain("Room charge");
    expect(print.textContent).toContain("Outstanding");
    expect(screen.getByText("Pay at the desk before you leave.")).toBeTruthy();
    expect(unlockSent(billAsked), "asked for with this tab's unlock").toBe(UNLOCK);
  });

  it("offers a spa or laundry request only where the hotel has one on (D21-63)", async () => {
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/requests`]: () => ({ offers: [], requests: [] }),
    });
    open();
    await screen.findByLabelText("Your ID");
    expect(screen.queryByRole("heading", { name: "Ask for something" })).toBeNull();
    cleanup();
    vi.restoreAllMocks();

    server({
      [OPEN]: () => ({ ...unlocked, offers: ["spa"] }),
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/requests`]: () => ({ offers: ["spa"], requests: [] }),
    });
    open();
    expect(await screen.findByRole("heading", { name: "Ask for something" })).toBeTruthy();
  });

  it("sends a message to the front desk, with this tab's unlock, where nothing else is offered (D23-14)", async () => {
    let sent: { body: unknown; unlock?: string } | null = null;
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/messages`]: () => ({ thread: [] }),
      [`${OPEN}/requests`]: (init) => {
        if (init?.method !== "POST") return { offers: [], requests: [] };
        sent = { body: JSON.parse(String(init.body)), unlock: unlockSent(init) };
        return { sent: true };
      },
    });
    open();

    fireEvent.change(await screen.findByLabelText("Your message"), { target: { value: "Two more towels, please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the front desk" }));
    expect(await screen.findByText("Sent. The front desk will see it.")).toBeTruthy();
    expect(sent).toEqual({ body: { kind: "desk", what: "Two more towels, please" }, unlock: UNLOCK });
  });

  /* The owner, 24 September: under the box, what they sent - each Sent or
     Handled, the day only, no staff names - from the door's own list of
     this stay's requests, asked with this tab's unlock. */
  it("lists the messages they sent, each Sent or Handled, the day only, none drawn as HTML", async () => {
    let listAsked: RequestInit | undefined;
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/requests`]: () => ({ offers: [], requests: [
        { kind: "spa", what: "A massage", wanted: "4pm", status: "open", createdAt: "2026-08-24T11:00:00Z" },
      ] }),
      [`${OPEN}/messages`]: (init) => {
        listAsked = init;
        return { thread: [
          { from: "you", what: "<b>Two more towels</b>", status: "open", at: "2026-08-25T10:00:00Z" },
          { from: "you", what: "A taxi at six", status: "done", at: "2026-08-24T10:00:00Z" },
        ] };
      },
    });
    open();

    const towels = (await screen.findByText("<b>Two more towels</b>")).closest("li")!;
    expect(towels.textContent).toBe("<b>Two more towels</b>25 Aug 2026Sent");
    expect(towels.querySelector("b"), "the guest's words are text, not HTML").toBeNull();
    expect(screen.getByText("A taxi at six").closest("li")!.textContent)
      .toBe("A taxi at six24 Aug 2026Handled");
    expect(screen.queryByText("A massage"), "a spa request is not a message").toBeNull();
    expect(unlockSent(listAsked), "asked with this tab's unlock").toBe(UNLOCK);
  });

  /* D27-224: the desk replies; the guest reads it as the front desk, never
     a person - the door sends no name, and the page draws none. */
  it("shows the desk's replies as the Front desk, in one thread with theirs, newest first", async () => {
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/requests`]: () => ({ offers: [], requests: [] }),
      [`${OPEN}/messages`]: () => ({ thread: [
        { from: "desk", what: "Yes, <i>on the roof</i>, 7 to 7.", at: "2026-08-25T11:00:00Z" },
        { from: "you", what: "Is there a pool?", status: "done", at: "2026-08-25T10:00:00Z" },
      ] }),
    });
    open();

    const answer = (await screen.findByText("Yes, <i>on the roof</i>, 7 to 7.")).closest("li")!;
    expect(answer.textContent).toBe("Front deskYes, <i>on the roof</i>, 7 to 7.25 Aug 2026");
    expect(answer.querySelector("i"), "the desk's words are text, not HTML").toBeNull();
    const items = [...answer.closest("ul")!.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Front deskYes, <i>on the roof</i>, 7 to 7.25 Aug 2026",
      "Is there a pool?25 Aug 2026Handled"]);
  });

  /* No WhatsApp "the desk replied" (the owner, D27-224): the page asks
     again every 30 seconds while it is open - and not while it is hidden. */
  it("reads the thread again every 30 seconds while the page is open, and not while it is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let asked = 0;
    server({
      [OPEN]: () => unlocked,
      [`${OPEN}/details`]: () => ({ sent: null }),
      [`${OPEN}/requests`]: () => ({ offers: [], requests: [] }),
      [`${OPEN}/messages`]: () => { asked += 1; return { thread: [] }; },
    });
    try {
      open();
      await waitFor(() => expect(asked).toBe(1));
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(asked, "read again after 30 seconds").toBe(2));

      focusManager.setFocused(false);   // the phone's screen is off, or another tab is in front
      await vi.advanceTimersByTimeAsync(90_000);
      expect(asked, "nothing asked while hidden").toBe(2);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });
});

describe("the privacy notice (D21-61)", () => {
  it("has its place before the first question, and shows nothing until its words are approved", async () => {
    server({ [OPEN]: () => BOOKING });
    open();
    await screen.findByLabelText("The six digits");
    expect(document.querySelector("[data-privacy-notice]"), "no words yet: nothing shown").toBeNull();
    cleanup();
    vi.restoreAllMocks();

    vi.spyOn(notice, "privacyNoticeFor").mockReturnValue({ heading: "Before you start", body: "Approved words." });
    server({ [OPEN]: () => BOOKING });
    open();
    const phone = await screen.findByLabelText("The six digits");
    const words = document.querySelector("[data-privacy-notice]")!;
    expect(words.textContent).toContain("Approved words.");
    expect(words.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the notice comes before the first question").toBeTruthy();
  });
});

describe("the desk's side", () => {
  it("confirms a guest's details through its own route, with one press", async () => {
    const spy = server({
      "/api/hotels/5EL/online-checkin": () => ({
        waiting: [{
          id: "sub-1", guest: "A. Guest", reference: "FH-2609-5001", idType: "aadhaar",
          idNumber: "…9012", passportExpiry: null, visaNumber: null, visaExpiry: null,
          addressLine: null, city: null, country: null, submittedAt: "2026-08-25T09:00:00Z",
          more: { expectedArrival: "14:30", nationality: "IN", specialRequests: "A quiet room" },
        }],
        requests: [], rooms: [],
      }),
      "/api/hotels/5EL/online-checkin/submissions/sub-1/confirm": () => ({ confirmed: true }),
    });
    open("/h/5EL/online-checkin", "/h/:code/online-checkin", <DeskPage />);

    /* The desk sees an Aadhaar as the server sent it: its last four. */
    expect(await screen.findByText("…9012")).toBeTruthy();
    /* D27-169: what else the guest sent, each under the question it answered. */
    expect(screen.getByText("Arriving at about")).toBeTruthy();
    expect(screen.getByText("14:30")).toBeTruthy();
    expect(screen.getByText("Nationality").nextElementSibling?.textContent).toBe("Indian");
    expect(screen.getByText("A quiet room").previousElementSibling?.textContent).toBe("Requests");
    fireEvent.click(screen.getByRole("button", { name: "Confirm against the ID" }));
    await waitFor(() => expect(spy.mock.calls.map((c) => c[0]))
      .toContain("/api/hotels/5EL/online-checkin/submissions/sub-1/confirm"));
  });

  /* D23-14, drawn inside Guest messages. */
  it("shows a guest's message as text, with the unread count, and marks it handled", async () => {
    signedIn();   // reception
    const MARK = "/api/hotels/5EL/online-checkin/requests/q-1";
    const spy = server({
      "/api/hotels/5EL/online-checkin/messages": () => ({
        messages: [{
          id: "q-1", what: "<img src=x onerror=alert(1)>Towels", createdAt: "2026-08-25T09:00:00Z",
          guest: "A. Guest", reference: "FH-2609-5001", handledBy: null, handledAt: null,
        }],
      }),
      [MARK]: () => ({ status: "done" }),
    });
    open("/", "/", <MessagesToTheDesk code="5EL" />);

    expect(await screen.findByText("1 unread")).toBeTruthy();
    expect(screen.getByText("<img src=x onerror=alert(1)>Towels")).toBeTruthy();
    expect(document.querySelector("img"), "a guest's words are never drawn as HTML").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark handled" }));
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === MARK)?.[1]?.body)
      .toBe(JSON.stringify({ status: "done" })));
  });

  /* D27-224: a booking's Guest messages has one reply box; the reply goes to
     the booking's own route, and the guest's words and the desk's are text. */
  it("replies to a booking's guest from its Guest messages, and shows who replied", async () => {
    signedIn();   // reception
    const REPLY = "/api/hotels/5EL/online-checkin/messages/r-1/reply";
    const spy = server({
      "/api/hotels/5EL/online-checkin/messages": () => ({
        messages: [{
          id: "q-1", what: "Is there a pool?", createdAt: "2026-08-25T09:00:00Z", guest: "A. Guest",
          reference: "FH-2609-5001", reservationId: "r-1", handledBy: null, handledAt: null,
        }],
        replies: [{ id: "d-1", what: "<b>Earlier</b> answer", sentAt: "2026-08-25T10:00:00Z", sentBy: "R. Clerk" }],
        canReply: true,
      }),
      [REPLY]: () => ({ reply: { id: "d-2", what: "On the roof", sentAt: "2026-08-25T11:00:00Z", sentBy: "R. Clerk" } }),
    });
    open("/", "/", <MessagesToTheDesk code="5EL" reservation="r-1" />);

    const earlier = (await screen.findByText("<b>Earlier</b> answer")).closest("li")!;
    expect(earlier.textContent).toContain("Reply from the front desk");
    expect(earlier.textContent).toContain("R. Clerk");
    expect(earlier.querySelector("b")).toBeNull();
    expect(screen.queryByRole("link", { name: "Reply" }), "already on the booking's own list").toBeNull();

    fireEvent.change(screen.getByLabelText("Reply to the guest"), { target: { value: "  On the roof  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === REPLY)?.[1]?.body)
      .toBe(JSON.stringify({ what: "On the roof" })));
  });

  it("offers no reply once the guest has checked out, and says why", async () => {
    signedIn();
    server({
      "/api/hotels/5EL/online-checkin/messages": () => ({
        messages: [{
          id: "q-1", what: "Thanks for everything", createdAt: "2026-08-25T09:00:00Z", guest: "A. Guest",
          reference: "FH-2609-5001", reservationId: "r-1", handledBy: null, handledAt: null,
        }],
        replies: [], canReply: false,
      }),
    });
    open("/", "/", <MessagesToTheDesk code="5EL" reservation="r-1" />);

    expect(await screen.findByText("This guest has checked out. Replies stop at check-out.")).toBeTruthy();
    expect(screen.queryByLabelText("Reply to the guest")).toBeNull();
  });

  it("points each unread message on the property's list to its booking, to reply there", async () => {
    signedIn();
    server({
      "/api/hotels/5EL/online-checkin/messages": () => ({
        messages: [{
          id: "q-1", what: "Late checkout?", createdAt: "2026-08-25T09:00:00Z", guest: "A. Guest",
          reference: "FH-2609-5001", reservationId: "r-1", handledBy: null, handledAt: null,
        }],
      }),
    });
    open("/", "/", <MessagesToTheDesk code="5EL" />);

    expect((await screen.findByRole("link", { name: "Reply" })).getAttribute("href"))
      .toBe("/h/5EL/guest-messages?reservation=r-1");
    expect(screen.queryByLabelText("Reply to the guest"), "the box is on the booking's list").toBeNull();
  });

  /* D21-62, D21-95. The card's QR must carry exactly the link the server
     made for that room - read back out of the picture on the sheet, module
     by module, and held against the QR of that link and of its neighbour. */
  it("prints each room's card with a QR code of exactly that card's link", async () => {
    const cards = [
      { room: "204", link: "https://pms.example.com/g/token-for-204" },
      { room: "205", link: "https://pms.example.com/g/token-for-205" },
    ];
    server({
      "/api/hotels/5EL/online-checkin": () => ({ waiting: [], requests: [], rooms: [] }),
      "/api/hotels/5EL/online-checkin/cards": () => ({ cards }),
    });
    open("/h/5EL/online-checkin", "/h/:code/online-checkin", <DeskPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Print cards for every room" }));
    fireEvent.click(await screen.findByRole("button", { name: "Print new cards" }));

    const drawn = modulesDrawn(
      (await screen.findByAltText("QR code for room 204")).getAttribute("src")!);
    expect(drawn).toEqual(modulesOf(cards[0]!.link));
    expect(drawn).not.toEqual(modulesOf(cards[1]!.link));
    expect(screen.queryByText(cards[0]!.link), "the owner: QR only, no link as text").toBeNull();
    expect((screen.getByRole("button", { name: "Print" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Print off, and says so, when the QR codes cannot be drawn", async () => {
    vi.doMock("qrcode", () => { throw new Error("offline"); });
    try {
      server({
        "/api/hotels/5EL/online-checkin": () => ({
          waiting: [], requests: [], rooms: [{ id: "r-1", number: "204", cardSince: null }],
        }),
        "/api/hotels/5EL/online-checkin/rooms/r-1/card": () => ({
          cards: [{ room: "204", link: "https://pms.example.com/g/token-for-204" }],
        }),
      });
      open("/h/5EL/online-checkin", "/h/:code/online-checkin", <DeskPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Print a card" }));

      /* The mocked import fails slowly on a loaded machine: wait for it. */
      expect(await screen.findByText(/The QR codes could not be drawn/, {}, { timeout: 5000 })).toBeTruthy();
      expect((screen.getByRole("button", { name: "Print" }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      vi.doUnmock("qrcode");
    }
  });

  /* The owner, 25 September: the check-in's ID step points to the desk's
     screen, in a new tab, only when THIS booking has details waiting. */
  it("points the check-in to Online check-in only when this booking's details wait", async () => {
    signedIn();   // reception
    /* Two bookings on one screen, one answer: only the booking whose
       details wait gets the line. */
    server({ "/api/hotels/5EL/online-checkin": () => ({
      waiting: [{
        id: "sub-1", guest: "A. Guest", reference: "FH-2609-5001", idType: "passport",
        idNumber: "P1234567", passportExpiry: null, visaNumber: null, visaExpiry: null,
        addressLine: null, city: null, country: null, submittedAt: "2026-08-25T09:00:00Z",
      }],
      requests: [], rooms: [],
    }) });
    open("/h/5EL/stays", "/h/:code/stays",
      <><WaitingDetailsLink reference="FH-2609-5001" /><WaitingDetailsLink reference="FH-2609-9999" /></>);
    const link = await screen.findByRole("link", { name: "check them on Online check-in" });
    expect(link.getAttribute("href")).toBe("/h/5EL/online-checkin");
    expect(link.getAttribute("target"), "the check-in in progress is not lost").toBe("_blank");
    expect(screen.getAllByRole("link"), "another booking's details are not this one's").toHaveLength(1);
  });

  it("draws nothing, and asks nothing, for a role that is not the desk's", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "hk@fidato.in", fullName: "HK",
      isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }],
    } });
    const spy = server({});
    open("/h/5EL/stays", "/h/:code/stays",
      <><MessagesToTheDesk code="5EL" /><WaitingDetailsLink reference="FH-2609-5001" /></>);
    await waitFor(() => expect(document.body.textContent).toBe(""));
    expect(spy).not.toHaveBeenCalled();
  });
});
