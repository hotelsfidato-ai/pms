import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getProperty, listRooms, listAllRooms, defaultPropertyId, queryKeys, BUSINESS_DATE } from "./index";
import { listStays, getStay, listArrivals, listInHouse, listDepartures } from "@/modules/front-desk";
import { getFolio, listOpenFolios } from "@/modules/finance";
import { listGroups, listGroupMembers } from "@/modules/reservations";
import { listDailyStatistics, getPeriodStatistics, getTodaySnapshot } from "@/modules/reports";

const OTHER_HOTEL = "some-other-property";

describe("the seam - scoping", () => {
  it("returns nothing for a hotel the user has no data for", async () => {
    expect(await getProperty(OTHER_HOTEL)).toBeNull();
    expect(await listRooms(OTHER_HOTEL)).toEqual([]);
    expect(await listAllRooms(OTHER_HOTEL)).toEqual([]);
    expect(await listStays(OTHER_HOTEL)).toEqual([]);
    expect(await listArrivals(OTHER_HOTEL)).toEqual([]);
    expect(await listInHouse(OTHER_HOTEL)).toEqual([]);
    expect(await listDepartures(OTHER_HOTEL)).toEqual([]);
    expect(await listOpenFolios(OTHER_HOTEL)).toEqual([]);
    expect(await listGroups(OTHER_HOTEL)).toEqual([]);
    expect(await listDailyStatistics(OTHER_HOTEL)).toEqual([]);
    expect(await getPeriodStatistics(OTHER_HOTEL)).toBeNull();
    expect(await getTodaySnapshot(OTHER_HOTEL)).toBeNull();
  });

  it("will not fetch one hotel's stay through another hotel's id", async () => {
    const id = (await defaultPropertyId());
    const mine = await listStays(id);
    expect(mine.length).toBeGreaterThan(0);
    expect(await getStay(OTHER_HOTEL, mine[0]!.id)).toBeNull();
    expect(await getFolio(OTHER_HOTEL, mine[0]!.id)).toBeNull();
  });

  it("never hands out a live reference to its own data", async () => {
    const id = await defaultPropertyId();
    const first = await listStays(id);
    first[0]!.guest = "MUTATED";
    const second = await listStays(id);
    expect(second[0]!.guest).not.toBe("MUTATED");
  });
});

describe("the seam - the front desk's lists", () => {
  it("pins the demo to the Night Audit's business date", () => {
    expect(BUSINESS_DATE).toBe("2026-08-25");
  });

  it("puts the day-use and the turnover departure in today's departures", async () => {
    const id = await defaultPropertyId();
    const out = await listDepartures(id);
    const ids = out.map((s) => s.id);
    expect(ids).toContain("stay-dayuse");
    expect(ids).toContain("stay-turn-out");
  });

  it("puts the turnover arrival in today's arrivals", async () => {
    const id = await defaultPropertyId();
    const ids = (await listArrivals(id)).map((s) => s.id);
    expect(ids).toContain("stay-turn-in");
  });

  /* In house is who has checked in (the owner's D17-10). A checked-in
     day-use guest is in the room, so they count; a guest still to arrive
     does not, whatever the dates say. */
  it("counts a checked-in day-use guest in house", async () => {
    const id = await defaultPropertyId();
    const ids = (await listInHouse(id)).map((s) => s.id);
    expect(ids).toContain("stay-dayuse");
  });

  it("never counts a guest who has not checked in", async () => {
    const id = await defaultPropertyId();
    const stays = await listInHouse(id);
    expect(stays.every((s) => s.status === "in-house" || s.status === "due-out")).toBe(true);
    expect(stays.map((s) => s.id)).not.toContain("stay-turn-in");
  });

  it("keeps the complimentary guest in house", async () => {
    const id = await defaultPropertyId();
    const ids = (await listInHouse(id)).map((s) => s.id);
    expect(ids).toContain("stay-comp");
  });

  it("surfaces the overpaid folio, negative balance first", async () => {
    const id = await defaultPropertyId();
    const open = await listOpenFolios(id);
    expect(open[0]!.balance).toBeLessThan(0);
    expect(open[0]!.stayId).toBe("stay-overpaid");
  });
});

describe("the seam - statistics reconcile to the Manager Report", () => {
  it("reports 431 available, 132 sold, 30.63% for the PTD window", async () => {
    const id = await defaultPropertyId();
    const s = (await getPeriodStatistics(id))!;
    expect(s.availableRoomNights).toBe(431);
    expect(s.roomsSold).toBe(132);
    expect(s.occupancyPct).toBeCloseTo(30.63, 1);
  });

  it("derives ADR and RevPAR that match the report", async () => {
    const id = await defaultPropertyId();
    const s = (await getPeriodStatistics(id))!;
    expect(s.adr).toBeCloseTo(3178.63, 0);
    expect(s.revpar).toBeCloseTo(973.5, 0);
  });
});

describe("the seam - group bookings", () => {
  it("returns three rooms on one reference", async () => {
    const id = await defaultPropertyId();
    /* "all", not the default. `listGroups` now answers "here and
       coming" unless asked otherwise — a wedding from March is history
       and a list that grows forever stops being read — and the fixture's
       group has departed. This test is about the seam carrying three
       rooms on one reference, not about which groups a desk sees on a
       Tuesday, so it says which it means. */
    const [group] = await listGroups(id, "all");
    if (!group) throw new Error("no group in fixture");
    const members = await listGroupMembers(id, group.id);
    expect(members).toHaveLength(3);
    expect(new Set(members.map((m) => m.reference)).size).toBe(1);
  });
});

describe("Rule 5 - hotelId in every query key", () => {
  it("carries the hotel id in every key that is hotel-scoped", () => {
    const hotelId = "hotel-under-test";
    const built: unknown[][] = [
      [...queryKeys.property(hotelId)],
      [...queryKeys.rooms(hotelId)],
      [...queryKeys.stays(hotelId)],
      [...queryKeys.stay(hotelId, "s1")],
      [...queryKeys.arrivals(hotelId, "2026-08-25")],
      [...queryKeys.inHouse(hotelId, "2026-08-25")],
      [...queryKeys.departures(hotelId, "2026-08-25")],
      [...queryKeys.folio(hotelId, "s1")],
      [...queryKeys.openFolios(hotelId)],
      [...queryKeys.groups(hotelId)],
      [...queryKeys.groupMembers(hotelId, "g1")],
      [...queryKeys.dailyStatistics(hotelId, "a", "b")],
      [...queryKeys.periodStatistics(hotelId, "a", "b")],
      [...queryKeys.todaySnapshot(hotelId, "2026-08-25")],
    ];
    for (const key of built) {
      expect(key, `key ${JSON.stringify(key)} omits hotelId`).toContain(hotelId);
    }
  });

  it("keeps the property list unscoped, because it is the thing that lists hotels", () => {
    expect([...queryKeys.properties()]).not.toContain("hotel-under-test");
  });
});

describe("Rule 2 - nothing outside the seam reaches for a fixture", () => {
  /* This is the rule that makes the backend swappable. It is worth a
     test rather than a comment, because it fails silently otherwise. */
  const SRC = join(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("has no import of @/data/fixtures outside src/data", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes(join("src", "data")))
      /* src/test/ is the transport stub, not a screen. It reads the
         fixtures ON PURPOSE — it stands in for the API and has to
         answer what the API answers. Narrow enough to stay honest:
         one directory, and no test file elsewhere is exempt. */
      .filter((f) => !f.includes(join("src", "test")))
      .filter((f) => /from\s+["'](@\/data\/fixtures|.*\.\.\/fixtures)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), ""));
    expect(offenders, `these files bypass the repositories: ${offenders.join(", ")}`)
      .toEqual([]);
  });
});

describe("Rule 2b - a function nobody calls is a capability nobody can reach", () => {
  /* ══════════════════════════════════════════════════════════════════
     THE GATE THIS PROJECT NEEDED SIX TIMES BEFORE IT EXISTED

     Every other test here calls a function directly. **None of them
     asks whether a person could ever cause that function to run**, and
     that gap has cost the same defect over and over:

       81   a credit note with every piece built and no path to it
       213  courses the pass grouped by and nothing could set
       214  a banquet switch hardcoded disabled beside stale copy
       216  a properties screen explaining why it could not add one
       217  and the other direction — a capability I reported MISSING
            because I searched by URL prefix instead of asking this
            question. `createStaff` had two callers the whole time.

     217 is the sharpest argument for it. The question below takes a
     second to answer and I spent an afternoon answering it wrongly by
     hand.

     ⚠ THE ALLOW-LIST IS A BACKLOG, NOT A PERMISSION. Twelve functions
     are exported and reached by nothing, all of them helpers overtaken
     by later screens.

     `setOutletClosed` was the fourteenth and the one that mattered: a
     real capability whose screen rendered the state it produced and
     offered no way to produce it. The floor can close its outlet now,
     so it came off. That is what this list is for — it shrinks, and
     the second test below fails if an entry gains a caller and stays.
     ══════════════════════════════════════════════════════════════════ */
  const SRC = join(process.cwd(), "src");

  /* ⚠ THE SEAM IS EVERY DATA FOLDER SINCE THE SERVICE-FOLDER MOVE (15 Sep).
     This read only src/data/repositories and counted only imports whose
     path said "data/repositories" — so when the services' data files moved
     to src/modules/<service>/data and the screens began importing them
     through each service's front door, the gate kept passing while checking
     almost nothing (MEMORY 272). The seam is the core's data folder plus
     every service's `data/`; a caller's import counts whether it names the
     index, a service's door or a service's data file. */
  const SEAM_DIRS = [
    join(SRC, "data", "repositories"),
    ...readdirSync(join(SRC, "modules"))
      .map((service) => join(SRC, "modules", service, "data"))
      .filter((dir) => existsSync(dir)),
  ];
  const inSeam = (file: string) => SEAM_DIRS.some((dir) => file.startsWith(dir));
  const seamFiles = () => SEAM_DIRS.flatMap((dir) => walk(dir));

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /* Known unreachable on 8 September 2026. Every line here is work
     somebody paid for that nobody can use. */
  const KNOWN_UNREACHABLE = [
    /* Superseded TODAY by the order pad, which opens the order in its
       batch send instead. Safe to delete. */
    "openOrderOnTable",
    /* Helpers overtaken by later screens. */
    /* ⚠ `getFolio` WAS ON THIS LIST AND DID NOT BELONG. `getFolioBalance`
       has called it all along, one module further into the seam. The
       shrink-only test below caught it the moment the gate learned to
       follow that edge — the list's first correction came from the
       gate, not from me re-reading it. */
    "addInclusion", "defaultPropertyId", "getAdminSettings",
    /* ⚠ `getTodaySnapshot` CAME OFF ON 9 SEPTEMBER. The property screen
       shows a hotel's own numbers, which is what it was written for —
       it had simply never had a screen. The gate noticed before I did:
       the shrink-only test failed the moment the caller appeared. */
    "getProperty", "listAssignableRoles",
    "listGroupMembers", "listRoles",
    "listSellableRooms", "listVacant", "windowFrom",
  ];

  const exported = () => {
    const names = new Set<string>();
    for (const file of seamFiles()) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const m of readFileSync(file, "utf8")
        .matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)) {
        names.add(m[1]!);
      }
    }
    return [...names];
  };

  /* ⚠ WHAT COUNTS AS A CALLER: AN IMPORT, NOT A MENTION.

     The first version of this gate searched the raw text of every file
     outside the seam. A COMMENT saying "setHousekeeping converts a
     successful queue into…" would have satisfied it — and `src/lib/
     api.ts` contains exactly that comment, twice. A dead function
     would have looked alive, which is the wrong direction for a guard
     to fail in. Caught before the gate was trusted, which four earlier
     guards in this project were not.

     Imports are the honest signal, and `noUnusedLocals` is why: an
     import nothing uses fails `tsc`, so an import that survives the
     typecheck is a use. Matching `name(` instead would have been
     worse, not better — `queryFn: listArrivals` passes a live function
     by reference and never writes a bracket after it. */
  const IMPORT_FROM_SEAM = String.raw`import\s*(?:type\s*)?\{([^}]*)\}` +
    String.raw`\s*from\s*["'][^"']*(?:data/repositories|modules/|\.\/|\.\.\/)`;

  const namesIn = (text: string, tail: string) => {
    const out: string[] = [];
    for (const m of text.matchAll(new RegExp(IMPORT_FROM_SEAM + tail, "g"))) {
      for (const part of m[1]!.split(",")) {
        const name = part.replace(/\btype\b/, "").split(" as ")[0]!.trim();
        if (name) out.push(name);
      }
    }
    return out;
  };

  /* ⚠ AND A FUNCTION CAN BE REACHED *THROUGH* THE SEAM. `markRoom` is
     what the housekeeping screen imports; `setHousekeeping` is what
     `markRoom` delegates to, and one write path is the whole reason it
     delegates. Stopping at the seam's edge reported it dead.

     So: start from what the outside imports, then follow imports
     BETWEEN seam modules — but only out of a module the outside has
     actually entered. A ring of dead functions importing each other
     never gets entered and stays reported. This is module-granular,
     which is its known limit: a dead function sitting in a file that
     is entered for some OTHER export rides in free. Narrowing that
     needs a call graph; say so rather than imply the gate is tighter
     than it is. */
  const reachableNames = () => {
    const within_ = seamFiles().filter((f) => !/\.test\.tsx?$/.test(f));

    const reachable = new Set<string>();
    for (const file of walk(SRC).filter((f) => !inSeam(f))) {
      for (const n of namesIn(readFileSync(file, "utf8"), String.raw`[^"']*["']`)) {
        reachable.add(n);
      }
    }

    const within = within_.map((file) => {
      const text = readFileSync(file, "utf8");
      return {
        exports: [...text.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)]
          .map((m) => m[1]!),
        imports: namesIn(text, String.raw`[^"']*["']`),
        entered: false,
      };
    });

    for (let settled = false; !settled; ) {
      settled = true;
      for (const mod of within) {
        if (mod.entered || !mod.exports.some((n) => reachable.has(n))) continue;
        mod.entered = true;
        settled = false;
        for (const n of mod.imports) reachable.add(n);
      }
    }
    return reachable;
  };

  it("every function on the seam is called by something", () => {
    const imported = reachableNames();
    const unreachable = exported()
      .filter((name) => !imported.has(name))
      .filter((name) => !KNOWN_UNREACHABLE.includes(name))
      .sort();

    expect(
      unreachable,
      "these exist and nothing can reach them - build the path, or delete "
      + `them: ${unreachable.join(", ")}`,
    ).toEqual([]);
  });

  it("the backlog of unreachable functions only shrinks", () => {
    const imported = reachableNames();
    /* Anything on the list that HAS gained a caller should come off it.
       Without this the list rots into a permanent excuse. */
    const nowReachable = KNOWN_UNREACHABLE.filter((n) => imported.has(n));

    expect(
      nowReachable,
      "these are reachable now - take them off KNOWN_UNREACHABLE: "
      + nowReachable.join(", "),
    ).toEqual([]);
  });
});
