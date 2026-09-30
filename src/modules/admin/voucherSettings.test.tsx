import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import { GroupCard } from "./components/GroupCard";
import { BankDetailsCard, HousePoliciesCard } from "./components/VoucherSettings";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE BOOKING VOUCHER PRINTS, SET IN SETTINGS (D27-215, D27-216)

   The hotel's bank details and house policies, and the group's office
   details. Each screen sends what was typed and shows the server's own
   sentence; nothing here decides what a valid IFSC is.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
const sent: { path: string; method: string; body: unknown }[] = [];
const BANK = {
  accountName: "Test Hotels Private Limited", accountNumber: "000011112222", bankName: "Test Bank",
  branch: null, ifsc: "TEST0001234", upi: null, changedAt: "2026-10-01T10:00:00+05:30", changedBy: "Test GM",
};

/** GETs answered by path; every write recorded and answered \`{ ok: true }\`. */
function serve(reads: Record<string, () => unknown>) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true } as never;
    }
    const answer = reads[path.split("?")[0]!];
    if (!answer) return new Promise(() => {}) as never;
    return answer() as never;
  });
}

const as = (role: "gm" | "group-admin") => signedIn({ scope: {
  staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
  isGroupAdmin: role === "group-admin", hotels: role === "group-admin" ? [] : [{ hotelId: AGRA_HOTEL, role }],
} });

const wrap = (node: ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>,
);
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => { startSignedIn(); sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a hotel's bank details on Settings", () => {
  it("says none is set, and sends what is typed - the IFSC in capitals as it is typed", async () => {
    as("gm");
    serve({ "/api/hotels/AGR/bank-details": () => ({ bank: null }) });
    wrap(<BankDetailsCard hotelCode="AGR" />);
    expect(await screen.findByText("None set.")).toBeTruthy();
    /* Said before anything is pressed: the group's owner hears of a change. */
    expect(screen.getByText(/The group's owner is told whenever they change/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Set bank details" }));
    type(/^Account name/, "Test Hotels Private Limited");
    type(/^Account number/, "0000 1111 2222");
    type(/^Bank\*?$/, "Test Bank");
    type(/^IFSC/, "test0001234");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{
      path: "/api/hotels/AGR/bank-details", method: "PUT",
      body: { accountName: "Test Hotels Private Limited", accountNumber: "0000 1111 2222",
        bankName: "Test Bank", branch: "", ifsc: "TEST0001234", upi: "" },
    }]));
  });

  it("shows what is set, a dash for what is not, and who changed it; Remove takes it away", async () => {
    as("gm");
    serve({ "/api/hotels/AGR/bank-details": () => ({ bank: BANK }) });
    wrap(<BankDetailsCard hotelCode="AGR" />);
    const value = async (label: string) =>
      (await screen.findByText(label)).parentElement!.lastElementChild!.textContent;
    expect(await value("Account no.")).toBe("000011112222");
    expect(await value("IFSC")).toBe("TEST0001234");
    expect(await value("Branch")).toBe("-");
    expect(await value("UPI ID")).toBe("-");
    expect(screen.getByText(/Last changed by Test GM on /)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/bank-details", method: "DELETE", body: undefined },
    ]));
  });

  it("offers nothing to set where the server refuses the read", async () => {
    as("gm");
    serve({ "/api/hotels/AGR/bank-details": () => { throw new ApiError(403, "Refused"); } });
    wrap(<BankDetailsCard hotelCode="AGR" />);
    await waitFor(() => expect(vi.mocked(apiModule.api)).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Set bank details|Change/ })).toBeNull());
    expect(screen.queryByText("None set.")).toBeNull();
  });
});

describe("a hotel's house policies on Settings", () => {
  it("lists them in order, and saves the box a line a policy", async () => {
    as("gm");
    serve({});
    const saved = vi.fn();
    wrap(<HousePoliciesCard hotelCode="AGR" policies={["Pets are welcome.", "No smoking in the rooms."]} onSaved={saved} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent))
      .toEqual(["Pets are welcome.", "No smoking in the rooms."]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText(/^Policies/) as HTMLTextAreaElement;
    expect(box.value).toBe("Pets are welcome.\nNo smoking in the rooms.");
    fireEvent.change(box, { target: { value: "No smoking in the rooms.\nPets are welcome.\nQuiet after 10 pm." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{
      path: "/api/admin/hotels/AGR", method: "PATCH",
      body: { housePolicies: ["No smoking in the rooms.", "Pets are welcome.", "Quiet after 10 pm."] },
    }]));
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it("says so when there are none", () => {
    as("gm");
    serve({});
    wrap(<HousePoliciesCard hotelCode="AGR" policies={[]} onSaved={() => {}} />);
    expect(screen.getByText(/^None\. The voucher prints the booking's terms and the times only\./)).toBeTruthy();
  });
});

describe("the group's office details on Settings", () => {
  const NONE = { address: null, phone: null, email: null, website: null, gstin: null, instagram: null };

  it("shows a dash for each until typed, and sends all six - a blank one is left out of the voucher", async () => {
    as("gm");
    serve({ "/api/hotels/AGR/group": () => ({ name: "Test Group", logo: null, hotelLogo: null,
      office: { ...NONE, phone: "+91 20 0000 0000" } }) });
    wrap(<GroupCard hotelCode="AGR" />);
    const row = async (label: string) =>
      (await screen.findByText(label)).parentElement!.lastElementChild!.textContent;
    expect(await row("Office address")).toBe("-");
    expect(await row("Phone")).toBe("+91 20 0000 0000");

    fireEvent.click(screen.getByRole("button", { name: "Change office details" }));
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/^Office address/), { target: { value: "1 Office Road, Pune" } });
    fireEvent.change(form.getByLabelText(/^GSTIN/), { target: { value: "27aaaaa0000a1z5" } });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{
      path: "/api/hotels/AGR/group/office", method: "PUT",
      body: { address: "1 Office Road, Pune", phone: "+91 20 0000 0000", email: "", website: "",
        gstin: "27AAAAA0000A1Z5", instagram: "" },
    }]));
  });
});

/* D27-216: the bell's link names the hotel whose bank details changed, and
   Settings opens for THAT hotel whichever one was open. */
describe("Settings, opened for a named hotel", () => {
  it("reads that hotel's bank details, on the tab the address names", async () => {
    as("group-admin");
    serve({ "/api/hotels/AGR/bank-details": () => ({ bank: BANK }) });
    go("/h/AGR/settings/taxes-and-billing");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect((await screen.findByRole("tab", { name: "Taxes and billing" })).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(vi.mocked(apiModule.api).mock.calls.map(([path]) => path))
      .toContain("/api/hotels/AGR/bank-details"));
    expect(await screen.findByText("TEST0001234")).toBeTruthy();
  });
});
