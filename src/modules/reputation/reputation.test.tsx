import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   REVIEWS — the owner's D18-14

   What is proved here is what a PERSON is left looking at (MEMORY 291),
   and the first four are all the same rule seen from four sides:

     ⚠ THE LINK NOBODY HAS GIVEN reads as a DASH, never a zero-length
       string dressed up as a setting, never an example address, and
       never a placeholder in the box that somebody could copy out and
       send to a guest.
     WITH NO LINK, NO ROW OFFERS TO SEND. The screen does not draw a
       button and then apologise after the press.
     WITH NOTHING CONNECTED, the same - and the sentence at the top says
       why, in the server's own wording.
     NOT ASKED READS AS A DASH TOO, not "Pending": pending would say
       something is on its way when nothing is.

   And the two that are about the people rather than the link:

     somebody who may only LOOK sees the list and no buttons
     a way the booking has no address for is not offered

   The reads are switched per test; the write is a spy.

   ⚠ EVERY TEST USES ITS OWN PROPERTY CODE. The application's query cache
   lives as long as this file (App.tsx makes it once, staleTime Infinity),
   so two tests sharing a key means the second reads what the first cached
   and the controls above it do nothing.

   ⚠ AND EVERY ROW IS IN THE DOM TWICE. Since the mobile pass of 16
   September, DataTable draws a table AND a card list, and CSS shows one
   of them - so `getByText` on a row's own words finds two elements and
   throws. The plural queries below are not laziness: a row that appeared
   only once would mean the phone lost it.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  link: null as string | null,
  canSend: false,
  mayAsk: true,
  maySetLink: true,
  rows: "one" as "one" | "none" | "asked" | "failed" | "no-email",
  asked: [] as unknown[],
  saved: [] as unknown[],
}));

vi.mock("@/modules/reputation/data/reputation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/reputation/data/reputation")>();

  const guest = (over: Record<string, unknown> = {}) => ({
    id: "stay-1", reference: "FH-2609-0001",
    arrived: "2026-09-15", departed: "2026-09-17",
    guest: "Anita Deshmukh",
    phone: "+919876543210", email: "anita@example.com",
    askStatus: null, askChannel: null, askedAt: null, askDetail: null,
    ...over,
  });

  const ROWS: Record<string, unknown[]> = {
    one: [guest()],
    none: [],
    asked: [guest({
      askStatus: "sent", askChannel: "whatsapp",
      askedAt: "2026-09-18T10:30:00.000Z",
    })],
    failed: [guest({
      askStatus: "failed", askChannel: "email",
      askedAt: "2026-09-18T10:30:00.000Z",
      askDetail: "The receiver refused it (500).",
    })],
    "no-email": [guest({ email: null })],
  };

  return {
    ...actual,
    getReviews: async () => ({
      link: control.link,
      linkSetAt: control.link ? "2026-09-19T11:45" : null,
      linkSetBy: control.link ? "Group Owner" : null,
      maySetLink: control.maySetLink,
      mayAsk: control.mayAsk,
      canSend: control.canSend,
      notConnected: control.canSend ? null
        : "Sending is not set up yet. Bills and vouchers print and download as "
          + "usual; nothing goes by WhatsApp or email until the workflow and "
          + "its secret are in the server's settings.",
      daysBack: 30,
      departures: ROWS[control.rows] ?? ROWS["one"],
    }),
    askForReview: async (code: string, id: string, channel: string) => {
      control.asked.push({ code, id, channel });
      return { ok: true as const, id: "1" };
    },
    setReviewLink: async (code: string, url: string) => {
      control.saved.push({ code, url });
      return { ok: true as const, link: url === "" ? null : url };
    },
  };
});

const open = (code: string) => {
  go(`/h/${code}/reviews`);
  render(<App />);
};

beforeEach(() => {
  startSignedIn();
  control.link = null;
  control.canSend = false;
  control.mayAsk = true;
  control.maySetLink = true;
  control.rows = "one";
  control.asked = [];
  control.saved = [];
});

/** Reviews sits on the Guests permission, so reception can open it. */
const asOwner = () => signedIn({
  scope: {
    staffId: "22222222-2222-2222-2222-222222222222",
    email: "owner@fidato.in", fullName: "Group Owner", isGroupAdmin: true,
    hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }],
  },
});

describe("Reviews, before the owner has given the link", () => {
  it("shows a dash for the link, not an example address", async () => {
    open("RV1");
    expect(await screen.findByText("The review link")).toBeTruthy();

    expect(screen.getByText(/No review link has been set for this property/i))
      .toBeTruthy();
    /* The dash the whole rule exists for. */
    const shown = screen.getByText("This property sends:").parentElement!;
    expect(shown.textContent).toContain("-");
    expect(shown.textContent).not.toMatch(/https?:/);
  });

  it("puts no link-shaped placeholder in the box for somebody to copy", async () => {
    open("RV2");
    const box = await screen.findByLabelText(/Paste the link/i);
    /* An example in a placeholder is an example somebody will send. */
    expect(box.getAttribute("placeholder")).toBe("");
  });

  it("offers nobody a way to send while there is no link", async () => {
    control.canSend = true;
    open("RV3");
    expect(await screen.findAllByText("Anita Deshmukh")).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /WhatsApp/i })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^Email$/i })).toHaveLength(0);
  });

  it("shows a departure nobody asked as a dash, never as pending", async () => {
    open("RV4");
    expect(await screen.findAllByText("Anita Deshmukh")).toHaveLength(2);
    expect(screen.queryAllByText(/pending/i)).toHaveLength(0);
    /* The column is headed "Review asked"; the word on its own is the
       PILL, and there must be none of it. */
    expect(screen.queryAllByText("Asked")).toHaveLength(0);
  });
});

describe("Reviews, with a link but nothing connected", () => {
  beforeEach(() => { control.link = "https://g.page/r/whatever/review"; });

  it("says nothing sends yet, and offers no button", async () => {
    open("RV5");
    expect(await screen.findByText(/Sending is not set up yet/i)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /WhatsApp/i })).toHaveLength(0);
  });

  it("still shows the link that is set, and who set it", async () => {
    open("RV6");
    expect(await screen.findByText("https://g.page/r/whatever/review"))
      .toBeTruthy();
    expect(screen.getByText(/Set by Group Owner/i)).toBeTruthy();
  });
});

describe("Reviews, connected and with a link", () => {
  beforeEach(() => {
    control.link = "https://g.page/r/whatever/review";
    control.canSend = true;
  });

  it("asks one guest, by the way the person picked", async () => {
    open("RV7");
    fireEvent.click((await screen.findAllByRole("button", { name: /WhatsApp/i }))[0]!);
    expect(control.asked).toEqual([
      { code: "RV7", id: "stay-1", channel: "whatsapp" },
    ]);
  });

  it("does not offer a way the booking has no address for", async () => {
    control.rows = "no-email";
    open("RV8");
    const whatsapp = (await screen.findAllByRole("button", { name: /WhatsApp/i }))[0]!;
    expect((whatsapp as HTMLButtonElement).disabled).toBe(false);
    const email = screen.getAllByRole("button", { name: /^Email$/i })[0]!;
    expect((email as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a guest who has been asked, and when", async () => {
    control.rows = "asked";
    open("RV9");
    /* Twice: the table's row and the phone's card. */
    expect(await screen.findAllByText("Asked")).toHaveLength(2);
  });

  it("says plainly when an ask did not go, and what the receiver said", async () => {
    control.rows = "failed";
    open("RVA");
    expect(await screen.findAllByText("Did not go")).toHaveLength(2);
    expect(screen.getAllByText(/The receiver refused it \(500\)/)).toHaveLength(2);
  });

  it("does not offer a send to somebody who may only look", async () => {
    control.mayAsk = false;
    open("RVB");
    expect(await screen.findAllByText("Anita Deshmukh")).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /WhatsApp/i })).toHaveLength(0);
  });
});

describe("the link itself", () => {
  it("is saved by somebody who may, and can be cleared back to nothing", async () => {
    asOwner();
    control.link = "https://g.page/r/whatever/review";
    open("RVC");

    fireEvent.click(await screen.findByRole("button", { name: /Clear it/i }));
    expect(control.saved).toEqual([{ code: "RVC", url: "" }]);
  });

  it("tells somebody who may not set it who to ask, and gives them no box", async () => {
    control.maySetLink = false;
    open("RVD");
    expect(await screen.findByText(/for the owner or an administrator/i))
      .toBeTruthy();
    expect(screen.queryByLabelText(/Paste the link/i)).toBeNull();
  });
});

describe("what came back", () => {
  it("says nothing is pulled in, where somebody would go looking for it", async () => {
    open("RVE");
    expect(await screen.findByText("What guests wrote")).toBeTruthy();
    expect(screen.getByText(/are not read into this system/i)).toBeTruthy();
  });
});

describe("an empty list", () => {
  it("says nobody has left, rather than showing an empty table", async () => {
    control.rows = "none";
    open("RVF");
    expect(await screen.findByText(/Nobody has left in the last 30 days/i))
      .toBeTruthy();
  });
});
