import { describe, it, expect } from "vitest";
import { chooseDatabase } from "../scripts/scriptDatabase.ts";

/* ══════════════════════════════════════════════════════════════════
   WHICH DATABASE A SCRIPT WRITES TO (the owner's D17-90, MEMORY 287)

   A chat ran the demo loader in its own copy and it began tearing down
   the MAIN development database, because the script read nothing from
   the copy it was running in and fell back to a name on the shared
   server. The rule now: this copy's settings decide, or it refuses.
   ══════════════════════════════════════════════════════════════════ */

const APP = "postgres://pms_app:app-pw@127.0.0.1:55432/fidato_cm";

describe("a script asks the copy it is running in", () => {
  it("takes this copy's database, as the local superuser, never another copy's", () => {
    const choice = chooseDatabase({}, { DATABASE_URL: APP });
    expect(choice.ok).toBe(true);
    if (!choice.ok) return;
    expect(choice.database.url).toContain("/fidato_cm");
    expect(choice.database.url).not.toContain("/fidato?");
    expect(choice.database.url.endsWith("/fidato")).toBe(false);
    expect(choice.database.url).toContain("postgres:pw@");
    expect(choice.database.where, "safe to print: no password").toBe("fidato_cm on 127.0.0.1:55432");
    expect(choice.database.where).not.toContain("pw");
  });

  it("refuses when this copy says nothing, rather than guessing", () => {
    const choice = chooseDatabase({}, {});
    expect(choice.ok).toBe(false);
    if (choice.ok) return;
    expect(choice.reason).toContain("Refusing to run");
    expect(choice.reason).toContain("api/.env");
  });

  it("obeys an administrative connection string already set in the shell", () => {
    const told = "postgres://postgres:pw@127.0.0.1:55432/fidato_test_9";
    const choice = chooseDatabase({ SUPER_DATABASE_URL: told }, { DATABASE_URL: APP });
    expect(choice.ok && choice.database.url).toBe(told);
  });

  it("prefers this copy's own administrative string to its application one", () => {
    const admin = "postgres://postgres@/fidato?host=/var/run/postgresql";
    const choice = chooseDatabase({}, { ADMIN_DATABASE_URL: admin, DATABASE_URL: APP });
    expect(choice.ok && choice.database.url).toBe(admin);
  });

  it("will not guess a superuser for a database on another machine", () => {
    const choice = chooseDatabase({}, { DATABASE_URL: "postgres://pms_app:x@db.example.com:5432/fidato" });
    expect(choice.ok).toBe(false);
    if (choice.ok) return;
    expect(choice.reason).toContain("not this machine");
  });

  it("refuses a connection string it cannot read, and one naming no database", () => {
    expect(chooseDatabase({ SUPER_DATABASE_URL: "not a url" }, {}).ok).toBe(false);
    expect(chooseDatabase({ SUPER_DATABASE_URL: "postgres://postgres:pw@127.0.0.1:55432" }, {}).ok).toBe(false);
  });
});
