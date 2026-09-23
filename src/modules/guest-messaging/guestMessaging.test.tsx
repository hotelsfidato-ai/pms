import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   GUEST MESSAGES — what a PERSON is left looking at

   Never that a message went out (MEMORY 291). What is proved here:

     a read that failed says so, and NEVER "nothing has been sent"
     an empty list says WHICH empty it is - nothing sent, or nothing
       can be - because those are two completely different facts and
       only one of them is a thing to wait for
     the not-connected sentence is the SERVER'S, shown as it came
     nothing on this screen offers to send, at any moment, in any state
     a message the system sent by itself says so rather than reading blank
     a message about something that is not a booking reads "-", not 0
       and not an empty cell
     a booking no message can reach is listed, with what to add (MSG-3)

   ⚠ EVERY TEST USES ITS OWN PROPERTY CODE. The application's query cache
   lives as long as this file (App.tsx makes it once, staleTime Infinity),
   so two tests sharing a key means the second reads what the first cached
   and the controls above do nothing.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  list: "rows" as "rows" | "empty" | "unreachable",
  connected: false,
  nobodyToSendTo: false,
}));

const THE_SERVERS_SENTENCE =
  "Sending is not set up yet. Bills and vouchers print and download as usual; "
  + "nothing goes by WhatsApp or email until the workflow and its secret are "
  + "in the server's settings.";

vi.mock("@/modules/guest-messaging/data/guestMessages", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/guest-messaging/data/guestMessages")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");

  const message = (over: Record<string, unknown> = {}) => ({
    id: "m1", channel: "whatsapp",
    kind: "booking-confirmation", kindLabel: "Booking confirmation",
    to: { name: "Mr Sharma", phone: "+919876543210", email: null },
    about: { kind: "reservation", id: "r1", reference: "FH-2609-5001" },
    document: null,
    sentAt: "2026-09-19T06:00:00.000Z",
    status: "sent", detail: "The receiver took it (200).",
    sentBy: null, byAPerson: false,
    ...over,
  });

  return {
    ...actual,
    getGuestMessages: async () => {
      if (control.list === "unreachable") throw unreachable();
      return {
        connected: control.connected,
        notConnected: control.connected ? null : THE_SERVERS_SENTENCE,
        unreachable: control.nobodyToSendTo ? [
          { id: "r9", reference: "FH-2609-5009", guest: "Walk-in Guest",
            checkIn: "2026-09-30", why: "No telephone number and no email address" },
          { id: "r8", reference: "FH-2609-5008", guest: "Mr Rao",
            checkIn: "2026-10-02", why: "Not agreed to WhatsApp, and no email address" },
        ] : [],
        messages: control.list === "empty" ? [] : [
          message(),
          message({
            id: "m2", kind: "arrival-reminder", kindLabel: "Before arrival",
            status: "failed",
            detail: "The receiver did not answer within twenty seconds.",
          }),
          /* Migration 117 joins `about_id` loosely: a message can be about a
             purchase order, and this screen has to survive one. */
          message({
            id: "m3", channel: "email", kind: "bill", kindLabel: "Bill",
            to: { name: "Mr Sharma", phone: null, email: "sharma@example.com" },
            about: { kind: "purchase_order", id: "PO/2026/00017", reference: null },
            sentBy: "Test GM", byAPerson: true, detail: null,
          }),
          /* A person sent it, and this reader may not see WHICH person -
             `staff` is row-secured. It must not read as the system. */
          message({
            id: "m4", kind: "voucher", kindLabel: "Voucher",
            sentBy: null, byAPerson: true, detail: null,
          }),
        ],
      };
    },
  };
});

const as = (role: string) => signedIn({
  scope: {
    staffId: "55555555-5555-5555-5555-555555555555",
    email: "messages-test@fidato.in", fullName: "Messages Test", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

beforeEach(() => {
  startSignedIn();
  control.list = "rows";
  control.connected = false;
  control.nobodyToSendTo = false;
});

describe("guest messages", () => {
  it("says a read that failed did not load - never that nothing has been sent", async () => {
    as("front_desk");
    control.list = "unreachable";
    go("/h/GM1/guest-messages");
    render(<App />);

    expect(await screen.findByText("What was sent did not load")).toBeTruthy();
    expect(screen.queryByText(/Nothing has been sent/)).toBeNull();

    control.list = "empty";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText(/Nothing has been sent, because nothing can be yet/))
      .toBeTruthy();
    expect(screen.queryByText("What was sent did not load")).toBeNull();
  });

  /* ⚠ THE WHOLE POINT OF THE SCREEN. An empty list means one of two
     completely different things, and the desk needs to know which. */
  it("says an empty list is empty because nothing CAN be sent yet", async () => {
    as("front_desk");
    control.list = "empty";
    go("/h/GM2/guest-messages");
    render(<App />);

    expect(await screen.findByText(/Nothing has been sent, because nothing can be yet/))
      .toBeTruthy();
    expect(screen.getByText(/This is not a fault and nothing has failed/)).toBeTruthy();
    expect(screen.queryByText("Nothing has been sent yet")).toBeNull();
  });

  it("says an empty list is simply empty once the owner has connected n8n", async () => {
    as("front_desk");
    control.list = "empty";
    control.connected = true;
    go("/h/GM3/guest-messages");
    render(<App />);

    expect(await screen.findByText("Nothing has been sent yet")).toBeTruthy();
    expect(screen.queryByText(/because nothing can be yet/)).toBeNull();
    /* And no notice, because there is nothing to warn about. */
    expect(screen.queryByText(/Sending is not set up yet/)).toBeNull();
  });

  it("shows the SERVER's sentence for why nothing sends, not one of its own", async () => {
    as("gm");
    go("/h/GM4/guest-messages");
    render(<App />);

    /* Word for word: `NOT_CONNECTED` in api/src/sending.ts. One wording, so
       the desk reads the same thing wherever it meets this - a second
       sentence written on this screen would drift the first time either
       changed. */
    expect(await screen.findByText(new RegExp(THE_SERVERS_SENTENCE.slice(0, 40))))
      .toBeTruthy();
    expect(screen.getByText("Nothing is sent yet")).toBeTruthy();
  });

  /* ⚠ THE OWNER'S D18-12 AND D17-34: the bill after check-out stays a button
     the FRONT DESK presses, on the front desk's own screen. This one is the
     record and nothing else, in every state it can be in. */
  it("never offers to send anything, connected or not", async () => {
    as("gm");
    control.connected = true;
    go("/h/GM5/guest-messages");
    render(<App />);

    await screen.findByRole("table");
    for (const button of screen.queryAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/send|resend|whatsapp|email again/i);
    }
  });

  it("says the system sent it where nobody pressed anything", async () => {
    as("front_desk");
    control.connected = true;
    go("/h/GM6/guest-messages");
    render(<App />);

    /* IN THE TABLE. DataTable draws the same rows twice below `sm` - a table
       and a card list, one hidden by CSS the test browser does not apply - so
       a bare findByText finds two. */
    await screen.findByRole("table");
    const table = within(screen.getByRole("table"));
    const row = table.getByText("Booking confirmation").closest("tr") as HTMLElement;

    expect(within(row).getByText("The system")).toBeTruthy();
    expect(within(row).getByText("FH-2609-5001")).toBeTruthy();
    expect(within(row).getByText("Delivered to the sender")).toBeTruthy();
  });

  /* ⚠ FOUND BY OPENING THE SCREEN AS HOUSEKEEPING (19 September). `staff` is
     row-secured, so a reader who may not see a colleague gets no NAME for a
     message that colleague sent - and this column printed "The system" for
     it. "Was it us or was it automatic?" is the only question this column
     answers, and it was answering it wrongly. */
  it("does not call a person's message the system's, just because it cannot name them", async () => {
    as("front_desk");
    control.connected = true;
    go("/h/GM10/guest-messages");
    render(<App />);

    await screen.findByRole("table");
    const row = within(screen.getByRole("table"))
      .getByText("Voucher").closest("tr") as HTMLElement;

    expect(within(row).getByText("A member of staff")).toBeTruthy();
    expect(within(row).queryByText("The system")).toBeNull();
  });

  it("says plainly when one did not go, and what came back", async () => {
    as("front_desk");
    control.connected = true;
    go("/h/GM7/guest-messages");
    render(<App />);

    await screen.findByRole("table");
    const row = within(screen.getByRole("table"))
      .getByText("Before arrival").closest("tr") as HTMLElement;

    expect(within(row).getByText("Did not go")).toBeTruthy();
    expect(within(row).getByText(/did not answer within twenty seconds/)).toBeTruthy();
  });

  it("shows a message about something that is not a booking as a dash", async () => {
    as("gm");
    control.connected = true;
    go("/h/GM8/guest-messages");
    render(<App />);

    await screen.findByRole("table");
    const row = within(screen.getByRole("table"))
      .getByText("Bill").closest("tr") as HTMLElement;

    /* No reference, and no invented one. A dash (D17-49), never a zero and
       never an empty cell that reads as a fault. */
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
    /* An email went to the address, not to a blank telephone number. */
    expect(within(row).getByText("sharma@example.com")).toBeTruthy();
  });

  it("is refused to a role that cannot open bookings", async () => {
    as("chef");
    go("/h/GM9/guest-messages");
    render(<App />);

    expect(await screen.findByText(/not part of your role/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  /* ⚠ MSG-3. Nothing is recorded where nothing was attempted, so a booking
     the sweep cannot reach left no trace here at all - the desk could not
     know this guest will never get a confirmation. */
  it("lists the bookings no message can reach, and what to add", async () => {
    as("front_desk");
    control.nobodyToSendTo = true;
    go("/h/GM11/guest-messages");
    render(<App />);

    expect(await screen.findByText("2 bookings no message can reach")).toBeTruthy();
    const walkIn = screen.getByText("FH-2609-5009").closest("li") as HTMLElement;
    expect(within(walkIn).getByText("Walk-in Guest")).toBeTruthy();
    expect(within(walkIn).getByText("Arrives 30 Sep 2026")).toBeTruthy();
    expect(within(walkIn).getByText("No telephone number and no email address")).toBeTruthy();
    const rao = screen.getByText("FH-2609-5008").closest("li") as HTMLElement;
    expect(within(rao).getByText(/Not agreed to WhatsApp/)).toBeTruthy();
    /* And it offers nothing to press: this screen still never sends. */
    for (const button of screen.queryAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/send|resend|whatsapp|email again/i);
    }
  });

  it("says nothing about it when every booking can be reached", async () => {
    as("front_desk");
    go("/h/GM12/guest-messages");
    render(<App />);

    await screen.findByRole("table");
    expect(screen.queryByText(/no message can reach/)).toBeNull();
  });
});
