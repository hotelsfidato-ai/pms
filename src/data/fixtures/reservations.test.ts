import { describe, it, expect } from "vitest";
import { stays, folios, groups, occupancyFromStays } from "./reservations";
import { nightsSoldPerDay, roomInventory } from "./property";

/* Importing the module executes its divergence assertion. These tests
   then check the things the assertion does not: the awkward cases that
   break layouts, and that no room is ever double-booked. */

const byId = (id: string) => stays.find((s) => s.id === id)!;
const folioFor = (id: string) => folios.find((f) => f.stayId === id)!;
const dayOf = (iso: string) =>
  iso.startsWith("2026-09") ? 31 + Number(iso.slice(-2)) : Number(iso.slice(-2));

describe("reservations — integrity", () => {
  it("gives every stay a folio", () => {
    for (const s of stays) {
      expect(folios.find((f) => f.stayId === s.id), `no folio for ${s.id}`).toBeDefined();
    }
  });

  it("only assigns rooms that exist", () => {
    const numbers = new Set(roomInventory.map((r) => r.number));
    for (const s of stays) expect(numbers.has(s.roomNumber)).toBe(true);
  });

  it("never double-books a room", () => {
    const live = stays.filter((s) => s.status !== "cancelled" && !s.isDayUse);
    for (const a of live) {
      for (const b of live) {
        if (a === b || a.roomNumber !== b.roomNumber) continue;
        const overlap =
          dayOf(a.arrival) < dayOf(b.departure) && dayOf(b.arrival) < dayOf(a.departure);
        expect(overlap, `${a.id} and ${b.id} overlap in room ${a.roomNumber}`).toBe(false);
      }
    }
  });

  it("reproduces the calibrated occupancy exactly", () => {
    const derived = occupancyFromStays();
    for (const [date, expected] of Object.entries(nightsSoldPerDay)) {
      expect(derived[date] ?? 0, `occupancy on ${date}`).toBe(expected);
    }
  });
});

describe("reservations — the awkward cases", () => {
  it("has an overpaid folio with a negative balance", () => {
    const f = folioFor("stay-overpaid");
    expect(f.balance).toBeLessThan(0);
    expect(f.balance).toBe(-784);
  });

  it("has a complimentary room at zero tariff", () => {
    const s = byId("stay-comp");
    expect(s.isComplimentary).toBe(true);
    expect(s.offeredTariff).toBe(0);
    expect(s.rackTariff).toBeGreaterThan(0);
    expect(folioFor("stay-comp").roomCharges).toBe(0);
  });

  it("has a day-use booking with zero nights", () => {
    const s = byId("stay-dayuse");
    expect(s.isDayUse).toBe(true);
    expect(s.nights).toBe(0);
    expect(s.arrival).toBe(s.departure);
  });

  it("has a back-to-back turnover on one room", () => {
    const out = byId("stay-turn-out");
    const inn = byId("stay-turn-in");
    expect(out.roomNumber).toBe(inn.roomNumber);
    expect(out.departure).toBe(inn.arrival);
    expect(out.guest).not.toBe(inn.guest);
  });

  it("has a group booking across several rooms on one reference", () => {
    const group = groups[0]!;
    const members = stays.filter((s) => s.groupId === group.id);
    expect(members.length).toBe(group.rooms);
    expect(new Set(members.map((s) => s.reference)).size).toBe(1);
    expect(new Set(members.map((s) => s.roomNumber)).size).toBe(group.rooms);
  });

  it("has a stay crossing the month boundary", () => {
    const s = byId("stay-crossmonth");
    expect(s.arrival.startsWith("2026-08")).toBe(true);
    expect(s.departure.startsWith("2026-09")).toBe(true);
  });

  it("has a cancelled stay that releases its room", () => {
    const s = byId("stay-cancelled");
    expect(s.status).toBe("cancelled");
    expect(folioFor("stay-cancelled").status).toBe("written-off");
  });

  it("has a disputed folio", () => {
    expect(folios.some((f) => f.status === "disputed")).toBe(true);
  });

  it("books through every OTA the city ledger lists", () => {
    const sources = new Set(stays.map((s) => s.source));
    for (const ota of ["Agoda", "Booking.com", "Expedia", "go-MMT"]) {
      expect(sources.has(ota as never), `no booking from ${ota}`).toBe(true);
    }
  });
});
