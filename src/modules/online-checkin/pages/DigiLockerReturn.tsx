import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Card, CardBody } from "@/components/ui";
import { DIGILOCKER_TOKEN, finishDigilocker, keepUnlockFor } from "@/modules/online-checkin/data/guestWays";
import { messageFrom } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   BACK FROM DIGILOCKER - /g-digilocker (D27-235 2.5)

   The fixed address DigiLocker sends the guest back to (the server's
   DIGILOCKER_REDIRECT_URI), with `code` and `state` - or `error` when the
   guest said no. The link's token is in this tab's sessionStorage, put there
   by DigiLockerButton; the door checks DigiLocker's answer and hands back
   this phone's unlock, kept like a code's, and the guest is on their page.
   Outside the sign-in gate, like the guest's page itself.
   ══════════════════════════════════════════════════════════════════ */

/* Read here, removed in the effect: a state initializer may run twice. */
const held = (): string | null => {
  try { return sessionStorage.getItem(DIGILOCKER_TOKEN); } catch { return null; }
};

export default function DigiLockerReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(held);
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    try { sessionStorage.removeItem(DIGILOCKER_TOKEN); } catch { /* nothing held */ }
    const code = params.get("code");
    const state = params.get("state");
    if (!token || !code || !state || params.get("error")) {
      setProblem("DigiLocker did not confirm it. Go back to your booking and try again, or ask for a code.");
      return;
    }
    finishDigilocker(code, state)
      .then((r) => { keepUnlockFor(token, r.unlock); navigate(`/g/${token}`, { replace: true }); })
      .catch((error: unknown) => setProblem(messageFrom(error)));
  }, [params, token, navigate]);

  return (
    <main className="min-h-dvh bg-grey-50 px-5 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <Card><CardBody>
          {problem ? (
            <>
              <p className="text-base text-ink-900">{problem}</p>
              {token && (
                <Link to={`/g/${token}`}
                      className="mt-3.5 inline-flex min-h-11 items-center text-brand-orange-700 hover:underline">
                  Back to my booking
                </Link>
              )}
            </>
          ) : (
            <p className="text-base text-grey-600">One moment…</p>
          )}
        </CardBody></Card>
      </div>
    </main>
  );
}
