import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { READ_RULES } from "../src/roleGate.ts";
import { REPORT_EXPORTERS } from "../src/routes/reportFiles.ts";
import { LIST_SCREENS, exportRefusal, maskId } from "../src/modules/reports/listExports.ts";
import { ROLES } from "../src/permissions.ts";
import { OWN_READERS } from "../src/modules/reports/listFiles.ts";
import { SEE as DEPOSIT_SEE } from "../src/modules/finance/deposits.ts";
import { DESK, teamsFor } from "../src/modules/guest-services/requests.ts";
import { LOST_LOGGERS } from "../src/modules/guest-services/wakeAndLost.ts";
import { VIEW_ROLES as MESSAGE_VIEW } from "../src/modules/guest-messaging/messages.ts";
import { VIEW_ROLES as REVIEW_VIEW } from "../src/modules/reputation/reputation.ts";
import { FEEDBACK_ROLES } from "../src/modules/reputation/feedbackRoles.ts";
import { DESK_ROLES } from "../src/routes/guestDoorKit.ts";
import { STOCK_ROLES } from "../src/modules/stores/stockGrants.ts";
import { VIEW_ROLES as PURCHASING_VIEW } from "../src/modules/purchasing/purchasingGrants.ts";
import { SPA_READ_ROLES } from "../src/modules/spa/spa.ts";
import { EQUIPMENT_GRANTS } from "../src/modules/equipment/grants.ts";
import { ADMIN_READ_ROLES } from "../src/modules/admin/grants.ts";

/* ══════════════════════════════════════════════════════════════════
   A LIST SCREEN AS A FILE (D27-383 item 1) - listFiles.ts

   The refusals, seen: a role without the reports' download right is
   refused a list of money or guests and given an ordinary list; another
   hotel's address is no such property; a role the screen's read rule
   refuses is refused. The file holds exactly the rows sent, a missing
   figure as "-", money as a number, an ID number masked.
   The people this file adds are taken away in afterAll (MEMORY 476).
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "LISTFILESTEST";
const uid = {
  gm: "test-uid-listfiles-gm", front_desk: "test-uid-listfiles-front_desk",
  housekeeping: "test-uid-listfiles-housekeeping", pune: "test-uid-listfiles-pune",
};

beforeAll(async () => {
  const hotel = async (code: string) => (await sql("select id::text from hotels where code = $1", [code])).rows[0].id;
  const at: Record<keyof typeof uid, [string, string]> = {
    gm: ["5EL", "gm"], front_desk: ["5EL", "front_desk"], housekeeping: ["5EL", "housekeeping"],
    /* A GM - of another hotel. */
    pune: [(await sql("select code from hotels where code <> '5EL' and test_of is null order by code limit 1")).rows[0].code, "gm"],
  };
  for (const [who, firebaseUid] of Object.entries(uid) as Array<[keyof typeof uid, string]>) {
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true, firebase_uid = excluded.firebase_uid
       returning id::text`,
      [`listfiles-${who}@fidato.in`, `${TAG} ${who}`, firebaseUid]);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
      [rows[0].id, await hotel(at[who][0]), at[who][1]]);
  }
});

afterAll(async () => {
  const uids = Object.values(uid);
  await sql(`delete from staff_hotels where staff_id in (select id from staff where firebase_uid = any($1))`, [uids]);
  await sql("delete from staff where firebase_uid = any($1)", [uids]).catch(() =>
    sql("update staff set is_active = false where firebase_uid = any($1)", [uids]));
  await closePool();
});

const post = (who: string, file: string, body: unknown) =>
  app.request(`/api/hotels/5EL/exports/${file}`, {
    method: "POST", headers: { "x-dev-staff-id": who, "content-type": "application/json" }, body: JSON.stringify(body),
  });

/* What a filtered screen sends: two of its rows, not the rest. */
const shown = {
  columns: [
    { label: "Guest", kind: "text" }, { label: "Passport number", kind: "text" },
    { label: "Arrival", kind: "date" }, { label: "Balance", kind: "money" },
  ],
  rows: [["Asha Rao", "Z1234567", "2026-08-25", 1500.5], ["Ben Ito", null, "2026-08-26", null]],
  facts: [{ label: "Search", value: "a" }],
};

const sheetValues = async (res: Response) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await res.arrayBuffer());
  const values: unknown[] = [];
  book.worksheets[0]!.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
};

describe("which screens, and who", () => {
  it("names a real read rule for every screen, and asks an `own` rule's own role list", () => {
    for (const [key, s] of Object.entries(LIST_SCREENS)) {
      const rule = READ_RULES[s.read];
      expect(rule, key).toBeDefined();
      if (rule!.kind === "own") {
        const roles = OWN_READERS[key as keyof typeof LIST_SCREENS];
        expect(roles?.length, `${key}: an own read rule needs its OWN_READERS line`).toBeGreaterThan(0);
        for (const r of roles!) expect(ROLES, `${key}: ${r}`).toContain(r);
      }
    }
  });

  it("gives every screen a title Excel takes as a sheet's name", () => {
    /* Excel refuses : \ / ? * [ ] in a sheet's name: a 500 on Marketing, seen 12 November. */
    for (const [key, s] of Object.entries(LIST_SCREENS)) expect(s.title, key).toMatch(/^[^:\\/?*[\]]+$/);
  });

  it("holds each own screen's role list equal to the list its route asks", () => {
    const same = (key: keyof typeof OWN_READERS, original: readonly string[]) =>
      expect([...OWN_READERS[key]!].sort(), key).toEqual([...original].sort());
    same("cash-deposits", DEPOSIT_SEE);
    same("wake-up-calls", DESK);
    same("lost-property", LOST_LOGGERS);
    same("guest-messages", MESSAGE_VIEW);
    same("reviews", REVIEW_VIEW);
    same("feedback", FEEDBACK_ROLES);
    same("online-checkin", DESK_ROLES);
    same("store", STOCK_ROLES.view);
    same("kitchen-stock", STOCK_ROLES.view);
    same("purchasing", PURCHASING_VIEW);
    same("spa-diary", SPA_READ_ROLES);
    same("spa-treatments", SPA_READ_ROLES);
    same("equipment", EQUIPMENT_GRANTS.view);
    same("requests", ROLES.filter((r) => teamsFor(r).length > 0));
    same("audit-log", ADMIN_READ_ROLES.audit_log);
    same("activity", ADMIN_READ_ROLES.audit_log);
  });

  it("asks of money and guests exactly the reports' downloaders", () => {
    const may = ROLES.filter((r) => exportRefusal(r, { title: "x", read: "x", holds: "money" }) === null);
    expect([...may].sort()).toEqual([...REPORT_EXPORTERS].sort());
  });

  it("masks an ID number to its last four", () => {
    expect(maskId("Z1234567")).toBe("XXXX4567");
    expect(maskId("1234 5678 9012")).toBe("XXXXXXXX9012");
  });
});

describe("the file", () => {
  it("holds exactly the rows the screen sent: money a number, a missing figure -, the ID masked", async () => {
    const res = await post(uid.gm, "guests.xlsx", shown);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="5EL-guests-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const values = await sheetValues(res);
    expect(values).toContain("Guests");
    expect(values).toContain("Asha Rao");
    expect(values).toContain("Ben Ito");
    expect(values).not.toContain("Z1234567");
    expect(values).toContain("XXXX4567");
    expect(values).toContain(1500.5);
    expect(values).toContain("-");
    expect(values.some((v) => typeof v === "string" && v.includes(`${TAG} gm`)), "who made it").toBe(true);
    /* Only what was sent: no other guest of the hotel came along. */
    const rows = values.filter((v) => typeof v === "string" && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v));
    expect(rows).toEqual(["Asha Rao", "Ben Ito"]);
  });

  it("makes a PDF", async () => {
    const res = await post(uid.gm, "arrivals.pdf", shown);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("the refusals", () => {
  it("refuses the front desk a list of money or guests, in the sentence the button shows", async () => {
    for (const file of ["guests.pdf", "folios.xlsx", "c-form.pdf"]) {
      const res = await post(uid.front_desk, file, shown);
      expect(res.status, file).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain("download reports");
    }
  });

  it("refuses a role the screen's own read rule refuses", async () => {
    const res = await post(uid.housekeeping, "folios.pdf", shown);
    expect(res.status).toBe(403);
  });

  /* The second part: a sample of the ~45 screens added on 12 November. */
  it("refuses a role the new screens' read rules refuse, a grant's and an own one's", async () => {
    for (const [who, file, words] of [
      [uid.front_desk, "marketing-campaigns.pdf", "marketing numbers"],       // see("marketing")
      [uid.housekeeping, "cash-deposits.xlsx", "the general manager"],         // own: deposits.ts SEE
      [uid.housekeeping, "audit-log.pdf", "the general manager"],              // own: ADMIN_READ_ROLES
      [uid.housekeeping, "guest-messages.pdf", "reception"],                   // own: VIEW_ROLES
    ] as const) {
      const res = await post(who, file, shown);
      expect(res.status, file).toBe(403);
      expect(((await res.json()) as { error: string }).error, file).toContain(words);
    }
  });

  it("refuses a new list of money or guests to one without the download right", async () => {
    for (const file of ["minibar.pdf", "guest-messages.xlsx", "night-audit-runs.pdf", "table-bookings.pdf"]) {
      const res = await post(uid.front_desk, file, shown);
      expect(res.status, file).toBe(403);
      expect(((await res.json()) as { error: string }).error, file).toContain("download reports");
    }
  });

  it("refuses the front desk Arrivals and All bookings as files, and gives them to the GM (the owner, 16 November)", async () => {
    for (const file of ["arrivals.pdf", "upcoming-arrivals.xlsx", "all-bookings.pdf"]) {
      const res = await post(uid.front_desk, file, shown);
      expect(res.status, file).toBe(403);
      expect(((await res.json()) as { error: string }).error, file).toContain("download reports");
      expect((await post(uid.gm, file, shown)).status, file).toBe(200);
    }
  });

  it("asks a screen's own export right instead: the Equipment register and the Store", async () => {
    const eq = await post(uid.front_desk, "equipment.pdf", shown);
    expect(eq.status).toBe(403);
    expect(((await eq.json()) as { error: string }).error).toBe(
      "Exporting the equipment register is for the owner, an administrator, the general manager "
      + "or the accountant. Ask one of them.");
    const store = await post(uid.housekeeping, "store.xlsx", shown);
    expect(store.status).toBe(403);
    expect(((await store.json()) as { error: string }).error).toContain("the Inventory Manager");
    expect((await post(uid.gm, "equipment.xlsx", shown)).status).toBe(200);
  });

  it("gives an open new list to whoever opens it", async () => {
    expect((await post(uid.front_desk, "wake-up-calls.pdf", shown)).status).toBe(200);
    expect((await post(uid.housekeeping, "work-orders.xlsx", shown)).status).toBe(200);
    expect((await post(uid.housekeeping, "lost-property.pdf", shown)).status).toBe(200);
  });

  it("refuses another hotel's rows: no such property", async () => {
    const res = await post(uid.pune, "arrivals.pdf", shown);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("No such property.");
  });

  it("refuses a list it does not know, and a body that is not a list", async () => {
    expect((await post(uid.gm, "nothing.pdf", shown)).status).toBe(404);
    expect((await post(uid.gm, "guests.pdf", { columns: [], rows: [] })).status).toBe(400);
    expect((await post(uid.gm, "guests.pdf", { ...shown, rows: [["one"]] })).status).toBe(400);
  });
});
