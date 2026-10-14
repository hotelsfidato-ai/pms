import { useState } from "react";
import { Link, useLocation } from "react-router";
import { ChevronRight, Compass } from "lucide-react";
import { useSession, useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { Button, Card, CardBody, toast } from "@/components/ui";
import { setMyPreferences } from "@/data/repositories";
import { START_HERE, START_HERE_ON } from "./startHereCards";

/* ══════════════════════════════════════════════════════════════════
   START HERE — a person's first jobs, on the screen they land on

   The critique of 15 September found no help anywhere: a new clerk's
   only way to learn was to ask somebody. This is the smallest thing that
   answers "what do I do here?" without a tour — a tour is watched once
   and forgotten, a card they can come back to is used.

   On the person's own landing screens only (START_HERE_ON), for the four
   roles the owner chose and the Bar (the waiter's card, D27-329 (3)),
   until they tap "Got it" — remembered on the
   server (089) so it follows them to any terminal, and brought back from
   the account menu.

   Each landing screen places it, rather than the shell: the kitchen board
   covers the whole display and the room grid is full height, so one mounted
   above <Outlet/> would sit under the first and shove the second's grid off
   the bottom. The screens are Dashboard, Rooms, Calendar, Housekeeping,
   Tables, the Till and the kitchen board.

   "Got it" is SECONDARY on purpose: the page under it has its own main
   action, and one orange button per screen is the rule (step 2).
   ══════════════════════════════════════════════════════════════════ */

export function StartHere({ className }: { className?: string }) {
  const role = useRole();
  const scope = useSession((s) => s.scope);
  const code = useUi((s) => s.hotelId) ?? "";
  const { pathname } = useLocation();
  const [saving, setSaving] = useState(false);

  const card = START_HERE[role];
  const on = START_HERE_ON[role];
  if (!card || !on || !scope || scope.startHereDismissed || !code) return null;
  if (!on.some((path) => path.replace(":code", code) === pathname)) return null;

  const putAway = async () => {
    setSaving(true);
    /* Gone at once; put back if the server says no. Waiting on a round
       trip to hide a card reads as the button not working. */
    useSession.setState({ scope: { ...scope, startHereDismissed: true } });
    const res = await setMyPreferences({ startHereDismissed: true });
    setSaving(false);
    if (!res.ok) {
      useSession.setState({ scope: { ...scope, startHereDismissed: false } });
      toast.error("Not remembered", res.reason);
      return;
    }
    toast.success("Put away", "Bring it back any time from your account menu.");
  };

  return (
    <section aria-labelledby="start-here-title" className={className} data-start-here>
      <Card>
        <CardBody className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center size-9 rounded-md bg-brand-orange-50 text-brand-orange-700 shrink-0">
              <Compass className="size-5" aria-hidden />
            </span>
            <div className="flex-1 min-w-0">
              <h2 id="start-here-title" className="text-md font-semibold text-ink-900">
                Start here
              </h2>
              <p className="text-sm text-grey-600 mt-0.5">{card.intro}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void putAway()} loading={saving}>
              Got it
            </Button>
          </div>

          <ul className="mt-4 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {card.tasks.map((task) => {
              const to = task.to.replace(":code", code);
              const body = (
                <>
                  <span className="grid place-items-center size-8 rounded-md bg-grey-100 text-grey-500 shrink-0">
                    <task.icon className="size-4" aria-hidden />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-medium text-ink-900">{task.job}</span>
                    <span className="block text-sm text-grey-600 mt-0.5 leading-snug">{task.how}</span>
                  </span>
                </>
              );
              /* A job done on THIS screen is not a link: one that reloads
                 the page you are on reads as a button that does nothing. */
              if (to === pathname) {
                return (
                  <li key={task.job} className="flex items-start gap-3 rounded-md border border-grey-200 p-3 h-full">
                    {body}
                    <span className="text-2xs text-grey-500 shrink-0 mt-1">On this screen</span>
                  </li>
                );
              }
              return (
                <li key={task.job}>
                  <Link
                    to={to}
                    className="group flex items-start gap-3 rounded-md border border-grey-200 p-3 h-full
                               hover:border-grey-300 hover:bg-grey-50 transition-colors duration-150
                               focus-visible:outline-2 focus-visible:outline-brand-orange"
                  >
                    {body}
                    <ChevronRight
                      className="size-4 text-grey-300 shrink-0 mt-1 transition-all duration-150
                                 group-hover:text-grey-500 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}
