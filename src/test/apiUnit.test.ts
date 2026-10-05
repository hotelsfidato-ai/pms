import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   THE API MAY WRITE WHERE THE UPLOADED BILLS GO (28 September)

   launch.sh keeps uploads outside the checkout, in UPLOAD_DIR, and the
   unit runs the API under ProtectSystem=strict: every path its
   ReadWritePaths does not name is read-only. It named only the checkout,
   so no bill could be saved on the server. This reads the files, not the
   box: `systemctl show fidato-api -p ReadWritePaths` there is the proof.
   ══════════════════════════════════════════════════════════════════ */

const DEPLOY = join(__dirname, "..", "..", "deploy");

it("the unit lets the API write to the upload folder launch.sh makes, and stays strict", () => {
  const unit = readFileSync(join(DEPLOY, "fidato-api.service"), "utf8");
  // launch.sh renders the unit through deploy/customer.sh (D27-278).
  const launch = readFileSync(join(DEPLOY, "customer.sh"), "utf8");

  expect(unit).toMatch(/^ProtectSystem=strict$/m);
  const writable = unit.match(/^ReadWritePaths=(.*)$/m)?.[1]?.split(/\s+/) ?? [];
  expect(writable).toEqual(["__APP_DIR__/api", "__UPLOAD_DIR__"]);
  expect(launch).toContain('-e "s#__UPLOAD_DIR__#$UPLOAD_DIR#g"');
});
