import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/lib/session";
import { getDesk } from "@/modules/online-checkin/data/desk";
import { DESK_ROLES } from "@/modules/online-checkin/nav";

/* ══════════════════════════════════════════════════════════════════
   "THIS GUEST SENT THEIR ID DETAILS ONLINE" - drawn inside the check-in

   The owner, 25 September: in the check-in's ID step, only when THIS
   booking has details waiting from the guest's own page, one line to
   the Online check-in screen - in a new tab, so the check-in in
   progress is not lost. Confirming stays there, against the ID (D21-8).

   Only the desk's roles (the server's DESK_ROLES) read the waiting
   details; for anybody else this draws nothing and asks nothing.
   ══════════════════════════════════════════════════════════════════ */
export default function WaitingDetailsLink({ reference }: { reference: string }) {
  const code = useParams().code ?? "";
  const desk = DESK_ROLES.includes(useRole());
  const q = useQuery({
    queryKey: ["online-checkin-desk", code],
    queryFn: () => getDesk(code),
    enabled: desk && !!code,
    staleTime: 0,
  });

  if (!desk || !q.data?.waiting.some((d) => d.reference === reference)) return null;
  return (
    <p className="text-sm text-ink-900">
      This guest sent their ID details online -{" "}
      <a href={`/h/${encodeURIComponent(code)}/online-checkin`} target="_blank" rel="noreferrer"
        className="text-brand-orange-700 hover:underline font-medium">
        check them on Online check-in
      </a>
    </p>
  );
}
