import { useEffect, useReducer } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { ListChecks, X } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { mayReach } from "@/components/app/navigation";
import { SETUP_PAGE, TOTAL_STEPS, setupAddress, stepInfo } from "./steps";

/* BACK TO SETUP (the owner's D27-311, D27-312): a slim bar at the top of a
   screen opened from the setup, which carries ?setup=<step>. It then STAYS on
   every screen visited in this browser tab, with the last step seen for that
   hotel, until the person presses "Back to setup" or closes it. The step is
   kept in sessionStorage (this tab's visit); where the browser blocks it, the
   bar is as it was: only while the address carries ?setup. Mounted once, by
   the top bar, so no screen has to know. It makes no request, and is not
   drawn for somebody who could not open the setup, nor on the setup page
   itself, where it also forgets the step (D27-316 (6c)). */
const KEY = (code: string) => `fidato.setup-bar.${code}`;
const recall = (code: string): string | null => {
  try { return sessionStorage.getItem(KEY(code)); } catch { return null; }
};
const keep = (code: string, id: string | null) => {
  try {
    if (id) sessionStorage.setItem(KEY(code), id); else sessionStorage.removeItem(KEY(code));
  } catch { /* blocked: the bar shows only while the address carries ?setup */ }
};

export function SetupBar() {
  const [params, setParams] = useSearchParams();
  const code = useUi((s) => s.hotelId);
  const role = useRole();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /* On the setup page itself (or its hotel address, which lands there) the bar
     would point at the page you are on, and a step still remembered would show
     on the next screen. So it is hidden there and forgotten there (D27-316 (6c)). */
  const { pathname } = useLocation();
  const onSetup = pathname === SETUP_PAGE || pathname === setupAddress(code);
  const seen = stepInfo(params.get("setup"))?.id;
  useEffect(() => {
    if (!code) return;
    if (onSetup) keep(code, null); else if (seen) keep(code, seen);
  }, [seen, code, onSetup]);
  const step = stepInfo(seen ?? (code ? recall(code) : null));
  if (onSetup || !step || !code || !mayReach(role, SETUP_PAGE)) return null;

  /* Closing also takes ?setup out of this address, or the bar would stay. */
  const close = () => {
    keep(code, null);
    if (params.has("setup")) setParams((p) => { p.delete("setup"); return p; }, { replace: true });
    redraw();
  };

  return (
    <p className="flex items-center gap-3 px-4 sm:px-5 py-1.5 bg-brand-orange-50 border-b border-brand-orange-100 text-sm text-ink-900"
      role="status" data-setup-bar>
      <ListChecks className="size-4 text-brand-orange-700 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Setting up this hotel: step {step.number} of {TOTAL_STEPS}, {step.title}
      </span>
      <Link to={setupAddress(code, step.id)} onClick={() => keep(code, null)}
        className="shrink-0 font-medium text-brand-orange-700 underline underline-offset-2 hover:text-brand-orange-800 pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center">
        Back to setup
      </Link>
      <button type="button" aria-label="Close the setup bar" onClick={close}
        className="shrink-0 grid place-items-center size-6 rounded text-brand-orange-700 hover:bg-brand-orange-100 cursor-pointer pointer-coarse:size-11">
        <X className="size-4" aria-hidden />
      </button>
    </p>
  );
}
