import { Link } from "react-router";
import { ShieldOff } from "lucide-react";
import { useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { ROLE_LABELS, type Resource } from "@/lib/permissions";
import { entryFor, flatNavigationFor, mayReach, workingHomeFor } from "./navigation";
import { Page } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   A ROUTE THE ROLE MAY ACTUALLY REACH

   Until this existed there was NO route guard. The sidebar filtered
   what it showed — `canSee(role)` on every nav item — and nothing at
   all stopped a front-desk clerk typing /admin/users into the address
   bar. They got the page.

   Row Level Security saved the data: the clerk saw one staff row,
   their own, because `staff_self` is the only policy that admitted
   them. So the leak was the page SHELL, not the roster. That is the
   good half of a bad finding, and it is exactly what defence in depth
   is supposed to look like — but a clerk should not reach an
   administration page at all, and "the database will refuse them"
   is not a reason to hand them the door.

   NAVIGATION HIDING IS NOT ACCESS CONTROL. It is a courtesy that
   keeps a sidebar short. But the two must agree, so this guard asks
   the navigation itself rather than re-deriving the answer — the first
   version asked `canAccess(role, resource)` and let a clerk into
   /admin/properties, whose sidebar entry overrides that with a
   stricter test.

   WHY THIS REFUSES RATHER THAN REDIRECTS

   A silent bounce to the dashboard reads as a bug — the clerk clicks
   a link somebody sent them and lands somewhere else with no
   explanation, and rings the front desk about it. Rule 6 again: say
   what was refused and why.
   ══════════════════════════════════════════════════════════════════ */

export function RequireAccess({
  path,
  children,
}: {
  /** The nav path this route corresponds to. The guard asks the
      NAVIGATION whether this role may reach it, so a hidden link and a
      refused page cannot disagree — which they did the first time this
      component asked `canAccess` while the sidebar asked something
      stricter for /admin/properties. */
  path: string;
  /** Not read since D27-1: the refusal names the page by its menu name,
      not by this permission ("which does not include customer"). Left on
      the routes rather than edited out of every service's routes file. */
  resource: Resource;
  children: React.ReactNode;
}) {
  const role = useRole();
  const code = useUi((s) => s.hotelId);

  if (mayReach(role, path)) return <>{children}</>;

  /* Back to the person's own first screen (QA RO-5): "the dashboard" sent
     housekeeping, the kitchen and the store to a screen they are kept
     from too. */
  const home = workingHomeFor(role, code) ?? "/";
  const homeLabel = flatNavigationFor(role, code).find((i) => i.to === home)?.label ?? "Dashboard";
  /* A record is named by its list (D27-275); an address no entry covers is
     nobody's, and a change of role would not open it. */
  const entry = entryFor(path);

  return (
    <Page>
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="size-11 rounded-full bg-grey-100 grid place-items-center mx-auto mb-4">
          <ShieldOff className="size-5 text-grey-400" />
        </div>
        <h1 className="text-lg font-semibold text-ink-900">
          This page is not part of your role
        </h1>
        {entry ? (
          <p className="text-base text-grey-600 mt-2 leading-relaxed">
            You are signed in as{" "}
            <span className="font-medium text-ink-900">{ROLE_LABELS[role]}</span>,
            which does not include {entry.label}. If you need it,
            the person who set up your account can change your role.
          </p>
        ) : (
          <p className="text-base text-grey-600 mt-2 leading-relaxed">
            No screen in the menu has this address, so it is not open to any role.
          </p>
        )}
        <Link
          to={home}
          className="inline-block mt-5 text-sm text-brand hover:underline"
        >
          Back to {homeLabel}
        </Link>
      </div>
    </Page>
  );
}
