import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Store } from "lucide-react";
import { Page, EmptyState, Skeleton } from "@/components/ui";
import { getPosAccess } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   THE POINT OF SALE, OR THE REASON IT IS SHUT

   Every POS screen sits inside this. It asks the server once whether
   this person may use the till here — the POS module AND, for
   Reception, the per-hotel switch (087) — and shows the server's own
   sentence when the answer is no.

   ⚠ WHY IT EXISTS. The till's reads turned every failure into an empty
   list, so a receptionist refused by the new switch opened the till and
   read "There is no menu yet" — a wrong reason, which is worse than
   none. Rule 6: a blocked thing is shown blocked, with why. The reads
   throw now (POS-4) and each screen names its own failure too; this
   still answers first, once, for the whole service.

   Only an explicit refusal shuts the door. Offline, the check answers
   "go ahead" and the till's own outbox takes over, as it did before.
   ══════════════════════════════════════════════════════════════════ */

export function PosGate({ children }: { children: ReactNode }) {
  const { code = "" } = useParams<{ code: string }>();
  const access = useQuery({
    queryKey: ["pos-access", code],
    queryFn: () => getPosAccess(code),
    enabled: Boolean(code),
    staleTime: 60_000,
  });

  if (access.isLoading) {
    return (
      <Page>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full mt-4" />
      </Page>
    );
  }

  if (access.data && !access.data.ok) {
    return (
      <Page>
        <EmptyState
          icon={<Store />}
          title="The point of sale is not open to you here"
          description={access.data.reason}
        />
      </Page>
    );
  }

  return <>{children}</>;
}
