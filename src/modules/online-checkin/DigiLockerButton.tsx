import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui";
import { DIGILOCKER_TOKEN, digilockerOffered, startDigilocker } from "@/modules/online-checkin/data/guestWays";
import { messageFrom } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   CONTINUE WITH DIGILOCKER (D27-235 2.5) - placed beside "Continue with
   Google" on the code screen of pages/GuestPage.tsx (the master adds the
   one line at merge: <DigiLockerButton token={token} />)

   Draws NOTHING while the server says it is off (its three settings unset,
   or the link reaches no stay). On the press: this link's token is kept in
   this tab's sessionStorage - never in an address, never on the server -
   and the guest goes to DigiLocker's own sign-in; DigiLocker sends them back
   to /g-digilocker (pages/DigiLockerReturn.tsx).

   `go` is the browser's own navigation; tests pass their own.
   ══════════════════════════════════════════════════════════════════ */
export function DigiLockerButton(
  { token, go = (url: string) => window.location.assign(url) }:
  { token: string; go?: (url: string) => void },
) {
  const offered = useQuery({
    queryKey: ["guest-digilocker", token],
    queryFn: () => digilockerOffered(token),
    retry: false,
    staleTime: 60_000,
  });
  const start = useMutation({
    mutationFn: () => {
      try { sessionStorage.setItem(DIGILOCKER_TOKEN, token); } catch { /* a private tab: it cannot come back */ }
      return startDigilocker(token);
    },
    onSuccess: ({ url }) => go(url),
  });

  if (!offered.data?.offered) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" className="w-full" disabled={start.isPending}
              onClick={() => start.mutate()}>
        {start.isPending ? "Opening DigiLocker…" : "Continue with DigiLocker"}
      </Button>
      {start.error && <p className="text-sm text-brand-red-700">{messageFrom(start.error)}</p>}
    </div>
  );
}
