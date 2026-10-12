import { Link } from "react-router";
import { ChevronRight, ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateCompact } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { Card, CardBody, IconChip } from "@/components/ui";
import { useSetup, waiting } from "@/modules/admin/data/setup";
import { setupAddress, stepInfo } from "./steps";

/* STILL TO DO, on the Dashboard (the owner's D27-311): the steps somebody
   chose Later or Remind me for, each opening the setup at that step. Drawn
   only while something waits, and only for the owner, an Admin and the GM
   (who hold `setting`, as Settings does) - it asks the server for nothing
   otherwise, and says nothing if the server cannot answer: the Dashboard is
   not the place for that error. */
const MOST = 4;

export function SetupStillToDo({ code, className }: { code: string; className?: string }) {
  const may = canAccess(useRole(), "setting");
  const items = waiting(useSetup(code, may).data);
  if (!may || items.length === 0) return null;

  const shown = items.slice(0, MOST);
  const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange";
  return (
    <section aria-labelledby="setup-still-title" className={className} data-setup-still>
      <Card>
        <CardBody className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <IconChip tone="orange"><ListChecks /></IconChip>
            <div className="min-w-0 flex-1">
              <h2 id="setup-still-title" className="text-md font-semibold text-ink-900">Still to do</h2>
              <p className="text-sm text-grey-600">Steps of setting up this hotel that you put off.</p>
            </div>
            <Link to={setupAddress(code)}
              className={cn("shrink-0 text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4", focus)}>
              Set up this hotel
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-grey-100 border-t border-grey-100">
            {shown.map((item) => {
              const step = stepInfo(item.id);
              if (!step) return null;
              return (
                <li key={item.id}>
                  <Link to={setupAddress(code, item.id)}
                    className={cn("flex items-center gap-3 min-h-11 py-2 hover:text-brand-orange-700", focus)}>
                    <span className="min-w-0 flex-1 text-base text-ink-900">Step {step.number}, {step.title}</span>
                    <span className="text-sm text-grey-500 shrink-0">
                      {item.state === "remind" && item.remindOn ? `Remind me ${dateCompact(item.remindOn)}` : "Later"}
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-grey-400 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > shown.length && (
            <p className="mt-2 text-sm text-grey-500">and {items.length - shown.length} more</p>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
