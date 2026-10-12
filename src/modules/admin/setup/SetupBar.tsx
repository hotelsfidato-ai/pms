import { Link, useSearchParams } from "react-router";
import { ListChecks } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { mayReach } from "@/components/app/navigation";
import { SETUP_PAGE, TOTAL_STEPS, setupAddress, stepInfo } from "./steps";

/* BACK TO SETUP (the owner's D27-311): a slim bar at the top of ANY screen
   whose address carries ?setup=<step>, the way the setup opened it. Mounted
   once, by the top bar, so no screen has to know. It reads the address and
   nothing else (no request), and is not drawn for somebody who could not
   open the setup. */
export function SetupBar() {
  const [params] = useSearchParams();
  const code = useUi((s) => s.hotelId);
  const role = useRole();
  const step = stepInfo(params.get("setup"));
  if (!step || !code || !mayReach(role, SETUP_PAGE)) return null;

  return (
    <p className="flex items-center gap-3 px-4 sm:px-5 py-1.5 bg-brand-orange-50 border-b border-brand-orange-100 text-sm text-ink-900"
      role="status" data-setup-bar>
      <ListChecks className="size-4 text-brand-orange-700 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Setting up this hotel: step {step.number} of {TOTAL_STEPS}, {step.title}
      </span>
      <Link to={setupAddress(code, step.id)}
        className="shrink-0 font-medium text-brand-orange-700 underline underline-offset-2 hover:text-brand-orange-800">
        Back to setup
      </Link>
    </p>
  );
}
