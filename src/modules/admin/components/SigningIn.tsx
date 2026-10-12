import { KeyRound } from "lucide-react";
import { Card, CardBody, IconChip } from "@/components/ui";
import { MIN_PASSWORD, MIN_MANAGER_PASSWORD } from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   SIGNING IN — the rules, read-only (D27-243 phase 5, D27-245)

   On Settings → People. Nothing here is changed: the rules are the
   owner's, and the server holds each one.
   ══════════════════════════════════════════════════════════════════ */
export function SigningIn() {
  return (
    <Card>
      <CardBody className="space-y-3">
        <h2 className="flex items-center gap-2.5 text-md font-semibold text-ink-900">
          <IconChip size={24}><KeyRound /></IconChip>
          Signing in
        </h2>
        <ul className="space-y-1.5 text-sm text-ink-900">
          <li>
            A password is at least {MIN_MANAGER_PASSWORD} characters for the owner, an Admin
            and a GM, and at least {MIN_PASSWORD} for everybody else.
          </li>
          <li>
            Somebody given the owner's, an Admin's or a GM's role with a shorter password sets
            a new one at their next sign-in.
          </li>
          <li>
            Each sign-in is kept for 90 days: when, and on what device. The owner and an
            Admin see it under Sign-ins and devices.
          </li>
          <li className="text-grey-600">
            Two-step sign-in, for the owner, Admins and GMs, comes after this release.
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}
