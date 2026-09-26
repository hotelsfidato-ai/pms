import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import { settleOrder, settleSplit, type CashId } from "@/modules/pos/data/till";
import { CashIdFields } from "@/modules/pos/components/CashIdFields";

/* D25-40 (Rule 159): on a bill above ₹1,00,000 the till asks for the PAN,
   Form 97 or "guest from abroad", and the settle sends what was given. The
   server's half is api/test/modules/pos/cashLimit.test.ts. */

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the PAN at the till", () => {
  it("is typed in capitals, with Form 97 and a guest from abroad as ticks", () => {
    let seen: CashId = {};
    function Harness() {
      const [v, setV] = useState<CashId>({});
      seen = v;
      return <CashIdFields value={v} onChange={setV} />;
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Guest's PAN"), { target: { value: "abcde1234f" } });
    fireEvent.click(screen.getByLabelText("No PAN: Form 97 taken"));
    fireEvent.click(screen.getByLabelText("Guest from abroad"));
    expect(seen).toEqual({ pan: "ABCDE1234F", form97: true, nonResident: true });
  });

  it("rides on the settle, one way or several", async () => {
    const bodies: unknown[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (_p: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true } as never;
    });
    await settleOrder("5EL", "o-1", "cash", undefined, undefined, { pan: "ABCDE1234F" });
    await settleSplit("5EL", "o-1", [{ method: "cash", amount: 150000 }], { form97: true });
    expect(bodies[0]).toMatchObject({ method: "cash", pan: "ABCDE1234F" });
    expect(bodies[1]).toMatchObject({ form97: true });
  });
});
