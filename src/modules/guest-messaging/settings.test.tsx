import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { SendInvoice } from "@/modules/guest-messaging";
import MessageSwitches from "@/modules/guest-messaging/pages/MessageSwitches";
import DailyReportEmails from "@/modules/guest-messaging/pages/DailyReportEmails";

/* Settings → Messages (D27-252, D27-261, D27-264, D27-280): the switches, the
   daily report emails, and Send invoice. The server decides; these
   say each screen sends exactly what was chosen, to its own route. */

type Answer = (init?: RequestInit) => unknown;
function serve(routes: Record<string, Answer>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = routes[url];
    if (!answer) throw new apiModule.ApiError(500, `called ${url}`);
    return answer(init) as never;
  });
}
const mount = (node: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};
const bodyOf = (spy: ReturnType<typeof serve>, url: string) =>
  JSON.parse(String(spy.mock.calls.find((c) => c[0] === url)?.[1]?.body ?? "null"));

const SWITCHES = "/api/hotels/5EL/guest-message-settings";
const switches = {
  messages: [
    { kind: "booking-voucher", label: "Booking voucher", when: "Once, when confirmed.", isOn: true, changedBy: null, changedAt: null },
    { kind: "invoice", label: "Tax invoice", when: "When issued.", isOn: false, switchedOnAt: null, changedBy: null, changedAt: null },
    { kind: "review", label: "Review request", when: "When a clerk asks.", isOn: true, changedBy: null, changedAt: null },
  ],
  catchUp: { from: "09:00", until: "21:00" },
};

beforeEach(() => { useUi.setState({ hotelId: "5EL" }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Guest messages on/off", () => {
  it("switches one message for this hotel through its own route", async () => {
    const spy = serve({ [SWITCHES]: () => switches, [`${SWITCHES}/invoice`]: () => ({ ok: true }) });
    mount(<MessageSwitches />);
    const row = (await screen.findByText("Tax invoice", { selector: "p" })).closest("li")!;
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => expect(bodyOf(spy, `${SWITCHES}/invoice`)).toEqual({ isOn: true }));
    expect(spy.mock.calls.find((c) => c[0] === `${SWITCHES}/invoice`)?.[1]?.method).toBe("PUT");
    expect(screen.getByText(/only from 09:00 to 21:00/)).toBeTruthy();
  });
});

describe("Daily report emails (D27-280)", () => {
  const URL = "/api/hotels/5EL/report-emails";
  const report = (key: string, title: string, isOn: boolean, addresses: string[] = []) =>
    ({ key, title, contains: `What the ${title} holds.`, isOn, addresses, changedBy: null, changedAt: null });

  it("saves each report's switch and its own typed addresses, all four at once", async () => {
    const spy = serve({
      [URL]: (init) => (init?.method === "PUT" ? { ok: true } : {
        reports: [
          report("night-audit", "Night audit report", true),
          report("manager", "Manager report", false),
          report("money-owed", "Money owed", false, ["accounts@example.com"]),
          report("restaurant-stock", "Restaurant and stock", false),
        ],
        notConnected: null,
      }),
    });
    mount(<DailyReportEmails />);
    const audit = await screen.findByLabelText("Send the Night audit report to");
    expect(screen.getByText("On, but nobody gets it until an address is typed.")).toBeTruthy();
    fireEvent.change(audit, { target: { value: "owner@example.com\ngm@example.com, " } });
    const manager = screen.getByText("Manager report", { selector: "p" }).closest("li")!;
    fireEvent.click(within(manager).getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Send the Manager report to"), { target: { value: "owner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(spy.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(true));
    const put = spy.mock.calls.find((c) => c[1]?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ reports: [
      { key: "night-audit", isOn: true, addresses: ["owner@example.com", "gm@example.com"] },
      { key: "manager", isOn: true, addresses: ["owner@example.com"] },
      { key: "money-owed", isOn: false, addresses: ["accounts@example.com"] },
      { key: "restaurant-stock", isOn: false, addresses: [] },
    ] });
  });

  it("says so, in the sender's words, where nothing can be sent yet", async () => {
    serve({ [URL]: () => ({ reports: [report("night-audit", "Night audit report", true)], notConnected: "Sending is not set up yet." }) });
    mount(<DailyReportEmails />);
    expect(await screen.findByText("Sending is not set up yet.", { exact: false })).toBeTruthy();
  });
});

describe("Send invoice", () => {
  const READ = "/api/hotels/5EL/guest-messages";
  const SEND = "/api/hotels/5EL/invoices/5EL/2026-27/0001/send";
  it("is off, in the sender's words, where nothing can send; else one POST to the invoice's route", async () => {
    let connected = false;
    const spy = serve({
      [READ]: () => ({ connected, notConnected: connected ? null : "Sending is not set up yet.", messages: [], unreachable: [] }),
      [SEND]: () => ({ ok: true }),
    });
    mount(<SendInvoice hotelId="5EL" number="5EL/2026-27/0001" />);
    expect(await screen.findByText("Sending is not set up yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Send invoice/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    connected = true;
    mount(<SendInvoice hotelId="5EL" number="5EL/2026-27/0001" />);
    const button = await screen.findByRole("button", { name: /Send invoice/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === SEND)?.[1]?.method).toBe("POST"));
  });
});
