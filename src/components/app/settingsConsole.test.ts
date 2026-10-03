import { describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import {
  SETTINGS_GROUPS, addressOf, assemble, problems, registered, type SettingsPage,
} from "./settingsConsole";

/* The console registration contract (D27-254, D27-256): the groups are fixed,
   a stand-in yields to a page registered at its address, and two pages never
   share one. */

const load = () => Promise.resolve({ default: () => null });
const page = (over: Partial<SettingsPage> & Pick<SettingsPage, "group" | "slug">): SettingsPage =>
  ({ label: over.slug, icon: Settings, order: 10, load, ...over }) as SettingsPage;

describe("the settings console's registration", () => {
  it("has the nine groups of the brief, in its order", () => {
    expect(SETTINGS_GROUPS.map((g) => `${g.key}=${g.label}`)).toEqual([
      "property=Property", "rooms=Rooms", "rates=Rates and tax", "money=Money", "lists=Lists",
      "front-desk=Front desk", "messages=Messages", "people=People and security",
      "connections=Modules and connections",
    ]);
  });

  it("addresses a page /settings/<group>/<slug>", () => {
    expect(addressOf(page({ group: "rates", slug: "plans" }))).toBe("/settings/rates/plans");
  });

  it("drops a stand-in when a page is registered at its address, and orders by group then order", () => {
    const pages = assemble([
      page({ group: "rates", slug: "taxes", label: "old", standIn: true }),
      page({ group: "rates", slug: "plans", order: 20 }),
      page({ group: "property", slug: "profile", standIn: true }),
      page({ group: "rates", slug: "taxes", label: "new", order: 10 }),
    ]);
    expect(pages.map((p) => `${addressOf(p)} ${p.label}`)).toEqual([
      "/settings/property/profile profile", "/settings/rates/taxes new", "/settings/rates/plans plans",
    ]);
  });

  it("refuses two pages at one address and a slug that is not kebab-case", () => {
    expect(problems([
      page({ group: "money", slug: "bank" }),
      page({ group: "money", slug: "bank" }),
      page({ group: "money", slug: "Payment_methods" }),
      page({ group: "lists", slug: "holidays", standIn: true }),
      page({ group: "lists", slug: "holidays" }),
    ])).toEqual([
      "/settings/money/bank: registered twice",
      "/settings/money/Payment_methods: the slug is not kebab-case",
    ]);
  });

  it("finds nothing wrong in the pages the services register", () => {
    expect(problems(registered())).toEqual([]);
  });
});
