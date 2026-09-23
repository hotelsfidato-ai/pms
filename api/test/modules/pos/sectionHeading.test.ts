import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A SECTION'S TAX HEADING, ON THE MENU SCREEN AND IN THE IMPORT

   D22-4   "A tax-heading picker on each menu section: yes." Until then a
           section's heading could be set only by re-importing the menu.
   D22-46  "Alcohol" as a section's heading in the menu import: yes, only
           where the hotel serves alcohol (D21-90).

   Done as a person does it: the section made on the Menu screen, the
   switch on Settings. The switch is put back as it was found.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "HEADTEST";
let ownerId: string;
let hotelId: string;
let wasServing: boolean;
let sectionId: string;

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const switchAlcohol = async (enabled: boolean) => {
  const res = await send("POST", "/modules/alcohol", { enabled });
  expect(res.status, await res.clone().text()).toBe(200);
};

/** The heading the menu read gives a section, by name. */
async function headingOf(name: string): Promise<string | null | undefined> {
  const res = await send("GET", "/till/menu");
  const body = (await res.json()) as { categories: { name: string; taxKind: string | null }[] };
  return body.categories.find((c) => c.name === name)?.taxKind;
}

const setHeading = async (kind: unknown) => {
  const res = await send("POST", `/till/menu/categories/${sectionId}/tax-kind`, { kind });
  return { status: res.status, body: (await res.json()) as { ok: boolean; reason?: string } };
};

const importRow = async (section: string, taxKind: string, dryRun: boolean) => {
  const res = await send("POST", "/till/menu/import", {
    dryRun, rows: [{ category: section, name: `${TAG} Rum 30 ml`, price: "150", taxKind }],
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as {
    rejected: number; verdicts: { action: string; detail: string }[];
  };
};

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  wasServing = (await sql("select app.module_enabled($1, 'alcohol') as on", [hotelId])).rows[0].on;

  /* Made on the Menu screen, so it has no heading - the case D22-4 is for. */
  const res = await send("POST", "/till/menu/categories", { name: `${TAG} Drinks` });
  expect(res.status, await res.clone().text()).toBe(200);
  sectionId = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  try {
    await switchAlcohol(wasServing);
    await sql(
      `delete from pos_menu_items where category_id in
         (select id from pos_menu_categories where hotel_id = $1 and name like '${TAG}%')`,
      [hotelId]);
    await sql(`delete from pos_menu_categories where hotel_id = $1 and name like '${TAG}%'`,
      [hotelId]);
  } finally {
    await closePool();
  }
});

describe("the heading picker on a menu section (D22-4)", () => {
  it("the menu read says a section's heading, and null for one made on the Menu screen", async () => {
    expect(await headingOf(`${TAG} Drinks`)).toBeNull();
  });

  it("sets it", async () => {
    const res = await setHeading("bar");
    expect(res.status, res.body.reason).toBe(200);
    expect(await headingOf(`${TAG} Drinks`)).toBe("bar");
  });

  it("refuses a heading a section cannot sell under", async () => {
    for (const kind of ["room", "spa", "vodka", null]) {
      const res = await setHeading(kind);
      expect(res.status, String(kind)).toBe(409);
    }
    expect(await headingOf(`${TAG} Drinks`)).toBe("bar");
  });

  it("refuses Alcohol where the property does not serve it, and writes nothing", async () => {
    await switchAlcohol(false);
    const res = await setHeading("alcohol");
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/only where this property serves alcohol/);
    expect(await headingOf(`${TAG} Drinks`)).toBe("bar");
  });

  it("sets Alcohol where it does", async () => {
    await switchAlcohol(true);
    const res = await setHeading("alcohol");
    expect(res.status, res.body.reason).toBe(200);
    expect(await headingOf(`${TAG} Drinks`)).toBe("alcohol");
  });
});

describe("Alcohol as a heading in the menu import (D22-46)", () => {
  it("is refused, with a sentence, where the property does not serve alcohol", async () => {
    await switchAlcohol(false);
    const report = await importRow(`${TAG} Spirits`, "Alcohol", true);
    expect(report.rejected).toBe(1);
    expect(report.verdicts[0]!.detail).toMatch(/only where this property serves alcohol/);
  });

  it("sets the section to Alcohol where it does", async () => {
    await switchAlcohol(true);
    const report = await importRow(`${TAG} Spirits`, "Alcohol", false);
    expect(report.rejected, report.verdicts[0]?.detail).toBe(0);
    expect(await headingOf(`${TAG} Spirits`)).toBe("alcohol");
  });
});
