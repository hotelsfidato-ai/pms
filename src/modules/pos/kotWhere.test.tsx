import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DocketSlip } from "@/modules/pos/components/DocketSlip";
import { KOT_TODAY, type Docket } from "@/modules/pos/data/till";

/* The owner, 16 November: Restaurant and Bar number their tables alike, so
   a KOT saying only "Table No: 4" left the kitchen asking which. The slip
   prints the outlet and the table's section, whatever the design shows. */
const base: Docket = {
  kotNo: 3, orderNo: "20261116-3", table: "4", orderType: "dine_in", outlet: "Restaurant",
  hotel: "5 Elements", sentAt: "16/11/26 20:10",
  lines: [{ id: "l-1", parentId: null, name: "Veg Thali", qty: 1, note: null, isAddon: false }],
};
const where = () => document.querySelector("[data-kot-where]")?.textContent;
const off = { ...KOT_TODAY, show: { waiter: false, covers: false, time: false, kind: false, notes: false, orderNo: false } };

describe("the KOT says where the table is", () => {
  it("prints the outlet and the section, even with the design's lines off", () => {
    render(<DocketSlip d={{ ...base, section: "A/C" }} design={off} />);
    expect(where()).toBe("RESTAURANT · A/C");
  });

  it("tells the bar's table 4 from the restaurant's", () => {
    render(<DocketSlip d={{ ...base, outlet: "Bar", section: "Bar" }} />);
    expect(where()).toBe("BAR");
  });

  it("prints the outlet alone for an order on no table of the floor", () => {
    render(<DocketSlip d={{ ...base, table: "Room 204", orderType: "room_service", section: null }} />);
    expect(where()).toBe("RESTAURANT");
  });
});
